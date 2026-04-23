type RepoIdentifierTarget = {
  name: string;
  aliases?: string[] | undefined;
};

export function getGithubRepoIdentityFromUrl(url: string | undefined): string | null {
  if (typeof url !== "string" || url.trim() === "") {
    return null;
  }

  const match = url.trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) {
    return null;
  }

  return `${match[1]}/${match[2]}`;
}

export function selectReposByRequestedNames<T extends RepoIdentifierTarget>(
  repos: T[],
  requestedRepoNames: string[]
): T[] {
  const requestedNames = new Set(requestedRepoNames.map(name => name.toLowerCase()));
  const selectedRepos = repos.filter(repo => repoMatchesAnyName(repo, requestedNames));
  const missingNames = requestedRepoNames.filter(name => !selectedRepos.some(repo => repoMatchesName(repo, name)));

  if (missingNames.length > 0) {
    throw new Error(`Unknown managed repo(s): ${missingNames.join(", ")}`);
  }

  return selectedRepos;
}

export function repoMatchesAnyName(repo: RepoIdentifierTarget, requestedNames: ReadonlySet<string>): boolean {
  if (requestedNames.has(repo.name.toLowerCase())) {
    return true;
  }

  return (repo.aliases ?? []).some(alias => requestedNames.has(alias.toLowerCase()));
}

function repoMatchesName(repo: RepoIdentifierTarget, name: string): boolean {
  return repoMatchesAnyName(repo, new Set([name.toLowerCase()]));
}
