import { spawnSync } from "node:child_process";

type SpawnSyncFn = typeof spawnSync;
type SpawnSyncResult = ReturnType<SpawnSyncFn>;
type NodeError = NodeJS.ErrnoException;

export function ensureCodexInstalled({ spawnSyncFn = spawnSync }: { spawnSyncFn?: SpawnSyncFn } = {}): void {
  const result = spawnSyncFn("codex", ["--help"], {
    stdio: "ignore"
  });

  if (!result?.error) {
    ensureCodexLoggedIn({ spawnSyncFn });
    return;
  }

  if (isMissingCodexError(result.error)) {
    throw new Error(formatMissingCodexMessage());
  }

  throw result.error;
}

export function formatMissingCodexMessage(): string {
  return [
    "Codex CLI is required but was not found on PATH.",
    'Install it with "brew install codex".',
    "If Codex is still not connected afterwards, complete the Codex connection/login flow and retry later."
  ].join(" ");
}

export function formatUnconfiguredCodexMessage(): string {
  return [
    "Codex CLI is installed but not ready to use.",
    'Run "codex login" or complete the Codex connection/login flow, then retry later.'
  ].join(" ");
}

export function normalizeCodexExecutionError(error: Error | NodeError): Error {
  if (isMissingCodexError(error)) {
    return new Error(formatMissingCodexMessage());
  }

  return error;
}

function isMissingCodexError(error: unknown): error is NodeError {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT"
  );
}

function ensureCodexLoggedIn({ spawnSyncFn }: { spawnSyncFn: SpawnSyncFn }): void {
  const result = spawnSyncFn("codex", ["login", "status"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result?.error) {
    if (isMissingCodexError(result.error)) {
      throw new Error(formatMissingCodexMessage());
    }

    throw result.error;
  }

  if (isLoggedInStatus(result)) {
    return;
  }

  throw new Error(formatUnconfiguredCodexMessage());
}

function isLoggedInStatus(result: SpawnSyncResult): boolean {
  if (result?.status !== 0) {
    return false;
  }

  const output = [result.stdout, result.stderr]
    .filter(value => typeof value === "string" && value.trim() !== "")
    .join("\n")
    .trim();

  return /\blogged in\b/i.test(output) && !/\bnot logged in\b/i.test(output);
}
