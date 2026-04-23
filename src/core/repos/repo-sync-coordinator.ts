import { DEFAULT_REPO_TRUNK_BRANCH } from "./constants.ts";
import { syncRepo } from "./repo-sync.ts";
import type { RepoSyncCallbacks, RepoSyncTarget, SyncReportItem } from "../types.ts";

type SyncRepoFn = (repo: RepoSyncTarget, callbacks?: RepoSyncCallbacks) => Promise<SyncReportItem>;

export function createRepoSyncCoordinator({ syncRepoFn = syncRepo }: { syncRepoFn?: SyncRepoFn } = {}) {
  const inFlightSyncs = new Map<string, Promise<SyncReportItem>>();

  return {
    async syncRepos(repos: RepoSyncTarget[], callbacks: RepoSyncCallbacks = {}): Promise<SyncReportItem[]> {
      const report: SyncReportItem[] = [];

      for (const repo of repos) {
        report.push(await syncRepoWithCoordination(repo, callbacks));
      }

      return report;
    }
  };

  async function syncRepoWithCoordination(repo: RepoSyncTarget, callbacks: RepoSyncCallbacks): Promise<SyncReportItem> {
    const existingSync = inFlightSyncs.get(repo.directory);
    if (existingSync) {
      callbacks.onRepoWait?.(repo, repo.defaultBranch || repo.branch || DEFAULT_REPO_TRUNK_BRANCH);
      const item = await existingSync;
      callbacks.onRepoResult?.(item);
      return item;
    }

    const syncPromise = Promise.resolve(syncRepoFn(repo, callbacks)).finally(() => {
      if (inFlightSyncs.get(repo.directory) === syncPromise) {
        inFlightSyncs.delete(repo.directory);
      }
    });

    inFlightSyncs.set(repo.directory, syncPromise);
    return syncPromise;
  }
}
