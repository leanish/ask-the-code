const MAX_AUTOMATIC_REPOS = 4;

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9-]+/g) || []).filter(token => token.length >= 3);
}

export function selectRepos(config, question, requestedRepoNames) {
  if (requestedRepoNames && requestedRepoNames.length > 0) {
    const requested = new Set(requestedRepoNames.map(name => name.toLowerCase()));
    const selectedRepos = config.repos.filter(repo => repoMatchesAnyName(repo, requested));
    const missing = requestedRepoNames.filter(name => !selectedRepos.some(repo => repoMatchesName(repo, name)));

    if (missing.length > 0) {
      throw new Error(`Unknown managed repo(s): ${missing.join(", ")}`);
    }

    return selectedRepos;
  }

  const questionTokens = tokenize(question);
  const alwaysSelectedRepos = config.repos.filter(repo => repo.alwaysSelect);
  const scoredRepos = config.repos
    .map((repo, index) => ({
      repo,
      index,
      score: scoreRepo(repo, questionTokens)
    }))
    .filter(entry => entry.score > 0 && !entry.repo.alwaysSelect)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_AUTOMATIC_REPOS)
    .map(entry => entry.repo);

  if (scoredRepos.length === 0 && alwaysSelectedRepos.length === 0) {
    return [...config.repos];
  }

  return mergeRepos(alwaysSelectedRepos, scoredRepos);
}

function repoMatchesName(repo, name) {
  return repoMatchesAnyName(repo, new Set([name.toLowerCase()]));
}

function repoMatchesAnyName(repo, requestedNames) {
  if (requestedNames.has(repo.name.toLowerCase())) {
    return true;
  }

  return (repo.aliases || []).some(alias => requestedNames.has(alias.toLowerCase()));
}

function scoreRepo(repo, questionTokens) {
  const haystackTokens = new Set(tokenize([
    repo.name,
    repo.description,
    ...(repo.topics || [])
  ].join(" ")));

  let score = 0;
  for (const token of questionTokens) {
    if (haystackTokens.has(token)) {
      score += 3;
    }
    if (repo.name.toLowerCase().includes(token)) {
      score += 4;
    }
  }

  return score;
}

function mergeRepos(preferredRepos, fallbackRepos) {
  const seenNames = new Set();
  const mergedRepos = [];

  for (const repo of [...preferredRepos, ...fallbackRepos]) {
    if (seenNames.has(repo.name)) {
      continue;
    }

    seenNames.add(repo.name);
    mergedRepos.push(repo);
  }

  return mergedRepos;
}
