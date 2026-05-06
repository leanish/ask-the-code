import fs from "node:fs";

import { resolveAnswerAudience } from "./answer-audience.ts";
import { loadConfig } from "../config/config.ts";
import { getCodexTimeoutMs, runCodexQuestion } from "../codex/codex-runner.ts";
import { selectRepos } from "../repos/repo-selection.ts";
import { syncRepos } from "../repos/repo-sync.ts";
import { formatSyncFailures } from "../repos/sync-report-format.ts";
import { formatDuration } from "../time/duration-format.ts";
import type {
  AnswerQuestionFn,
  AskRequest,
  Environment,
  ManagedRepo,
  RepoSyncCallbacks,
  RepoSyncStartAction,
  RepoSyncTarget,
  RepoSelectionSummary,
  QuestionExecutionOptions,
  QuestionExecutionOverrides,
  RepoSelectionMode,
  StatusReporter,
  SyncReportItem
} from "../types.ts";

const REPO_SELECTION_COMPARISON_TIMEOUT_MS = 30_000;

export const answerQuestion: AnswerQuestionFn = async (
  options: AskRequest,
  envOrExecution: Environment | QuestionExecutionOverrides = process.env,
  legacyStatusReporter: StatusReporter | null = null
) => {
  const execution = normalizeExecutionOptions(envOrExecution, legacyStatusReporter);
  const config = await execution.loadConfigFn(execution.env);
  const audience = resolveAnswerAudience(options.audience);
  execution.statusReporter?.info("Selecting repos...");

  const selectionStartedAt = execution.nowFn();
  const selection = await execution.selectReposFn(config, options.question, options.repoNames, {
    selectionMode: options.selectionMode ?? null,
    selectionShadowCompare: Boolean(options.selectionShadowCompare)
  });
  const selectionElapsedMs = execution.nowFn() - selectionStartedAt;
  const selectedRepos = selection.repos;

  if (selectedRepos.length === 0) {
    throw new Error("No managed repositories matched the question. Use --repo <name> or update the ask-the-code config.");
  }

  execution.statusReporter?.info(
    formatRepoSelectionStatus(selection.mode, selectedRepos, selectionElapsedMs)
  );
  execution.statusReporter?.info(formatRepoSyncModeStatus(options.noSync));
  const finalizedSelectionPromise = finalizeRepoSelection(selection, execution.statusReporter);

  const syncReport: SyncReportItem[] = options.noSync
    ? createSkippedSyncReport(selectedRepos)
    : await execution.syncReposFn(selectedRepos, createSyncCallbacks(execution.statusReporter));

  if (options.noSynthesis) {
    const finalizedSelection = await finalizedSelectionPromise;
    return {
      mode: "retrieval-only",
      question: options.question,
      selectedRepos,
      selection: finalizedSelection,
      syncReport
    };
  }

  const failedSyncs = syncReport.filter(item => item.action === "failed");
  if (failedSyncs.length > 0) {
    throw new Error(`Failed to sync managed repo(s): ${formatSyncFailures(failedSyncs)}`);
  }

  const unavailableRepos = selectedRepos.filter(repo => !execution.existsSyncFn(repo.directory));
  if (unavailableRepos.length > 0) {
    throw new Error(
      `Managed repo(s) unavailable locally after sync: ${unavailableRepos.map(repo => repo.name).join(", ")}`
    );
  }

  const synthesis = await execution.runCodexQuestionFn({
    question: options.question,
    audience,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    selectedRepos,
    workspaceRoot: config.managedReposRoot,
    timeoutMs: execution.getCodexTimeoutMsFn(execution.env),
    ...(options.attachments && options.attachments.length > 0
      ? { attachments: options.attachments }
      : {}),
    onStatus(message) {
      execution.statusReporter?.info(message);
    }
  });
  const finalizedSelection = await finalizedSelectionPromise;

  return {
    mode: "answer",
    question: options.question,
    selectedRepos,
    selection: finalizedSelection,
    syncReport,
    synthesis
  };
};

function formatRepoSelectionStatus(
  selectionMode: RepoSelectionMode,
  selectedRepos: ManagedRepo[],
  elapsedMs: number
): string {
  const repoNames = selectedRepos.map(repo => repo.name).join(", ");
  const label = getRepoSelectionStatusLabel(selectionMode);

  return `${label} in ${formatDuration(elapsedMs)}: ${repoNames}`;
}

function formatRepoSyncModeStatus(noSync: boolean): string {
  return `Skip repo sync: ${noSync ? "yes" : "no"}`;
}

function createSkippedSyncReport(selectedRepos: ManagedRepo[]): SyncReportItem[] {
  return selectedRepos.map(repo => ({
    name: repo.name,
    directory: repo.directory,
    action: "skipped"
  }));
}

