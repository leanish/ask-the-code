import { runCodexPrompt } from "./codex-runner.js";

const DEFAULT_DISCOVERY_CODEX_TIMEOUT_MS = 60_000;
const DISCOVERY_CODEX_REASONING_EFFORT = "none";
const MAX_DESCRIPTION_LENGTH = 180;
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
    'Use "external" only when the repo clearly exposes an outward-facing application or service surface consumed outside its owning service or runtime.',
    'Do not use "external" for shared libraries, conventions, codecs, or repos that merely call or mention GraphQL, REST, or APIs.',
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
  const topics = normalizeTopics(parsed.topics, repoName, getTopicLimit(sizeKb));
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

function normalizeTopics(value, repoName, limit) {
  if (!Array.isArray(value)) {
    return null;
  }

  const excludedTokens = new Set(tokenizeRepoName(repoName));
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
  if (classification !== "external") {
    return true;
  }

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

function tokenizeRepoName(name) {
  return (name.toLowerCase().match(/[a-z0-9-]+/g) || [])
    .flatMap(token => token.includes("-") ? [token, ...token.split("-")] : [token])
    .filter(Boolean);
}

function getTopicLimit(sizeKb) {
  if (typeof sizeKb !== "number" || Number.isNaN(sizeKb)) {
    return 5;
  }

  if (sizeKb < 512) {
    return 3;
  }

  if (sizeKb < 5_000) {
    return 5;
  }

  return 8;
}
