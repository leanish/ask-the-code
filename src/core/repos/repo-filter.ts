import type { LoadedConfig, ManagedRepo } from "../types.js";

export function resolveManagedRepos(
  config: LoadedConfig,
  requestedRepoNames: string[] | null
): ManagedRepo[] {
  if (!requestedRepoNames || requestedRepoNames.length === 0) {
    return [...config.repos];
  }

  const requestedNames = new Set(requestedRepoNames.map(name => name.toLowerCase()));
  const selectedRepos = config.repos.filter(repo => repoMatchesAnyName(repo, requestedNames));
  const missingNames = requestedRepoNames.filter(name => !selectedRepos.some(repo => repoMatchesName(repo, name)));

  if (missingNames.length > 0) {
    throw new Error(`Unknown managed repo(s): ${missingNames.join(", ")}`);
  }

  return selectedRepos;
}

export function repoMatchesName(repo: ManagedRepo, name: string): boolean {
  return repoMatchesAnyName(repo, new Set([name.toLowerCase()]));
}

export function repoMatchesAnyName(
  repo: Pick<ManagedRepo, "name" | "aliases">,
  requestedNames: Set<string>
): boolean {
  if (requestedNames.has(repo.name.toLowerCase())) {
    return true;
  }

  return repo.aliases.some(alias => requestedNames.has(alias.toLowerCase()));
}
