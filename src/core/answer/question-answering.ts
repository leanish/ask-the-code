import fs from "node:fs";

import { resolveAnswerAudience } from "./answer-audience.js";
import { loadConfig } from "../config/config.js";
import { getCodexTimeoutMs, runCodexQuestion } from "../codex/codex-runner.js";
import { formatEstimatedCodexUsd } from "../codex/codex-pricing.js";
import { selectRepos } from "../repos/repo-selection.js";
import { syncRepos } from "../repos/repo-sync.js";
import { formatDuration } from "../time/duration-format.js";
import type {
  AnswerQuestionFn,
  AskRequest,
  Environment,
  ManagedRepo,
  RepoSelectionSummary,
  QuestionExecutionOptions,
  QuestionExecutionOverrides,
  RepoSelectionMode,
  StatusReporter,
  SyncReportItem
} from "../types.js";

const REPO_SELECTION_COMPARISON_TIMEOUT_MS = 90_000;
const TOKEN_COUNT_FORMATTER = new Intl.NumberFormat("en-US");

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
    throw new Error("No managed repositories matched the question. Use --repo <name> or update the Archa config.");
  }

  execution.statusReporter?.info(
    formatRepoSelectionStatus(selection.mode, selectedRepos, selectionElapsedMs)
  );
  execution.statusReporter?.info(formatRepoSyncModeStatus(options.noSync));
  const finalizedSelectionPromise = finalizeRepoSelection(selection, execution.statusReporter);

  const syncReport: SyncReportItem[] = options.noSync
    ? selectedRepos.map(repo => ({
        name: repo.name,
        directory: repo.directory,
        action: "skipped"
      }))
    : await execution.syncReposFn(selectedRepos, {
        onRepoStart(repo, action, trunkBranch) {
          execution.statusReporter?.info(
            `${action === "clone" ? "Cloning" : "Updating"} ${repo.name} (${trunkBranch})...`
          );
        },
        onRepoWait(repo, trunkBranch) {
          execution.statusReporter?.info(`Waiting for ${repo.name} (${trunkBranch}) sync already in progress...`);
        },
        onRepoResult(item) {
          const detail = item.detail ? ` (${item.detail})` : "";
          execution.statusReporter?.info(`${item.name}: ${item.action}${detail}`);
        }
      });

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

function formatSyncFailures(failedSyncs: SyncReportItem[]): string {
  return failedSyncs
    .map(item => item.detail ? `${item.name} (${item.detail})` : item.name)
    .join(", ");
}

function formatRepoSelectionStatus(
  selectionMode: RepoSelectionMode,
  selectedRepos: ManagedRepo[],
  elapsedMs: number
): string {
  const repoNames = selectedRepos.map(repo => repo.name).join(", ");
  const label = selectionMode === "requested"
    ? "Requested repos"
    : selectionMode === "all"
      ? "All repos"
      : "Resolved repos";

  return `${label} in ${formatDuration(elapsedMs)}: ${repoNames}`;
}

function formatRepoSyncModeStatus(noSync: boolean): string {
  return `Skip repo sync: ${noSync ? "yes" : "no"}`;
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
  const effortOrder: Record<string, number> = {
    none: 0,
    minimal: 1,
    low: 2,
    medium: 3,
    high: 4,
    xhigh: 5
  };
  const getModelFamilyOrder = (model: string): number => {
    if (model.includes("-mini")) {
      return 0;
    }

    return 1;
  };
  const rows = selection.runs
    .map(run => ({
      model: run.model,
      effort: run.effort,
      status: run.status ?? "ok",
      selector: `${run.model}/${run.effort}`,
      confidence: run.confidence == null ? "?" : run.confidence.toFixed(2),
      time: formatDuration(run.latencyMs),
      timeMs: run.latencyMs,
      final: run.usedForFinal ? "yes" : "no",
      input: formatTokenCount(run.usage?.inputTokens),
      output: formatTokenCount(run.usage?.outputTokens),
      usd: formatEstimatedCodexUsd(run.model, run.usage),
      repos: run.repoNames.length > 0
        ? run.repoNames.join(", ")
        : `(${formatRunStatus(run.status)})`
    }))
    .sort((left, right) =>
      getModelFamilyOrder(left.model) - getModelFamilyOrder(right.model)
      || left.model.localeCompare(right.model)
      || (effortOrder[left.effort] ?? Number.MAX_SAFE_INTEGER) - (effortOrder[right.effort] ?? Number.MAX_SAFE_INTEGER)
      || left.timeMs - right.timeMs
    );
  const selectorWidth = Math.max("selector".length, ...rows.map(row => row.selector.length));
  const confidenceWidth = Math.max("conf".length, ...rows.map(row => row.confidence.length));
  const timeWidth = Math.max("time".length, ...rows.map(row => row.time.length));
  const finalWidth = Math.max("final".length, ...rows.map(row => row.final.length));
  const inputWidth = Math.max("input".length, ...rows.map(row => row.input.length));
  const outputWidth = Math.max("output".length, ...rows.map(row => row.output.length));
  const usdWidth = Math.max("usd".length, ...rows.map(row => formatUsdDisplay(row.usd).length));
  const formatRow = (row: {
    selector: string;
    confidence: string;
    time: string;
    final: string;
    input: string;
    output: string;
    usd?: string | null;
    repos: string;
  }): string => [
    row.selector.padEnd(selectorWidth),
    row.confidence.padEnd(confidenceWidth),
    row.time.padEnd(timeWidth),
    row.final.padEnd(finalWidth),
    row.input.padEnd(inputWidth),
    row.output.padEnd(outputWidth),
    formatUsdDisplay(row.usd).padEnd(usdWidth),
    row.repos
  ].join("  ");

  return [
    "Repo selection comparison:",
    formatRow({
      selector: "selector",
      confidence: "conf",
      time: "time",
      final: "final",
      input: "input",
      output: "output",
      usd: "usd",
      repos: "repos"
    }),
    ...rows.map(formatRow)
  ].join("\n");
}

function formatTokenCount(value: number | null | undefined): string {
  if (value == null) {
    return "?";
  }

  return TOKEN_COUNT_FORMATTER.format(value);
}

function formatUsdDisplay(value: string | null | undefined): string {
  if (!value) {
    return "?";
  }

  return value;
}

function formatRunStatus(status: string | null | undefined): string {
  if (status === "failed") {
    return "failed";
  }

  if (status === "timed_out") {
    return "timed out";
  }

  if (status === "invalid") {
    return "invalid";
  }

  return "ok";
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
