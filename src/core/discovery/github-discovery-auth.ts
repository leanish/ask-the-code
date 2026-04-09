import { spawnSync } from "node:child_process";

export function ensureGithubDiscoveryAuthAvailable({
  env = process.env,
  spawnSyncFn = spawnSync
}: {
  env?: NodeJS.ProcessEnv;
  spawnSyncFn?: typeof spawnSync;
} = {}): void {
  const envToken = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (typeof envToken === "string" && envToken.trim() !== "") {
    return;
  }

  const result = spawnSyncFn("gh", ["auth", "token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });

  if (result?.error) {
    if (isMissingGhError(result.error)) {
      throw new Error(formatMissingGithubDiscoveryAuthMessage());
    }

    throw result.error;
  }

  const token = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (result.status === 0 && token !== "") {
    return;
  }

  throw new Error(formatMissingGithubDiscoveryAuthMessage());
}

export function formatMissingGithubDiscoveryAuthMessage(): string {
  return [
    "GitHub discovery requires either GH_TOKEN/GITHUB_TOKEN or a usable gh CLI session.",
    'Set GH_TOKEN/GITHUB_TOKEN, or install gh with "brew install gh" and run "gh auth login", then retry later.'
  ].join(" ");
}

function isMissingGhError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT"
  );
}
