import fs from "node:fs";

import { resolveAnswerAudience } from "./answer-audience.js";
import { loadConfig } from "../config/config.js";
import { getCodexTimeoutMs, runCodexQuestion } from "../codex/codex-runner.js";
import { resolveManagedRepos } from "../repos/repo-filter.js";
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
  const audience = resolveAnswerAudience(options.audience);
  const selectedRepos = resolveManagedRepos(config, options.repoNames);

  if (selectedRepos.length === 0) {
    throw new Error('No managed repos are configured. Run "archa config discover-github" or add repos to the repo catalog.');
  }

  if (options.repoNames && options.repoNames.length > 0) {
    execution.statusReporter?.info(
      formatRequestedRepoScopeStatus(options.repoNames, selectedRepos)
    );
  }
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
    repoCatalogPath: config.repoCatalogPath,
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

function formatRequestedRepoScopeStatus(
  requestedRepoNames: string[],
  selectedRepos: ManagedRepo[]
): string {
  const repoNames = selectedRepos.map(repo => repo.name).join(", ");
  return `Requested repos: ${requestedRepoNames.join(", ")} -> ${repoNames}`;
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
    syncReposFn: syncRepos,
    existsSyncFn: fs.existsSync,
    getCodexTimeoutMsFn: getCodexTimeoutMs,
    runCodexQuestionFn: runCodexQuestion,
    nowFn: Date.now
  };
  const hasExecutionOverrides = looksLikeExecutionOptions(envOrExecution);

  if (legacyStatusReporter) {
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
    "syncReposFn",
    "existsSyncFn",
    "getCodexTimeoutMsFn",
    "runCodexQuestionFn",
    "nowFn"
  ].some(key => key in value);
}
