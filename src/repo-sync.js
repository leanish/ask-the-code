import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export async function syncRepos(repos, callbacks = {}) {
  const report = [];

  for (const repo of repos) {
    report.push(await syncRepo(repo, callbacks));
  }

  return report;
}

export async function syncRepo(repo, callbacks = {}) {
  try {
    const trunkBranch = getTrunkBranch(repo);

    await fs.mkdir(path.dirname(repo.directory), { recursive: true });

    if (!(await exists(repo.directory))) {
      callbacks.onRepoStart?.(repo, "clone", trunkBranch);
      await runCommand("git", [
        "clone",
        "--branch",
        trunkBranch,
        "--single-branch",
        repo.url,
        repo.directory
      ]);

      const item = createSyncItem(repo, "cloned", trunkBranch);
      callbacks.onRepoResult?.(item);
      return item;
    }

    callbacks.onRepoStart?.(repo, "update", trunkBranch);
    await runCommand("git", ["-C", repo.directory, "fetch", "origin", trunkBranch]);
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

function getTrunkBranch(repo) {
  const branch = repo.defaultBranch || repo.branch;
  if (branch !== "main" && branch !== "master") {
    throw new Error(`Unsupported branch for managed repo ${repo.name}: ${branch}. Only main/master are supported.`);
  }
  return branch;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0"
      }
    });

    let stderr = "";

    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr.trim()}`));
    });
  });
}

function createSyncItem(repo, action, detail) {
  return {
    name: repo.name,
    directory: repo.directory,
    action,
    detail
  };
}
