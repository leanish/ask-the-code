import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { pathExists } from "../fs/path-exists.ts";
import { normalizeGitExecutionError } from "../git/git-installation.ts";
import type { RepoSyncAction, RepoSyncCallbacks, RepoSyncTarget, SyncReportItem } from "../types.ts";

export async function syncRepos(repos: RepoSyncTarget[], callbacks: RepoSyncCallbacks = {}): Promise<SyncReportItem[]> {
  const report: SyncReportItem[] = [];

  for (const repo of repos) {
    report.push(await syncRepo(repo, callbacks));
  }

  return report;
}

export async function syncRepo(repo: RepoSyncTarget, callbacks: RepoSyncCallbacks = {}): Promise<SyncReportItem> {
  try {
    const trunkBranch = getTrackedBranch(repo);

    await fs.mkdir(path.dirname(repo.directory), { recursive: true });

    if (!(await pathExists(repo.directory))) {
      callbacks.onRepoStart?.(repo, "clone", trunkBranch);
      await runCommand("git", [
        "clone",
        "--branch",
        trunkBranch,
        "--single-branch",
        getCloneUrl(repo),
        repo.directory
      ]);

      const item = createSyncItem(repo, "cloned", trunkBranch);
      callbacks.onRepoResult?.(item);
      return item;
    }

    callbacks.onRepoStart?.(repo, "update", trunkBranch);
    if (await isShallowRepo(repo.directory)) {
      await runCommand("git", ["-C", repo.directory, "fetch", "--unshallow", "origin", trunkBranch]);
    } else {
      await runCommand("git", ["-C", repo.directory, "fetch", "origin", trunkBranch]);
    }
    await runCommand("git", ["-C", repo.directory, "checkout", trunkBranch]);
    await runCommand("git", ["-C", repo.directory, "merge", "--ff-only", `origin/${trunkBranch}`]);

    const item = createSyncItem(repo, "updated", trunkBranch);
    callbacks.onRepoResult?.(item);
    return item;
  } catch (error) {
    const item = createSyncItem(repo, "failed", error instanceof Error ? error.message : String(error));
    callbacks.onRepoResult?.(item);
    return item;
  }
}

function getTrackedBranch(repo: Pick<RepoSyncTarget, "name" | "defaultBranch" | "branch">): string {
  const branchValue = repo.defaultBranch || repo.branch;
  const branch = typeof branchValue === "string"
    ? branchValue.trim()
    : "";
  if (!branch) {
    throw new Error(
      `Managed repo ${repo.name} is missing a default branch. Update its config entry with defaultBranch, then retry.`
    );
  }
  return branch;
}

function getCloneUrl(repo: Pick<RepoSyncTarget, "name" | "url">): string {
  const url = typeof repo.url === "string" ? repo.url.trim() : "";
  if (!url) {
    throw new Error(`Managed repo ${repo.name} is missing a clone URL. Update its config entry with url, then retry.`);
  }

  return url;
}

async function isShallowRepo(directory: string): Promise<boolean> {
  const output = await runCommand("git", ["-C", directory, "rev-parse", "--is-shallow-repository"], {
    captureStdout: true
  });
  return output.trim() === "true";
}

async function runCommand(
  command: string,
  args: string[],
  { captureStdout = false }: { captureStdout?: boolean } = {}
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0"
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      if (captureStdout) {
        stdout += chunk.toString();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) => {
      reject(normalizeGitExecutionError(error));
    });
    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr.trim()}`));
    });
  });
}

function createSyncItem(repo: RepoSyncTarget, action: RepoSyncAction, detail?: string): SyncReportItem {
  return {
    name: repo.name,
    directory: repo.directory,
    action,
    ...(detail ? { detail } : {})
  };
}
