import { inspectRepoMetadata } from "./repo-classification-inspector.js";

const GITHUB_API_URL = "https://api.github.com";
const PAGE_SIZE = 100;
const SMALL_REPO_MAX_INFERRED_TOPICS = 3;
const MEDIUM_REPO_MAX_INFERRED_TOPICS = 5;
const LARGE_REPO_MAX_INFERRED_TOPICS = 8;
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
  "around",
  "because",
  "based",
  "before",
  "between",
  "code",
  "does",
  "engineering",
  "from",
  "for",
  "have",
  "into",
  "local",
  "over",
  "project",
  "projects",
  "repo",
  "repository",
  "shared",
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
  "using",
  "what",
  "when",
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
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    classifications: []
  };
}

async function hydrateGithubRepoTopics({ owner, repo, env, fetchFn, inspectRepoFn, curateWithCodex, inspectRepos }) {
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
    env,
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

  for (const token of tokenizeDescription(repo.description)) {
    addTopicToken(token, topics, seen, maxTopics);
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

function addTopicToken(token, topics, seen, maxTopics) {
  if (topics.length >= maxTopics) {
    return;
  }

  const normalizedToken = token.trim().toLowerCase();

  if (normalizedToken.length < 3 || STOP_WORDS.has(normalizedToken) || /^\d+$/.test(normalizedToken) || seen.has(normalizedToken)) {
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

  return LARGE_REPO_MAX_INFERRED_TOPICS;
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
