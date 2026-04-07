import { spawnSync } from "node:child_process";

import { EXTERNAL_FACING_PHRASES, getMaxInferredTopics } from "./inference-constants.js";
import { inspectRepoMetadata } from "./repo-classification-inspector.js";
import { getGithubRepoDisplayIdentity } from "./repo-display-utils.js";

const GITHUB_API_URL = "https://api.github.com";
const PAGE_SIZE = 100;
const ACCESSIBLE_GITHUB_OWNER = "@accessible";
// This lightweight keyword map is intentionally narrower than the inspector-side
// heuristics. It only classifies from GitHub metadata and generic inferred topics,
// while deeper repo inspection can use richer file-system-specific signals.
const LIGHTWEIGHT_CLASSIFICATION_KEYWORDS = new Map([
  ["infra", ["infra", "infrastructure", "terraform", "helm", "kubernetes", "k8s", "ansible", "devops", "ops"]],
  ["library", ["library", "lib", "sdk", "module", "plugin", "package"]],
  ["internal", ["internal", "private", "proprietary"]],
  ["microservice", ["microservice", "worker", "daemon"]],
  ["frontend", ["frontend", "ui", "browser", "react", "vue", "nextjs", "next"]],
  ["backend", ["backend", "server", "api", "graphql", "rest"]],
  ["cli", ["cli", "terminal", "command"]]
]);
// Lightweight topic inference works from GitHub metadata only, so this stop-word
// list intentionally differs from the inspector's README/file-system-oriented list.
const LIGHTWEIGHT_TOPIC_STOP_WORDS = new Set([
  "about",
  "after",
  "against",
  "along",
  "also",
  "among",
  "and",
  "answer",
  "answering",
  "answers",
  "application",
  "applications",
  "around",
  "can",
  "called",
  "client",
  "com",
  "because",
  "based",
  "before",
  "between",
  "code",
  "does",
  "embedded",
  "engineering",
  "from",
  "for",
  "have",
  "http",
  "https",
  "include",
  "includes",
  "implementation",
  "internally",
  "into",
  "local",
  "main",
  "most",
  "online",
  "over",
  "project",
  "projects",
  "repo",
  "repository",
  "running",
  "setup",
  "shared",
  "service",
  "services",
  "stores",
  "aware",
  "that",
  "their",
  "them",
  "there",
  "these",
  "this",
  "through",
  "tool",
  "tools",
  "use",
  "used",
  "using",
  "views",
  "what",
  "when",
  "web",
  "where",
  "which",
  "while",
  "with",
  "your"
]);

export async function discoverGithubOwnerRepos({
  owner,
  env = process.env,
  fetchFn = globalThis.fetch,
  inspectRepoFn = inspectRepoMetadata,
  resolveGithubAuthTokenFn = readGithubCliAuthToken,
  curateWithCodex = true,
  onProgress = null,
  onHydratedRepo = null,
  includeForks = true,
  includeArchived = false,
  inspectRepos = true,
  hydrateMetadata = true,
  selectedRepoNames = []
}) {
  const normalizedOwner = normalizeOwner(owner);

  if (typeof fetchFn !== "function") {
    throw new Error("GitHub discovery requires a fetch implementation.");
  }

  const githubToken = await resolveGithubAuthToken({
    env,
    resolveGithubAuthTokenFn
  });
  const isAccessibleDiscovery = normalizedOwner === ACCESSIBLE_GITHUB_OWNER;
  let ownerDisplay = null;
  let ownerType;
  let reposPath;
  let sourceOwnerFallback = normalizedOwner;

  if (isAccessibleDiscovery) {
    const authenticatedUser = await fetchGithubJson({
      fetchFn,
      token: githubToken,
      path: "/user"
    });
    const authenticatedLogin = typeof authenticatedUser?.login === "string" && authenticatedUser.login.trim() !== ""
      ? authenticatedUser.login.trim()
      : "authenticated user";
    ownerDisplay = `${authenticatedLogin} + orgs`;
    ownerType = "Accessible";
    reposPath = "/user/repos?sort=full_name&affiliation=owner,organization_member&visibility=all";
    sourceOwnerFallback = authenticatedLogin;
  } else {
    const ownerSummary = await fetchGithubJson({
      fetchFn,
      token: githubToken,
      path: `/users/${encodeURIComponent(normalizedOwner)}`,
      notFoundMessage: `GitHub owner not found: ${normalizedOwner}.`
    });
    ownerType = ownerSummary.type === "Organization" ? "Organization" : "User";
    reposPath = await resolveReposPath({
      ownerType,
      owner: normalizedOwner,
      fetchFn,
      token: githubToken
    });
  }
  onProgress?.({
    type: "discovery-fetching",
    owner: normalizedOwner
  });
  const discoveredRepos = [];
  let page = 1;

  while (true) {
    const reposPage = await fetchGithubJson({
      fetchFn,
      token: githubToken,
      path: formatPagedReposPath(reposPath, page)
    });

    if (!Array.isArray(reposPage)) {
      throw new Error(`Unexpected GitHub response while listing repos for ${normalizedOwner}.`);
    }

    discoveredRepos.push(...reposPage);
    const hasMorePages = reposPage.length === PAGE_SIZE;
    if (page > 1 || hasMorePages) {
      onProgress?.({
        type: "discovery-page",
        owner: normalizedOwner,
        page,
        fetchedCount: discoveredRepos.length,
        hasMorePages
      });
    }

    if (!hasMorePages) {
      break;
    }

    page += 1;
  }

  const result = await finalizeGithubDiscovery({
    owner: normalizedOwner,
    ownerType,
    ownerDisplay,
    discoveredRepos,
    env,
    fetchFn,
    token: githubToken,
    inspectRepoFn,
    curateWithCodex,
    onProgress,
    onHydratedRepo,
    includeForks,
    includeArchived,
    inspectRepos,
    hydrateMetadata,
    selectedRepoNames,
    includeSourceMetadata: isAccessibleDiscovery,
    sourceOwnerFallback
  });
  return attachDiscoveryContext(result, {
    discoveredRepos,
    includeSourceMetadata: isAccessibleDiscovery,
    sourceOwnerFallback
  });
}