function createSyncCallbacks(statusReporter: StatusReporter | null): RepoSyncCallbacks {
  return {
    onRepoStart(repo: RepoSyncTarget, action: RepoSyncStartAction, trunkBranch: string) {
      statusReporter?.info(`${action === "clone" ? "Cloning" : "Updating"} ${repo.name} (${trunkBranch})...`);
    },
    onRepoWait(repo: RepoSyncTarget, trunkBranch: string) {
      statusReporter?.info(`Waiting for ${repo.name} (${trunkBranch}) sync already in progress...`);
    },
    onRepoResult(item: SyncReportItem) {
      const detail = item.detail ? ` (${item.detail})` : "";
      statusReporter?.info(`${item.name}: ${item.action}${detail}`);
    }
  };
}

function getRepoSelectionStatusLabel(selectionMode: RepoSelectionMode): string {
  switch (selectionMode) {
    case "requested":
      return "Requested repos";
    case "all":
      return "All repos";
    case "resolved":
      return "Resolved repos";
  }

  return assertUnreachable(selectionMode);
}

function assertUnreachable(value: never): never {
  throw new Error(`Unexpected repo selection mode: ${String(value)}`);
}

async function finalizeRepoSelection(
  selection: Awaited<ReturnType<QuestionExecutionOptions["selectReposFn"]>>,
  statusReporter: StatusReporter | null
): Promise<RepoSelectionSummary | null> {
  if (!selection.selectionPromise) {
    return selection.selection;
  }

  const finalizedSelection = await waitForRepoSelectionComparison(
    selection.selectionPromise,
    selection.selection,
    statusReporter
  );
  if (finalizedSelection && shouldReportSelectionComparison(finalizedSelection)) {
    statusReporter?.info(formatSelectionComparisonStatus(finalizedSelection));
  }

  return finalizedSelection;
}

async function waitForRepoSelectionComparison(
  selectionPromise: Promise<RepoSelectionSummary | null>,
  fallbackSelection: RepoSelectionSummary | null,
  statusReporter: StatusReporter | null
): Promise<RepoSelectionSummary | null> {
  const timeoutResult = Symbol("repo-selection-comparison-timeout");
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    const result = await Promise.race<RepoSelectionSummary | null | typeof timeoutResult>([
      selectionPromise,
      new Promise<typeof timeoutResult>(resolve => {
        timeoutHandle = setTimeout(() => resolve(timeoutResult), REPO_SELECTION_COMPARISON_TIMEOUT_MS);
      })
    ]);

    if (result === timeoutResult) {
      statusReporter?.info("Repo selection comparison timed out; returning initial selection diagnostics.");
      return fallbackSelection;
    }

    return result;
  } catch {
    return fallbackSelection;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function shouldReportSelectionComparison(selection: RepoSelectionSummary): boolean {
  return selection.runs.length >= 2;
}

function formatSelectionComparisonStatus(selection: RepoSelectionSummary): string {
  const parts = selection.runs.map(run => {
    const confidence = run.confidence == null ? "?" : run.confidence.toFixed(2);
    const repoNames = run.repoNames.length > 0 ? run.repoNames.join(", ") : "(none)";
    const suffix = run.usedForFinal ? " final" : "";
    return `${run.effort}=${repoNames} confidence=${confidence}${suffix}`;
  });

  return `Repo selection comparison: ${parts.join(" | ")}`;
}

function normalizeExecutionOptions(
  envOrExecution: Environment | QuestionExecutionOverrides,
  legacyStatusReporter: StatusReporter | null
): QuestionExecutionOptions {
  const defaultExecution: QuestionExecutionOptions = {
    env: process.env,
    statusReporter: null,
    loadConfigFn: loadConfig,
    selectReposFn: selectRepos,
    syncReposFn: syncRepos,
    existsSyncFn: fs.existsSync,
    getCodexTimeoutMsFn: getCodexTimeoutMs,
    runCodexQuestionFn: runCodexQuestion,
    nowFn: Date.now
  };
  const hasExecutionOverrides = looksLikeExecutionOptions(envOrExecution);

  if (legacyStatusReporter) {
    // Preserve the legacy 3-argument signature: the second argument is an env bag,
    // so accidental execution-option objects still fall back to process.env here.
    return {
      ...defaultExecution,
      env: hasExecutionOverrides ? process.env : envOrExecution || process.env,
      statusReporter: legacyStatusReporter
    };
  }

  if (!hasExecutionOverrides) {
    return {
      ...defaultExecution,
      env: envOrExecution || process.env
    };
  }

  return {
    ...defaultExecution,
    ...envOrExecution
  };
}

function looksLikeExecutionOptions(value: unknown): value is QuestionExecutionOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return [
    "env",
    "statusReporter",
    "loadConfigFn",
    "selectReposFn",
    "syncReposFn",
    "existsSyncFn",
    "getCodexTimeoutMsFn",
    "runCodexQuestionFn",
    "nowFn"
  ].some(key => key in value);
}
