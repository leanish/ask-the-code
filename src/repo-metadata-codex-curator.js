import { runCodexPrompt } from "./codex-runner.js";

const DEFAULT_DISCOVERY_CODEX_TIMEOUT_MS = 60_000;
const DISCOVERY_CODEX_REASONING_EFFORT = "none";
const MAX_DESCRIPTION_LENGTH = 180;
const SMALL_REPO_MAX_TOPICS = 3;
const MEDIUM_REPO_MAX_TOPICS = 5;
const LARGE_REPO_MAX_TOPICS = 8;
const HUGE_REPO_MAX_TOPICS = 20;
const MASSIVE_REPO_MAX_TOPICS = 30;
const ALLOWED_CLASSIFICATIONS = new Set([
  "infra",
  "library",
  "internal",
  "external",
  "frontend",
  "backend",
  "cli",
  "microservice"
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
const TOPIC_STOP_WORDS = new Set([
  "application",
  "applications",
  "based",
  "can",
  "called",
  "client",
  "com",
  "http",
  "https",
  "include",
  "includes",
  "implementation",
  "internally",
  "main",
  "most",
  "online",
  "running",
  "service",
  "services",
  "setup",
  "stores",
  "use",
  "used",
  "views",
  "web",
  "where",
  "embedded"
]);
const INFRA_TERMS = ["infra", "infrastructure", "terraform", "helm", "kubernetes", "k8s", "ops", "devops"];
const LIBRARY_TERMS = ["library", "sdk", "module", "plugin", "package"];
const MICROSERVICE_TERMS = ["microservice", "worker", "daemon"];

export async function curateRepoMetadataWithCodex({
  directory,
  repo,
  sourceRepo = {},
  inferredMetadata,
  runCodexPromptFn = runCodexPrompt
}) {
  if (typeof runCodexPromptFn !== "function") {
    return inferredMetadata;
  }

  const prompt = buildRepoMetadataCurationPrompt({
    repo,
    sourceRepo,
    inferredMetadata
  });

  const result = await runCodexPromptFn({
    prompt,
    workingDirectory: directory,
    reasoningEffort: DISCOVERY_CODEX_REASONING_EFFORT,
    timeoutMs: DEFAULT_DISCOVERY_CODEX_TIMEOUT_MS
  });
  const parsed = parseCuratedMetadata(result.text, {
    repo,
    sourceRepo,
    repoName: repo.name,
    inferredMetadata,
    sizeKb: sourceRepo.size
  });

  return parsed || inferredMetadata;
}

function buildRepoMetadataCurationPrompt({ repo, sourceRepo, inferredMetadata }) {
  const topicLimit = getTopicLimit(sourceRepo.size);

  return [
    "Curate repository discovery metadata for automatic repo selection.",
    "Inspect the current workspace and refine the draft metadata below.",
    "Prefer precision over recall. Remove weak or noisy labels instead of keeping them.",
    `Return JSON only with exactly these keys: description, topics, classifications.`,
    `description: one sentence, <= ${MAX_DESCRIPTION_LENGTH} characters, concrete and neutral.`,
    `topics: 0-${topicLimit} lowercase terms or kebab-case phrases, useful for repo selection, no repo-name repetition, no duplicates.`,
    `classifications: zero or more of ${[...ALLOWED_CLASSIFICATIONS].join(", ")}.`,
    "Use as many strong topics as the repo clearly supports up to the limit, especially for larger repos; avoid filler or generic setup words.",
    "Do not include owner/company names or generic operational words like setup, http, https, or can as topics.",
    'Use "external" only when the repo clearly exposes an outward-facing application or service surface consumed outside its owning service or runtime.',
    'Do not use "external" for shared libraries, conventions, codecs, or repos that merely call or mention GraphQL, REST, or APIs.',
    'Do not use "library" for service applications just because they build a jar, have Docker support, or contain reusable submodules.',
    'Do not use "infra" just because the repo contains Dockerfiles or docker-compose files.',
    'Do not use "microservice" unless the repo clearly presents itself as a microservice, worker, or daemon.',
    "Keep accurate draft values when they are already good. Improve them when the repo content shows a better answer.",
    "",
    "Current draft metadata:",
    JSON.stringify({
      name: repo.name,
      url: repo.url,
      defaultBranch: repo.defaultBranch,
      githubDescription: typeof sourceRepo.description === "string" ? sourceRepo.description : "",
      githubTopics: Array.isArray(sourceRepo.topics) ? sourceRepo.topics : [],
      inferredDescription: inferredMetadata.description,
      inferredTopics: inferredMetadata.topics,
      inferredClassifications: inferredMetadata.classifications
    }, null, 2)
  ].join("\n");
}

function parseCuratedMetadata(text, { repo, sourceRepo, repoName, inferredMetadata, sizeKb }) {
  if (typeof text !== "string" || text.trim() === "") {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const description = normalizeDescription(parsed.description) || inferredMetadata.description;
  const topics = normalizeTopics(parsed.topics, repoName, getTopicLimit(sizeKb), repo?.url);
  const classifications = normalizeClassifications(parsed.classifications, {
    repo,
    sourceRepo,
    inferredMetadata,
    description,
    topics: topics ?? inferredMetadata.topics
  });

  return {
    description,
    topics: topics ?? inferredMetadata.topics,
    classifications: classifications ?? inferredMetadata.classifications
  };
}

function normalizeDescription(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized === "") {
    return "";
  }

  if (normalized.length <= MAX_DESCRIPTION_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_DESCRIPTION_LENGTH - 3).trimEnd()}...`;
}

function normalizeTopics(value, repoName, limit, repoUrl = "") {
  if (!Array.isArray(value)) {
    return null;
  }

  const excludedTokens = new Set([
    ...tokenizeRepoName(repoName),
    ...parseRepoOwnerTokens(repoUrl)
  ]);
  const seen = new Set();
  const topics = [];

  for (const item of value) {
    if (topics.length >= limit) {
      break;
    }

    const normalized = normalizeTopic(item);
    if (
      normalized === ""
      || normalized.length < 3
      || seen.has(normalized)
      || excludedTokens.has(normalized)
      || TOPIC_STOP_WORDS.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    topics.push(normalized);
  }

  return topics;
}

function normalizeTopic(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeClassifications(value, context) {
  if (!Array.isArray(value)) {
    return null;
  }

  const classifications = [];
  const seen = new Set();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const normalized = item.trim().toLowerCase();
    if (
      !ALLOWED_CLASSIFICATIONS.has(normalized)
      || seen.has(normalized)
      || !shouldKeepCuratedClassification(normalized, context)
    ) {
      continue;
    }

    seen.add(normalized);
    classifications.push(normalized);
  }

  return classifications;
}

function shouldKeepCuratedClassification(classification, {
  repo,
  sourceRepo,
  inferredMetadata,
  description,
  topics
}) {
  switch (classification) {
    case "external":
      return shouldKeepExternalClassification({
        repo,
        sourceRepo,
        inferredMetadata,
        description,
        topics
      });
    case "library":
      return shouldKeepLibraryClassification({
        repo,
        sourceRepo,
        inferredMetadata,
        description,
        topics
      });
    case "infra":
      return shouldKeepKeywordClassification("infra", INFRA_TERMS, {
        repo,
        sourceRepo,
        inferredMetadata,
        description,
        topics
      });
    case "microservice":
      return shouldKeepKeywordClassification("microservice", MICROSERVICE_TERMS, {
        repo,
        sourceRepo,
        inferredMetadata,
        description,
        topics
      });
    default:
      return true;
  }
}

function shouldKeepExternalClassification({
  repo,
  sourceRepo,
  inferredMetadata,
  description,
  topics
}) {
  if (inferredMetadata.classifications.includes("external") || inferredMetadata.classifications.includes("frontend")) {
    return true;
  }

  const haystack = [
    repo?.name,
    repo?.description,
    typeof sourceRepo?.description === "string" ? sourceRepo.description : "",
    inferredMetadata.description,
    description,
    ...(Array.isArray(sourceRepo?.topics) ? sourceRepo.topics : []),
    ...(Array.isArray(inferredMetadata.topics) ? inferredMetadata.topics : []),
    ...(Array.isArray(topics) ? topics : [])
  ].join("\n").toLowerCase();

  return EXTERNAL_FACING_PHRASES.some(phrase => haystack.includes(phrase));
}

function shouldKeepLibraryClassification({
  repo,
  sourceRepo,
  inferredMetadata,
  description,
  topics
}) {
  if (inferredMetadata.classifications.includes("library")) {
    return true;
  }

  const haystack = buildClassificationHaystack({
    repo,
    sourceRepo,
    inferredMetadata,
    description,
    topics
  });

  if ((inferredMetadata.classifications.includes("backend") || inferredMetadata.classifications.includes("external"))
    && !LIBRARY_TERMS.some(term => haystack.includes(term))) {
    return false;
  }

  return LIBRARY_TERMS.some(term => haystack.includes(term));
}

function shouldKeepKeywordClassification(classification, terms, {
  repo,
  sourceRepo,
  inferredMetadata,
  description,
  topics
}) {
  if (inferredMetadata.classifications.includes(classification)) {
    return true;
  }

  const haystack = buildClassificationHaystack({
    repo,
    sourceRepo,
    inferredMetadata,
    description,
    topics
  });

  return terms.some(term => haystack.includes(term));
}

function buildClassificationHaystack({
  repo,
  sourceRepo,
  inferredMetadata,
  description,
  topics
}) {
  return [
    repo?.name,
    repo?.description,
    typeof sourceRepo?.description === "string" ? sourceRepo.description : "",
    inferredMetadata.description,
    description,
    ...(Array.isArray(sourceRepo?.topics) ? sourceRepo.topics : []),
    ...(Array.isArray(inferredMetadata.topics) ? inferredMetadata.topics : []),
    ...(Array.isArray(topics) ? topics : [])
  ].join("\n").toLowerCase();
}

function tokenizeRepoName(name) {
  return (name.toLowerCase().match(/[a-z0-9-]+/g) || [])
    .flatMap(token => token.includes("-") ? [token, ...token.split("-")] : [token])
    .filter(Boolean);
}

function parseRepoOwnerTokens(url) {
  if (typeof url !== "string" || url.trim() === "") {
    return [];
  }

  const match = url.match(/github\.com[/:]([^/]+)\/[^/]+(?:\.git)?$/i);
  if (!match) {
    return [];
  }

  return tokenizeRepoName(match[1]);
}

function getTopicLimit(sizeKb) {
  if (typeof sizeKb !== "number" || Number.isNaN(sizeKb)) {
    return MEDIUM_REPO_MAX_TOPICS;
  }

  if (sizeKb < 512) {
    return SMALL_REPO_MAX_TOPICS;
  }

  if (sizeKb < 5_000) {
    return MEDIUM_REPO_MAX_TOPICS;
  }

  if (sizeKb < 20_000) {
    return LARGE_REPO_MAX_TOPICS;
  }

  if (sizeKb < 100_000) {
    return HUGE_REPO_MAX_TOPICS;
  }

  return MASSIVE_REPO_MAX_TOPICS;
}