export async function refineDiscoveredGithubRepos({
  discovery,
  env = process.env,
  fetchFn = globalThis.fetch,
  inspectRepoFn = inspectRepoMetadata,
  resolveGithubAuthTokenFn = readGithubCliAuthToken,
  curateWithCodex = true,
  onProgress = null,
  onHydratedRepo = null,
  includeForks = true,
  includeArchived = false,
  inspectRepos = true,
  hydrateMetadata = true,
  selectedRepoNames = []
}) {
  const context = discovery?.discoveryContext;

  if (!context || !Array.isArray(context.discoveredRepos)) {
    throw new Error("Cannot refine GitHub discovery results after the original repo list is unavailable.");
  }

  const githubToken = await resolveGithubAuthToken({
    env,
    resolveGithubAuthTokenFn
  });

  return await finalizeGithubDiscovery({
    owner: discovery.owner,
    ownerType: discovery.ownerType,
    ownerDisplay: discovery.ownerDisplay || null,
    discoveredRepos: context.discoveredRepos,
    env,
    fetchFn,
    token: githubToken,
    inspectRepoFn,
    curateWithCodex,
    onProgress,
    onHydratedRepo,
    includeForks,
    includeArchived,
    inspectRepos,
    hydrateMetadata,
    selectedRepoNames,
    includeSourceMetadata: context.includeSourceMetadata,
    sourceOwnerFallback: context.sourceOwnerFallback
  });
}

async function hydrateReposSequentially({
  reposToProcess,
  owner,
  env,
  fetchFn,
  token,
  inspectRepoFn,
  curateWithCodex,
  inspectRepos,
  includeSourceMetadata,
  sourceOwnerFallback,
  onProgress,
  onHydratedRepo
}) {
  const repos = [];

  for (const [index, repo] of reposToProcess.entries()) {
    const hydratedRepo = await hydrateGithubRepoTopics({
      owner,
      repo,
      env,
      fetchFn,
      token,
      inspectRepoFn,
      curateWithCodex,
      inspectRepos,
      includeSourceMetadata,
      sourceOwnerFallback
    });

    onProgress?.({
      type: "repo-hydrated",
      owner,
      repoName: repo.name,
      inspectRepos,
      processedCount: index + 1,
      totalCount: reposToProcess.length
    });
    if (typeof onHydratedRepo === "function") {
      await onHydratedRepo(hydratedRepo, {
        owner,
        processedCount: index + 1,
        totalCount: reposToProcess.length
      });
    }

    repos.push(hydratedRepo);
  }

  return repos;
}

