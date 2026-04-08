import fs from "node:fs";

import { resolveAnswerAudience } from "./answer-audience.js";
import { loadConfig } from "../config/config.js";
import { getCodexTimeoutMs, runCodexQuestion } from "../codex/codex-runner.js";
import { selectRepos } from "../repos/repo-selection.js";
import { syncRepos } from "../repos/repo-sync.js";
import { formatDuration } from "../time/duration-format.js";
import type {
  AnswerQuestionFn,
  AskRequest,
  Environment,
  ManagedRepo,
  QuestionExecutionOptions,
  QuestionExecutionOverrides,
  RepoSelectionMode,
  StatusReporter,
  SyncReportItem
} from "../types.js";

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
  const selection = await execution.selectReposFn(config, options.question, options.repoNames);
  const selectionElapsedMs = execution.nowFn() - selectionStartedAt;
  const selectedRepos = selection.repos;

  if (selectedRepos.length === 0) {
    throw new Error("No managed repositories matched the question. Use --repo <name> or update the Archa config.");
  }

  execution.statusReporter?.info(
    formatRepoSelectionStatus(selection.mode, selectedRepos, selectionElapsedMs)
  );
  execution.statusReporter?.info(formatRepoSyncModeStatus(options.noSync));

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
    return {
      mode: "retrieval-only",
      question: options.question,
      selectedRepos,
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

  return {
    mode: "answer",
    question: options.question,
    selectedRepos,
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

  if (legacyStatusReporter || !looksLikeExecutionOptions(envOrExecution)) {
    return {
      ...defaultExecution,
      env: looksLikeExecutionOptions(envOrExecution) ? process.env : envOrExecution || process.env,
      statusReporter: legacyStatusReporter,
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
