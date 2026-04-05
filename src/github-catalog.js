import { spawnSync } from "node:child_process";

import { inspectRepoMetadata } from "./repo-classification-inspector.js";

const GITHUB_API_URL = "https://api.github.com";
const PAGE_SIZE = 100;
const SMALL_REPO_MAX_INFERRED_TOPICS = 3;
const MEDIUM_REPO_MAX_INFERRED_TOPICS = 5;
const LARGE_REPO_MAX_INFERRED_TOPICS = 8;
const HUGE_REPO_MAX_INFERRED_TOPICS = 20;
const MASSIVE_REPO_MAX_INFERRED_TOPICS = 30;
const CLASSIFICATION_KEYWORDS = new Map([
  ["infra", ["infra", "infrastructure", "terraform", "helm", "kubernetes", "k8s", "ansible", "devops", "ops"]],
  ["library", ["library", "lib", "sdk", "module", "plugin", "package"]],
  ["internal", ["internal", "private", "proprietary"]],
  ["microservice", ["microservice", "worker", "daemon"]],
  ["frontend", ["frontend", "ui", "browser", "react", "vue", "nextjs", "next"]],
  ["backend", ["backend", "server", "api", "graphql", "rest"]],
  ["cli", ["cli", "terminal", "command"]]
]);
const EXTERNAL_FACING_PHRASES = [
  "external",
  "customer-facing",
  "user-facing",
  "merchant-facing",
  "partner-facing",
  "storefront",
  "checkout",
  "onboarding",
  "pricing",
  "public api",
  "public-api",
  "public endpoint"
];
const STOP_WORDS = new Set([
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
  includeForks = true,
  includeArchived = false,
  inspectRepos = true,
  includeDiscoverySummary = true,
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
  const ownerSummary = await fetchGithubJson({
    fetchFn,
    token: githubToken,
    path: `/users/${encodeURIComponent(normalizedOwner)}`,
    notFoundMessage: `GitHub owner not found: ${normalizedOwner}.`
  });
  const ownerType = ownerSummary.type === "Organization" ? "Organization" : "User";
  const reposPath = await resolveReposPath({
    ownerType,
    owner: normalizedOwner,
    fetchFn,
    token: githubToken
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

    if (reposPage.length < PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  let skippedForks = 0;
  let skippedArchived = 0;
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

    eligibleRepos.push(repo);
  }

  const reposToProcess = selectedRepoNameSet
    ? eligibleRepos.filter(repo => selectedRepoNameSet.has(repo.name.toLowerCase()))
    : eligibleRepos;

  if (includeDiscoverySummary) {
    onProgress?.({
      type: "discovery-listed",
      owner: normalizedOwner,
      discoveredCount: discoveredRepos.length,
      eligibleCount: reposToProcess.length,
      skippedForks,
      skippedArchived
    });
  }

  let processedCount = 0;
  const repos = await Promise.all(
    reposToProcess.map(async repo => {
      const hydratedRepo = await hydrateGithubRepoTopics({
        owner: normalizedOwner,
        repo,
        env,
        fetchFn,
        token: githubToken,
        inspectRepoFn,
        curateWithCodex,
        inspectRepos
      });

      processedCount += 1;
      onProgress?.({
        type: inspectRepos ? "repo-curated" : "repo-processed",
        owner: normalizedOwner,
        repoName: repo.name,
        processedCount,
        totalCount: reposToProcess.length
      });

      return hydratedRepo;
    })
  );
  repos.sort((left, right) => left.name.localeCompare(right.name));

  return {
    owner: normalizedOwner,
    ownerType,
    repos,
    skippedForks,
    skippedArchived
  };
}

export function mergeGithubDiscoveryResults(baseDiscovery, refinedDiscovery) {
  const replacements = new Map(
    refinedDiscovery.repos.map(repo => [repo.name, repo])
  );

  return {
    ...baseDiscovery,
    repos: baseDiscovery.repos.map(repo => replacements.get(repo.name) || repo)
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
  const [path, query = ""] = basePath.split("?");
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

function normalizeGithubRepo(repo) {
  return {
    name: repo.name,
    url: repo.clone_url,
    defaultBranch: repo.default_branch || "main",
    description: repo.description || "",
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    classifications: []
  };
}

async function hydrateGithubRepoTopics({ owner, repo, env, fetchFn, token, inspectRepoFn, curateWithCodex, inspectRepos }) {
  const normalizedRepo = normalizeGithubRepo(repo);
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
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo.name)}/topics`
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
    || STOP_WORDS.has(normalizedToken)
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

function getMaxInferredTopics(sizeKb) {
  if (typeof sizeKb !== "number" || Number.isNaN(sizeKb)) {
    return MEDIUM_REPO_MAX_INFERRED_TOPICS;
  }

  if (sizeKb < 512) {
    return SMALL_REPO_MAX_INFERRED_TOPICS;
  }

  if (sizeKb < 5_000) {
    return MEDIUM_REPO_MAX_INFERRED_TOPICS;
  }

  if (sizeKb < 20_000) {
    return LARGE_REPO_MAX_INFERRED_TOPICS;
  }

  if (sizeKb < 100_000) {
    return HUGE_REPO_MAX_INFERRED_TOPICS;
  }

  return MASSIVE_REPO_MAX_INFERRED_TOPICS;
}

function inferRepoClassifications({ repo, sourceRepo, topics }) {
  const signals = new Set([
    ...tokenizeRepoName(repo.name, { includeCompoundRepoNames: true }),
    ...tokenizeDescription(repo.description),
    ...topics.flatMap(topic => tokenizeRaw(topic))
  ].filter(Boolean));

  const classifications = [];
  for (const [classification, keywords] of CLASSIFICATION_KEYWORDS.entries()) {
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

  const missingClassifications = githubRepo.classifications.filter(
    classification => !(configuredRepo.classifications || []).includes(classification)
  );
  if (missingClassifications.length > 0) {
    suggestions.push(`consider classifications: ${missingClassifications.join(", ")}`);
  }

  return suggestions;
}
