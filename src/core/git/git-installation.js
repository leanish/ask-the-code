import { spawnSync } from "node:child_process";

export function ensureGitInstalled({ spawnSyncFn = spawnSync } = {}) {
  const result = spawnSyncFn("git", ["--version"], {
    stdio: "ignore"
  });

  if (!result?.error) {
    return;
  }

  if (isMissingGitError(result.error)) {
    throw new Error(formatMissingGitMessage());
  }

  throw result.error;
}

export function formatMissingGitMessage() {
  return [
    "Git CLI is required but was not found on PATH.",
    'Install it with "brew install git", then retry later.'
  ].join(" ");
}

export function normalizeGitExecutionError(error) {
  if (isMissingGitError(error)) {
    return new Error(formatMissingGitMessage());
  }

  return error;
}

function isMissingGitError(error) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT"
  );
}
