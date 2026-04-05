import { spawnSync } from "node:child_process";

export function ensureCodexInstalled({ spawnSyncFn = spawnSync } = {}) {
  const result = spawnSyncFn("codex", ["--help"], {
    stdio: "ignore"
  });

  if (!result?.error) {
    return;
  }

  if (isMissingCodexError(result.error)) {
    throw new Error(formatMissingCodexMessage());
  }

  throw result.error;
}

export function formatMissingCodexMessage() {
  return [
    "Codex CLI is required but was not found on PATH.",
    'Install it with "brew install codex".',
    "If Codex is still not connected afterwards, complete the Codex connection/login flow and retry later."
  ].join(" ");
}

export function normalizeCodexExecutionError(error) {
  if (isMissingCodexError(error)) {
    return new Error(formatMissingCodexMessage());
  }

  return error;
}

function isMissingCodexError(error) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT"
  );
}
