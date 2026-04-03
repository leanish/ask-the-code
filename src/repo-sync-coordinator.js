import { syncRepo } from "./repo-sync.js";

export function createRepoSyncCoordinator({ syncRepoFn = syncRepo } = {}) {
  const inFlightSyncs = new Map();

  return {
    async syncRepos(repos, callbacks = {}) {
      const report = [];

      for (const repo of repos) {
        report.push(await syncRepoWithCoordination(repo, callbacks));
      }

      return report;
    }
  };

  async function syncRepoWithCoordination(repo, callbacks) {
    const existingSync = inFlightSyncs.get(repo.directory);
    if (existingSync) {
      callbacks.onRepoWait?.(repo, repo.defaultBranch || repo.branch || "main");
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
