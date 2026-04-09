import fs from "node:fs";

import { resolveAnswerAudience } from "./answer-audience.js";
import { loadConfig } from "../config/config.js";
import { getCodexTimeoutMs, runCodexQuestion } from "../codex/codex-runner.js";
import { selectRepos } from "../repos/repo-selection.js";
import { syncRepos } from "../repos/repo-sync.js";
import type {
  AnswerQuestionFn,
  AskRequest,
  Environment,
  ManagedRepo,
  QuestionExecutionOptions,
  QuestionExecutionOverrides,
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
  const selectedRepos = execution.selectReposFn(config, options.question, options.repoNames);
  const audience = resolveAnswerAudience(options.audience);

  if (selectedRepos.length === 0) {
    throw new Error("No managed repositories matched the question. Use --repo <name> or update the Archa config.");
  }

  execution.statusReporter?.info(`Selected repos: ${selectedRepos.map(repo => repo.name).join(", ")}`);

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
    runCodexQuestionFn: runCodexQuestion
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
    "runCodexQuestionFn"
  ].some(key => key in value);
}