async function finalizeGithubDiscovery({
  owner,
  ownerType,
  ownerDisplay,
  discoveredRepos,
  env,
  fetchFn,
  token,
  inspectRepoFn,
  curateWithCodex,
  onProgress,
  onHydratedRepo,
  includeForks,
  includeArchived,
  inspectRepos,
  hydrateMetadata,
  selectedRepoNames,
  includeSourceMetadata,
  sourceOwnerFallback
}) {
  let skippedForks = 0;
  let skippedArchived = 0;
  let skippedDisabled = 0;
  const eligibleRepos = [];
  const selectedRepoNameSet = normalizeSelectedRepoNames(selectedRepoNames);

  for (const repo of discoveredRepos) {
    if (!includeForks && repo.fork) {
      skippedForks += 1;
      continue;
    }

    if (!includeArchived && repo.archived) {
      skippedArchived += 1;
      continue;
    }

    if (!includeArchived && repo.disabled) {
      skippedDisabled += 1;
      continue;
    }

    eligibleRepos.push(repo);
  }

  const reposToProcess = selectedRepoNameSet
    ? eligibleRepos.filter(repo => matchesSelectedRepo(repo, selectedRepoNameSet, { sourceOwnerFallback }))
    : eligibleRepos;

  onProgress?.({
    type: "discovery-listed",
    owner,
    discoveredCount: discoveredRepos.length,
    eligibleCount: reposToProcess.length,
    inspectRepos,
    hydrateMetadata,
    curateWithCodex,
    skippedForks,
    skippedArchived,
    ...(skippedDisabled > 0 ? { skippedDisabled } : {})
  });

  const repos = !hydrateMetadata
    ? reposToProcess.map(repo => normalizeGithubRepo(repo, {
        includeSourceMetadata,
        sourceOwnerFallback
      }))
    : inspectRepos
      ? await hydrateReposSequentially({
          reposToProcess,
          owner,
          env,
          fetchFn,
          token,
          inspectRepoFn,
          curateWithCodex,
          inspectRepos,
          includeSourceMetadata,
          sourceOwnerFallback,
          onProgress,
          onHydratedRepo
        })
      : await hydrateReposInParallel({
          reposToProcess,
          owner,
          env,
          fetchFn,
          token,
          inspectRepoFn,
          curateWithCodex,
          inspectRepos,
          includeSourceMetadata,
          sourceOwnerFallback,
          onProgress,
          onHydratedRepo
        });
  repos.sort((left, right) => left.name.localeCompare(right.name));

  return {
    owner,
    ...(ownerDisplay ? { ownerDisplay } : {}),
    ownerType,
    repos,
    skippedForks,
    skippedArchived,
    ...(skippedDisabled > 0 ? { skippedDisabled } : {})
  };
}

async function hydrateReposInParallel({
  reposToProcess,
  owner,
  env,
  fetchFn,
  token,
  inspectRepoFn,
  curateWithCodex,
  inspectRepos,
  includeSourceMetadata,
  sourceOwnerFallback,
  onProgress,
  onHydratedRepo
}) {
  let processedCount = 0;

  return await Promise.all(reposToProcess.map(async repo => {
    const hydratedRepo = await hydrateGithubRepoTopics({
      owner,
      repo,
      env,
      fetchFn,
      token,
      inspectRepoFn,
      curateWithCodex,
      inspectRepos,
      includeSourceMetadata,
      sourceOwnerFallback
    });

    processedCount += 1;
    onProgress?.({
      type: "repo-hydrated",
      owner,
      repoName: repo.name,
      inspectRepos,
      processedCount,
      totalCount: reposToProcess.length
    });
    if (typeof onHydratedRepo === "function") {
      await onHydratedRepo(hydratedRepo, {
        owner,
        processedCount,
        totalCount: reposToProcess.length
      });
    }

    return hydratedRepo;
  }));
}

export function mergeGithubDiscoveryPlan(basePlan, refinedPlan) {
  const refinedEntriesByName = new Map(
    refinedPlan.entries.map(entry => [getGithubDiscoveryRepoKey(entry.repo), entry])
  );

  return {
    ...basePlan,
    entries: basePlan.entries.map(entry => refinedEntriesByName.get(getGithubDiscoveryRepoKey(entry.repo)) || entry),
    reposToAdd: (basePlan.reposToAdd || []).map(
      repo => refinedEntriesByName.get(getGithubDiscoveryRepoKey(repo))?.repo || repo
    )
  };
}

export function buildAppliedGithubDiscoveryEntries(plan, selection) {
  const entriesByKey = new Map(
    plan.entries.map(entry => [getGithubDiscoveryRepoKey(entry.repo), entry])
  );

  return [
    ...selection.reposToAdd,
    ...selection.reposToOverride
  ].map(repo => entriesByKey.get(getGithubDiscoveryRepoKey(repo)) || {
    repo,
    status: "new",
    suggestions: []
  });
}

