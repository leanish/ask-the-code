import { spawnSync } from "node:child_process";

type SpawnSyncFn = typeof spawnSync;
type NodeError = NodeJS.ErrnoException;

export function ensureGitInstalled({ spawnSyncFn = spawnSync }: { spawnSyncFn?: SpawnSyncFn } = {}): void {
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

export function formatMissingGitMessage(): string {
  return [
    "Git CLI is required but was not found on PATH.",
    'Install it with "brew install git", then retry later.'
  ].join(" ");
}

export function normalizeGitExecutionError(error: Error | NodeError): Error {
  if (isMissingGitError(error)) {
    return new Error(formatMissingGitMessage());
  }

  return error;
}

function isMissingGitError(error: unknown): error is NodeError {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT"
  );
}
