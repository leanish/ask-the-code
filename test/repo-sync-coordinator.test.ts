import { describe, expect, it, vi } from "vitest";

import { createRepoSyncCoordinator } from "../src/core/repos/repo-sync-coordinator.js";
import type { RepoSyncTarget, SyncReportItem } from "../src/core/types.js";
import { createSyncReportItem } from "./test-helpers.js";

describe("repo-sync-coordinator", () => {
  it("deduplicates concurrent syncs for the same repo and makes waiters reuse the result", async () => {
    let resolveSync: (item: SyncReportItem) => void = (_item: SyncReportItem) => {
      throw new Error("Sync resolver was not initialized.");
    };
    const syncRepoFn = vi.fn(() => new Promise<SyncReportItem>(resolve => {
      resolveSync = item => resolve(item);
    }));
    const coordinator = createRepoSyncCoordinator({ syncRepoFn });
    const callbacks = {
      onRepoWait: vi.fn(),
      onRepoResult: vi.fn()
    };
    const repo: RepoSyncTarget = {
      name: "archa",
      directory: "/workspace/repos/archa",
      defaultBranch: "main"
    };

    const firstSyncPromise = coordinator.syncRepos([repo]);
    const secondSyncPromise = coordinator.syncRepos([repo], callbacks);

    expect(syncRepoFn).toHaveBeenCalledTimes(1);
    expect(callbacks.onRepoWait).toHaveBeenCalledWith(repo, "main");

    resolveSync(createSyncReportItem({
      name: "archa",
      directory: "/workspace/repos/archa",
      action: "updated",
      detail: "main"
    }));

    await expect(firstSyncPromise).resolves.toEqual([
      {
        name: "archa",
        directory: "/workspace/repos/archa",
        action: "updated",
        detail: "main"
      }
    ]);
    await expect(secondSyncPromise).resolves.toEqual([
      {
        name: "archa",
        directory: "/workspace/repos/archa",
        action: "updated",
        detail: "main"
      }
    ]);
    expect(callbacks.onRepoResult).toHaveBeenCalledWith({
      name: "archa",
      directory: "/workspace/repos/archa",
      action: "updated",
      detail: "main"
    });
  });

  it("starts a fresh sync after the previous coordinated sync has finished", async () => {
    const syncRepoFn = vi.fn(async (repo: RepoSyncTarget) => createSyncReportItem({
      name: repo.name,
      directory: repo.directory,
      action: "updated",
      detail: "main"
    }));
    const coordinator = createRepoSyncCoordinator({ syncRepoFn });
    const repo: RepoSyncTarget = {
      name: "archa",
      directory: "/workspace/repos/archa",
      defaultBranch: "main"
    };

    await coordinator.syncRepos([repo]);
    await coordinator.syncRepos([repo]);

    expect(syncRepoFn).toHaveBeenCalledTimes(2);
  });
});