export function planGithubRepoDiscovery(config, discovery) {
  const reposByName = new Map();
  const reposByIdentifier = new Map();
  const reposByGithubIdentity = new Map();
  const discoveryNameCounts = buildDiscoveryRepoNameCounts(discovery.repos);

  for (const repo of config.repos) {
    reposByName.set(repo.name.toLowerCase(), repo);
    reposByIdentifier.set(repo.name.toLowerCase(), repo);
    const githubIdentity = getConfiguredGithubRepoIdentity(repo);
    if (githubIdentity) {
      reposByGithubIdentity.set(githubIdentity, repo);
    }
    for (const alias of repo.aliases || []) {
      reposByIdentifier.set(alias.toLowerCase(), repo);
    }
  }

  const entries = discovery.repos.map(repo => {
    const discoveryIdentity = getDiscoveryRepoIdentity(repo, {
      fallbackOwner: discovery.owner
    });
    const sameNamedConfiguredRepo = reposByName.get(repo.name.toLowerCase());
    const exactMatch = discoveryIdentity
      ? reposByGithubIdentity.get(discoveryIdentity)
      : reposByName.get(repo.name.toLowerCase());
    if (exactMatch) {
      return {
        repo,
        status: "configured",
        configuredRepo: exactMatch,
        suggestions: buildRepoSuggestions(exactMatch, repo)
      };
    }

    const qualifiedRepo = maybeQualifyDiscoveryRepo({
      repo,
      discoveryIdentity,
      discoveryNameCounts,
      sameNamedConfiguredRepo
    });
    if (qualifiedRepo) {
      return {
        repo: qualifiedRepo,
        status: "new",
        configuredRepo: null,
        suggestions: []
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
    ...(discovery.ownerDisplay ? { ownerDisplay: discovery.ownerDisplay } : {}),
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

function buildDiscoveryRepoNameCounts(repos) {
  const counts = new Map();

  for (const repo of repos) {
    const normalizedName = repo.name.toLowerCase();
    counts.set(normalizedName, (counts.get(normalizedName) || 0) + 1);
  }

  return counts;
}

function maybeQualifyDiscoveryRepo({
  repo,
  discoveryIdentity,
  discoveryNameCounts,
  sameNamedConfiguredRepo
}) {
  if (!discoveryIdentity || discoveryIdentity === repo.name.toLowerCase()) {
    return null;
  }

  const hasPlainNameCollision = (discoveryNameCounts.get(repo.name.toLowerCase()) || 0) > 1
    || (
      sameNamedConfiguredRepo
      && getConfiguredGithubRepoIdentity(sameNamedConfiguredRepo) !== discoveryIdentity
    );

  if (!hasPlainNameCollision) {
    return null;
  }

  // Owner-qualified names intentionally flow into config names so colliding
  // GitHub repos stay distinguishable in prompts and config.
  return {
    ...repo,
    name: discoveryIdentity
  };
}

function getConfiguredGithubRepoIdentity(repo) {
  if (typeof repo?.sourceFullName === "string" && repo.sourceFullName.trim() !== "") {
    return repo.sourceFullName.trim().toLowerCase();
  }

  if (typeof repo?.url !== "string" || repo.url.trim() === "") {
    return "";
  }

  const match = repo.url.trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) {
    return "";
  }

  return `${match[1]}/${match[2]}`.toLowerCase();
}

function getDiscoveryRepoIdentity(repo, {
  fallbackOwner = null
} = {}) {
  if (typeof repo?.sourceFullName === "string" && repo.sourceFullName.trim() !== "") {
    return repo.sourceFullName.trim().toLowerCase();
  }

  if (typeof repo?.full_name === "string" && repo.full_name.trim() !== "") {
    return repo.full_name.trim().toLowerCase();
  }

  if (!fallbackOwner || typeof repo?.name !== "string" || repo.name.trim() === "") {
    return "";
  }

  return `${fallbackOwner}/${repo.name}`.toLowerCase();
}

function normalizeOwner(owner) {
  if (typeof owner !== "string" || owner.trim() === "") {
    throw new Error('GitHub discovery requires a non-empty "--owner" value.');
  }

  const trimmedOwner = owner.trim();
  return trimmedOwner.toLowerCase() === ACCESSIBLE_GITHUB_OWNER
    ? ACCESSIBLE_GITHUB_OWNER
    : trimmedOwner;
}

async function resolveReposPath({ ownerType, owner, fetchFn, token }) {
  if (ownerType === "Organization") {
    return `/orgs/${encodeURIComponent(owner)}/repos?sort=full_name&type=all`;
  }

  if (!token) {
    return `/users/${encodeURIComponent(owner)}/repos?sort=full_name&type=owner`;
  }

  const authenticatedUser = await fetchGithubJson({
    fetchFn,
    token,
    path: "/user"
  });
  const authenticatedLogin = typeof authenticatedUser?.login === "string"
    ? authenticatedUser.login.trim().toLowerCase()
    : "";

  if (authenticatedLogin === owner.toLowerCase()) {
    return "/user/repos?sort=full_name&affiliation=owner&visibility=all";
  }

  return `/users/${encodeURIComponent(owner)}/repos?sort=full_name&type=owner`;
}

function formatPagedReposPath(basePath, page) {
  const queryIndex = basePath.indexOf("?");
  const path = queryIndex === -1 ? basePath : basePath.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : basePath.slice(queryIndex + 1);
  const querySuffix = query ? `&${query}` : "";
  return `${path}?per_page=${PAGE_SIZE}&page=${page}${querySuffix}`;
}

async function fetchGithubJson({ fetchFn, token, path, notFoundMessage = null }) {
  const response = await fetchFn(`${GITHUB_API_URL}${path}`, {
    headers: buildGithubHeaders(token)
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

function buildGithubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

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
  if (isGithubRateLimitError(status, detail)) {
    return `GitHub API rate limit exceeded while requesting ${path}. Authenticate discovery with GH_TOKEN or GITHUB_TOKEN, or retry later.`;
  }

  if (!detail) {
    return `GitHub API request failed (${status}) for ${path}.`;
  }

  return `GitHub API request failed (${status}) for ${path}: ${detail}`;
}

function isGithubRateLimitError(status, detail) {
  if ((status !== 403 && status !== 429) || !detail) {
    return false;
  }

  return detail.toLowerCase().includes("rate limit exceeded");
}

async function resolveGithubAuthToken({ env, resolveGithubAuthTokenFn }) {
  const envToken = env.GH_TOKEN || env.GITHUB_TOKEN;

  if (typeof envToken === "string" && envToken.trim() !== "") {
    return envToken.trim();
  }

  if (typeof resolveGithubAuthTokenFn !== "function") {
    return null;
  }

  try {
    const resolvedToken = await resolveGithubAuthTokenFn();
    return typeof resolvedToken === "string" && resolvedToken.trim() !== ""
      ? resolvedToken.trim()
      : null;
  } catch {
    return null;
  }
}

function readGithubCliAuthToken({ spawnSyncFn = spawnSync } = {}) {
  const result = spawnSyncFn("gh", ["auth", "token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return typeof result.stdout === "string" ? result.stdout.trim() : null;
}

function normalizeGithubRepo(repo, {
  includeSourceMetadata = false,
  sourceOwnerFallback = null
} = {}) {
  const normalizedRepo = {
    name: repo.name,
    url: repo.clone_url,
    defaultBranch: repo.default_branch || "main",
    description: repo.description || "",
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    classifications: []
  };

  if (!includeSourceMetadata) {
    return normalizedRepo;
  }

  const sourceOwner = typeof repo.owner?.login === "string" && repo.owner.login.trim() !== ""
    ? repo.owner.login.trim()
    : sourceOwnerFallback;

  return {
    ...normalizedRepo,
    sourceOwner,
    sourceFullName: typeof repo.full_name === "string" && repo.full_name.trim() !== ""
      ? repo.full_name.trim()
      : sourceOwner
        ? `${sourceOwner}/${repo.name}`
        : repo.name
  };
}

async function hydrateGithubRepoTopics({
  owner,
  repo,
  env,
  fetchFn,
  token,
  inspectRepoFn,
  curateWithCodex,
  inspectRepos,
  includeSourceMetadata,
  sourceOwnerFallback
}) {
  const normalizedRepo = normalizeGithubRepo(repo, {
    includeSourceMetadata,
    sourceOwnerFallback
  });
  const inspectedMetadata = inspectRepos
    ? await safeInspectMetadata(inspectRepoFn, {
        repo: normalizedRepo,
        sourceRepo: repo,
        env,
        useCodexCleanup: curateWithCodex
      })
    : emptyInspectionMetadata();
  const description = normalizedRepo.description || inspectedMetadata.description || "";
  const repoWithDescription = {
    ...normalizedRepo,
    description
  };

  if (normalizedRepo.topics.length > 0) {
    const topics = resolveTopics({
      rawGithubTopics: normalizedRepo.topics,
      repo: repoWithDescription,
      sizeKb: repo.size,
      inspectedTopics: inspectedMetadata.topics
    });
    const classifications = mergeClassifications(
      inferRepoClassifications({
        repo: repoWithDescription,
        sourceRepo: repo,
        topics
      }),
      inspectedMetadata.classifications
    );
    return {
      ...repoWithDescription,
      topics,
      classifications
    };
  }

  const topicsResponse = await fetchGithubJson({
    fetchFn,
    token,
    path: `/repos/${encodeURIComponent(resolveGithubTopicsOwner(repo, {
      fallbackOwner: owner,
      sourceOwnerFallback
    }))}/${encodeURIComponent(repo.name)}/topics`
  });

  const topics = resolveTopics({
    rawGithubTopics: topicsResponse?.names,
    repo: repoWithDescription,
    sizeKb: repo.size,
    inspectedTopics: inspectedMetadata.topics
  });
  const classifications = mergeClassifications(
    inferRepoClassifications({
      repo: repoWithDescription,
      sourceRepo: repo,
      topics
    }),
    inspectedMetadata.classifications
  );

  return {
    ...repoWithDescription,
    topics,
    classifications
  };
}

function resolveGithubTopicsOwner(repo, {
  fallbackOwner,
  sourceOwnerFallback = null
}) {
  if (typeof repo?.owner?.login === "string" && repo.owner.login.trim() !== "") {
    return repo.owner.login.trim();
  }

  if (typeof repo?.sourceOwner === "string" && repo.sourceOwner.trim() !== "") {
    return repo.sourceOwner.trim();
  }

  if (typeof repo?.sourceFullName === "string" && repo.sourceFullName.includes("/")) {
    return repo.sourceFullName.split("/")[0].trim();
  }

  return sourceOwnerFallback || fallbackOwner;
}

function normalizeSelectedRepoNames(selectedRepoNames) {
  if (!Array.isArray(selectedRepoNames) || selectedRepoNames.length === 0) {
    return null;
  }

  const names = selectedRepoNames
    .filter(name => typeof name === "string")
    .map(name => name.trim().toLowerCase())
    .filter(Boolean);

  return names.length > 0 ? new Set(names) : null;
}

function attachDiscoveryContext(result, {
  discoveredRepos,
  includeSourceMetadata,
  sourceOwnerFallback
}) {
  const discoveryResult = {
    ...result,
    discoveryContext: {
      discoveredRepos: discoveredRepos.map(createDiscoveryContextRepo),
      includeSourceMetadata,
      sourceOwnerFallback
    }
  };

  Object.defineProperty(discoveryResult, "toJSON", {
    value() {
      const {
        discoveryContext: _discoveryContext,
        ...serializableResult
      } = this;
      return serializableResult;
    },
    enumerable: false
  });

  return discoveryResult;
}

function createDiscoveryContextRepo(repo) {
  const normalizedContextRepo = {
    name: repo.name,
    clone_url: repo.clone_url,
    default_branch: repo.default_branch,
    description: repo.description,
    topics: Array.isArray(repo.topics) ? [...repo.topics] : [],
    size: typeof repo.size === "number" ? repo.size : 0,
    fork: repo.fork === true,
    archived: repo.archived === true,
    disabled: repo.disabled === true
  };

  if (typeof repo.full_name === "string" && repo.full_name.trim() !== "") {
    normalizedContextRepo.full_name = repo.full_name;
  }

  if (typeof repo.owner?.login === "string" && repo.owner.login.trim() !== "") {
    normalizedContextRepo.owner = {
      login: repo.owner.login
    };
  }

  return normalizedContextRepo;
}

export function getGithubDiscoveryRepoKey(repo) {
  if (typeof repo?.sourceFullName === "string" && repo.sourceFullName.trim() !== "") {
    return repo.sourceFullName.trim().toLowerCase();
  }

  if (typeof repo?.full_name === "string" && repo.full_name.trim() !== "") {
    return repo.full_name.trim().toLowerCase();
  }

  return typeof repo?.name === "string"
    ? repo.name.trim().toLowerCase()
    : "";
}

function matchesSelectedRepo(repo, selectedRepoNameSet, { sourceOwnerFallback } = {}) {
  if (!selectedRepoNameSet) {
    return true;
  }

  return getGithubRepoIdentifiers(repo, { sourceOwnerFallback })
    .some(identifier => selectedRepoNameSet.has(identifier));
}

function getGithubRepoIdentifiers(repo, { sourceOwnerFallback = null } = {}) {
  const identifiers = new Set();

  if (typeof repo?.name === "string" && repo.name.trim() !== "") {
    identifiers.add(repo.name.trim().toLowerCase());
  }

  if (typeof repo?.sourceFullName === "string" && repo.sourceFullName.trim() !== "") {
    identifiers.add(repo.sourceFullName.trim().toLowerCase());
  }

  if (typeof repo?.full_name === "string" && repo.full_name.trim() !== "") {
    identifiers.add(repo.full_name.trim().toLowerCase());
  }

  const sourceOwner = typeof repo?.sourceOwner === "string" && repo.sourceOwner.trim() !== ""
    ? repo.sourceOwner.trim()
    : typeof repo?.owner?.login === "string" && repo.owner.login.trim() !== ""
      ? repo.owner.login.trim()
      : sourceOwnerFallback;

  if (sourceOwner && typeof repo?.name === "string" && repo.name.trim() !== "") {
    identifiers.add(`${sourceOwner}/${repo.name}`.toLowerCase());
  }

  return [...identifiers];
}

function resolveTopics({ rawGithubTopics, repo, sizeKb, inspectedTopics }) {
  const githubTopics = Array.isArray(rawGithubTopics)
    ? rawGithubTopics.filter(topic => typeof topic === "string" && topic.trim() !== "")
    : [];

  if (inspectedTopics?.length > 0) {
    return mergeTopicLists(githubTopics, inspectedTopics);
  }

  return mergeTopicLists(
    githubTopics,
    inferRepoTopics(repo, { sizeKb })
  );
}

function inferRepoTopics(repo, { sizeKb }) {
  const topics = [];
  const seen = new Set();
  const maxTopics = getMaxInferredTopics(sizeKb);
  const excludedTokens = new Set([
    ...tokenizeRepoName(repo.name, { includeCompoundRepoNames: true }),
    ...parseRepoOwnerTokens(repo.url)
  ]);

  for (const token of tokenizeDescription(repo.description)) {
    addTopicToken(token, topics, seen, maxTopics, excludedTokens);
  }

  return topics.slice(0, maxTopics);
}

function mergeTopicLists(primaryTopics, secondaryTopics) {
  const topics = [];
  const seen = new Set();

  for (const topic of primaryTopics) {
    addExistingTopic(topic, topics, seen);
  }

  for (const topic of secondaryTopics) {
    addTopicToken(topic, topics, seen, Number.POSITIVE_INFINITY);
  }

  return topics;
}

function tokenizeRepoName(text, { includeCompoundRepoNames }) {
  const tokens = [];

  for (const rawToken of tokenizeRaw(text)) {
    if (includeCompoundRepoNames || !rawToken.includes("-")) {
      tokens.push(rawToken);
    }
    if (rawToken.includes("-")) {
      tokens.push(...rawToken.split("-"));
    }
  }

  return tokens;
}

function tokenizeDescription(text) {
  const tokens = [];

  for (const rawToken of tokenizeRaw(text)) {
    tokens.push(...rawToken.split("-"));
  }

  return tokens;
}

function tokenizeRaw(text) {
  return (text.toLowerCase().match(/[a-z0-9-]+/g) || []);
}

function parseRepoOwnerTokens(url) {
  if (typeof url !== "string" || url.trim() === "") {
    return [];
  }

  const match = url.match(/github\.com[/:]([^/]+)\/[^/]+(?:\.git)?$/i);
  if (!match) {
    return [];
  }

  return tokenizeRepoName(match[1], { includeCompoundRepoNames: true });
}

function addTopicToken(token, topics, seen, maxTopics, excludedTokens = new Set()) {
  if (topics.length >= maxTopics) {
    return;
  }

  const normalizedToken = token.trim().toLowerCase();

  if (
    normalizedToken.length < 3
    || LIGHTWEIGHT_TOPIC_STOP_WORDS.has(normalizedToken)
    || excludedTokens.has(normalizedToken)
    || /^\d+$/.test(normalizedToken)
    || seen.has(normalizedToken)
  ) {
    return;
  }

  seen.add(normalizedToken);
  topics.push(normalizedToken);
}

function addExistingTopic(token, topics, seen) {
  const normalizedToken = token.trim().toLowerCase();

  if (normalizedToken === "" || seen.has(normalizedToken)) {
    return;
  }

  seen.add(normalizedToken);
  topics.push(normalizedToken);
}

function inferRepoClassifications({ repo, sourceRepo, topics }) {
  const signals = new Set([
    ...tokenizeRepoName(repo.name, { includeCompoundRepoNames: true }),
    ...tokenizeDescription(repo.description),
    ...topics.flatMap(topic => tokenizeRaw(topic))
  ].filter(Boolean));

  const classifications = [];
  for (const [classification, keywords] of LIGHTWEIGHT_CLASSIFICATION_KEYWORDS.entries()) {
    if (keywords.some(keyword => signals.has(keyword))) {
      classifications.push(classification);
    }
  }

  if (hasExternalFacingEvidence({ repo, sourceRepo, topics })) {
    classifications.push("external");
  }

  return pruneConflictingClassifications(classifications);
}

function hasExternalFacingEvidence({ repo, sourceRepo, topics }) {
  const haystack = [
    repo.name,
    repo.description,
    typeof sourceRepo?.description === "string" ? sourceRepo.description : "",
    ...(Array.isArray(topics) ? topics : []),
    ...(Array.isArray(sourceRepo?.topics) ? sourceRepo.topics : [])
  ].join("\n").toLowerCase();

  return EXTERNAL_FACING_PHRASES.some(phrase => haystack.includes(phrase));
}

function pruneConflictingClassifications(classifications) {
  if (classifications.includes("internal")) {
    return classifications.filter(classification => classification !== "external");
  }

  return classifications;
}

function mergeClassifications(primary, secondary) {
  return pruneConflictingClassifications(Array.from(new Set([...(primary || []), ...(secondary || [])])));
}

async function safeInspectMetadata(inspectRepoFn, context) {
  if (typeof inspectRepoFn !== "function") {
    return emptyInspectionMetadata();
  }

  try {
    const result = await inspectRepoFn(context);

    if (Array.isArray(result)) {
      return {
        description: "",
        topics: [],
        classifications: result
      };
    }

    if (!result || typeof result !== "object") {
      return emptyInspectionMetadata();
    }

    return {
      description: typeof result.description === "string" ? result.description : "",
      topics: Array.isArray(result.topics)
        ? result.topics.filter(topic => typeof topic === "string" && topic.trim() !== "")
        : [],
      classifications: Array.isArray(result.classifications)
        ? result.classifications.filter(classification => typeof classification === "string" && classification.trim() !== "")
        : []
    };
  } catch {
    return emptyInspectionMetadata();
  }
}

function emptyInspectionMetadata() {
  return {
    description: "",
    topics: [],
    classifications: []
  };
}

function buildRepoSuggestions(configuredRepo, githubRepo) {
  const suggestions = [];
  const configuredIdentity = getGithubRepoDisplayIdentity(configuredRepo);
  const githubIdentity = getGithubRepoDisplayIdentity(githubRepo);
  const hasSameGithubIdentity = configuredIdentity && githubIdentity && configuredIdentity === githubIdentity;

  if (!hasSameGithubIdentity && configuredRepo.url !== githubRepo.url) {
    suggestions.push(`review url (${configuredRepo.url} -> ${githubRepo.url})`);
  }

  const configuredBranch = configuredRepo.defaultBranch || configuredRepo.branch || "main";
  if (configuredBranch !== githubRepo.defaultBranch) {
    suggestions.push(`review defaultBranch (${configuredBranch} -> ${githubRepo.defaultBranch})`);
  }

  if (!configuredRepo.description && githubRepo.description) {
    suggestions.push(`add description from GitHub`);
  } else if (configuredRepo.description && githubRepo.description && configuredRepo.description !== githubRepo.description) {
    suggestions.push("review description");
  }

  const configuredTopics = new Set(
    (configuredRepo.topics || [])
      .filter(topic => typeof topic === "string")
      .map(topic => topic.toLowerCase())
  );
  const missingTopics = githubRepo.topics.filter(topic => !configuredTopics.has(topic.toLowerCase()));
  if (missingTopics.length > 0) {
    suggestions.push(`consider topics: ${missingTopics.join(", ")}`);
  }

  const missingClassifications = githubRepo.classifications.filter(
    classification => !(configuredRepo.classifications || []).includes(classification)
  );
  if (missingClassifications.length > 0) {
    suggestions.push(`consider classifications: ${missingClassifications.join(", ")}`);
  }

  return suggestions;
}
