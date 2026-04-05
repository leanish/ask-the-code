const GITHUB_API_URL = "https://api.github.com";
const PAGE_SIZE = 100;

export async function discoverGithubOwnerRepos({
  owner,
  env = process.env,
  fetchFn = globalThis.fetch,
  includeForks = true,
  includeArchived = false
}) {
  const normalizedOwner = normalizeOwner(owner);

  if (typeof fetchFn !== "function") {
    throw new Error("GitHub discovery requires a fetch implementation.");
  }

  const ownerSummary = await fetchGithubJson({
    fetchFn,
    env,
    path: `/users/${encodeURIComponent(normalizedOwner)}`,
    notFoundMessage: `GitHub owner not found: ${normalizedOwner}.`
  });
  const ownerType = ownerSummary.type === "Organization" ? "Organization" : "User";
  const discoveredRepos = [];
  let page = 1;

  while (true) {
    const reposPage = await fetchGithubJson({
      fetchFn,
      env,
      path: getReposPath(ownerType, normalizedOwner, page)
    });

    if (!Array.isArray(reposPage)) {
      throw new Error(`Unexpected GitHub response while listing repos for ${normalizedOwner}.`);
    }

    discoveredRepos.push(...reposPage);

    if (reposPage.length < PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  let skippedForks = 0;
  let skippedArchived = 0;
  const repos = [];

  for (const repo of discoveredRepos) {
    if (!includeForks && repo.fork) {
      skippedForks += 1;
      continue;
    }

    if (!includeArchived && repo.archived) {
      skippedArchived += 1;
      continue;
    }

    repos.push(normalizeGithubRepo(repo));
  }

  repos.sort((left, right) => left.name.localeCompare(right.name));

  return {
    owner: normalizedOwner,
    ownerType,
    repos,
    skippedForks,
    skippedArchived
  };
}

export function planGithubRepoDiscovery(config, discovery) {
  const reposByName = new Map();
  const reposByIdentifier = new Map();

  for (const repo of config.repos) {
    reposByName.set(repo.name.toLowerCase(), repo);
    reposByIdentifier.set(repo.name.toLowerCase(), repo);
    for (const alias of repo.aliases || []) {
      reposByIdentifier.set(alias.toLowerCase(), repo);
    }
  }

  const entries = discovery.repos.map(repo => {
    const exactMatch = reposByName.get(repo.name.toLowerCase());
    if (exactMatch) {
      return {
        repo,
        status: "configured",
        configuredRepo: exactMatch,
        suggestions: buildRepoSuggestions(exactMatch, repo)
      };
    }

    const conflictingRepo = reposByIdentifier.get(repo.name.toLowerCase());
    if (conflictingRepo) {
      return {
        repo,
        status: "conflict",
        configuredRepo: conflictingRepo,
        suggestions: []
      };
    }

    return {
      repo,
      status: "new",
      configuredRepo: null,
      suggestions: []
    };
  });

  return {
    owner: discovery.owner,
    ownerType: discovery.ownerType,
    skippedForks: discovery.skippedForks,
    skippedArchived: discovery.skippedArchived,
    entries,
    reposToAdd: entries
      .filter(entry => entry.status === "new")
      .map(entry => entry.repo),
    counts: {
      discovered: entries.length,
      configured: entries.filter(entry => entry.status === "configured").length,
      new: entries.filter(entry => entry.status === "new").length,
      conflicts: entries.filter(entry => entry.status === "conflict").length,
      withSuggestions: entries.filter(entry => entry.suggestions.length > 0).length
    }
  };
}

function normalizeOwner(owner) {
  if (typeof owner !== "string" || owner.trim() === "") {
    throw new Error('GitHub discovery requires a non-empty "--owner" value.');
  }

  return owner.trim();
}

function getReposPath(ownerType, owner, page) {
  if (ownerType === "Organization") {
    return `/orgs/${encodeURIComponent(owner)}/repos?per_page=${PAGE_SIZE}&page=${page}&sort=full_name&type=all`;
  }

  return `/users/${encodeURIComponent(owner)}/repos?per_page=${PAGE_SIZE}&page=${page}&sort=full_name&type=owner`;
}

async function fetchGithubJson({ fetchFn, env, path, notFoundMessage = null }) {
  const response = await fetchFn(`${GITHUB_API_URL}${path}`, {
    headers: buildGithubHeaders(env)
  });

  if (response.status === 404 && notFoundMessage) {
    throw new Error(notFoundMessage);
  }

  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(formatGithubError(path, response.status, detail));
  }

  return response.json();
}

function buildGithubHeaders(env) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function safeReadResponseText(response) {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

function formatGithubError(path, status, detail) {
  if (!detail) {
    return `GitHub API request failed (${status}) for ${path}.`;
  }

  return `GitHub API request failed (${status}) for ${path}: ${detail}`;
}

function normalizeGithubRepo(repo) {
  return {
    name: repo.name,
    url: repo.clone_url,
    defaultBranch: repo.default_branch || "main",
    description: repo.description || "",
    topics: Array.isArray(repo.topics) ? repo.topics : []
  };
}

function buildRepoSuggestions(configuredRepo, githubRepo) {
  const suggestions = [];

  if (configuredRepo.url !== githubRepo.url) {
    suggestions.push(`review url (${configuredRepo.url} -> ${githubRepo.url})`);
  }

  if ((configuredRepo.defaultBranch || "main") !== githubRepo.defaultBranch) {
    suggestions.push(`review defaultBranch (${configuredRepo.defaultBranch} -> ${githubRepo.defaultBranch})`);
  }

  if (!configuredRepo.description && githubRepo.description) {
    suggestions.push(`add description from GitHub`);
  } else if (configuredRepo.description && githubRepo.description && configuredRepo.description !== githubRepo.description) {
    suggestions.push("review description");
  }

  const missingTopics = githubRepo.topics.filter(topic => !(configuredRepo.topics || []).includes(topic));
  if (missingTopics.length > 0) {
    suggestions.push(`consider topics: ${missingTopics.join(", ")}`);
  }

  return suggestions;
}
