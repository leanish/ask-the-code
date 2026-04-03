import fs from "node:fs";

import { loadConfig } from "./config.js";
import { getCodexTimeoutMs, runCodexQuestion } from "./codex-runner.js";
import { selectRepos } from "./repo-selection.js";
import { syncRepos } from "./repo-sync.js";

export async function answerQuestion(options, envOrExecution = process.env, legacyStatusReporter = null) {
  const execution = normalizeExecutionOptions(envOrExecution, legacyStatusReporter);
  const config = await execution.loadConfigFn(execution.env);
  const selectedRepos = execution.selectReposFn(config, options.question, options.repoNames);

  if (selectedRepos.length === 0) {
    throw new Error("No managed repositories matched the question. Use --repo <name> or update the Archa config.");
  }

  execution.statusReporter?.info(`Selected repos: ${selectedRepos.map(repo => repo.name).join(", ")}`);

  const syncReport = options.noSync
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
}

function formatSyncFailures(failedSyncs) {
  return failedSyncs
    .map(item => item.detail ? `${item.name} (${item.detail})` : item.name)
    .join(", ");
}

function normalizeExecutionOptions(envOrExecution, legacyStatusReporter) {
  if (legacyStatusReporter || !looksLikeExecutionOptions(envOrExecution)) {
    return {
      env: envOrExecution || process.env,
      statusReporter: legacyStatusReporter,
      loadConfigFn: loadConfig,
      selectReposFn: selectRepos,
      syncReposFn: syncRepos,
      existsSyncFn: fs.existsSync,
      getCodexTimeoutMsFn: getCodexTimeoutMs,
      runCodexQuestionFn: runCodexQuestion
    };
  }

  return {
    env: process.env,
    statusReporter: null,
    loadConfigFn: loadConfig,
    selectReposFn: selectRepos,
    syncReposFn: syncRepos,
    existsSyncFn: fs.existsSync,
    getCodexTimeoutMsFn: getCodexTimeoutMs,
    runCodexQuestionFn: runCodexQuestion,
    ...envOrExecution
  };
}

function looksLikeExecutionOptions(value) {
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
