import { runCodexPrompt } from "../codex/codex-runner.ts";
import { createEmptyRepoRouting, filterRepoRoutingConsumes } from "../repos/repo-routing.ts";
import type { RepoRecord, RepoRoutingMetadata } from "../types.ts";

const DEFAULT_DISCOVERY_CODEX_TIMEOUT_MS = 60_000;
const DISCOVERY_CODEX_REASONING_EFFORT = "none";
const MAX_DESCRIPTION_LENGTH = 180;
const ROUTING_LIMITS = {
  reach: 5,
  responsibilities: 5,
  owns: 8,
  exposes: 12,
  consumes: 8,
  workflows: 6,
  boundaries: 5,
  selectWhen: 5,
  selectWithOtherReposWhen: 4
} as const;

type RepoMetadata = {
  description: string;
  routing: RepoRoutingMetadata;
};

type RepoMetadataPromptInput = {
  repo: RepoRecord;
  sourceRepo: Partial<RepoRecord>;
  inferredMetadata: RepoMetadata;
};

export async function curateRepoMetadataWithCodex({
  directory,
  repo,
  sourceRepo = {},
  inferredMetadata,
  runCodexPromptFn = runCodexPrompt
}: {
  directory: string;
  repo: RepoRecord;
  sourceRepo?: Partial<RepoRecord>;
  inferredMetadata: RepoMetadata;
  runCodexPromptFn?: typeof runCodexPrompt;
}): Promise<RepoMetadata> {
  if (typeof runCodexPromptFn !== "function") {
    return inferredMetadata;
  }

  const result = await runCodexPromptFn({
    prompt: buildRepoMetadataCurationPrompt({
      repo,
      sourceRepo,
      inferredMetadata
    }),
    workingDirectory: directory,
    reasoningEffort: DISCOVERY_CODEX_REASONING_EFFORT,
    timeoutMs: DEFAULT_DISCOVERY_CODEX_TIMEOUT_MS
  });

  return parseCuratedMetadata(result.text, inferredMetadata);
}

function buildRepoMetadataCurationPrompt({
  repo,
  sourceRepo,
  inferredMetadata
}: RepoMetadataPromptInput): string {
  return [
    "Curate repository discovery metadata for automatic repo selection.",
    "Inspect the current workspace and refine the draft metadata below into a compact routing card.",
    "Prefer precision over recall. Remove weak claims instead of keeping them.",
    "Select repos by ownership and exposed surfaces, not by generic keyword overlap.",
    "Treat consumed technologies as weaker evidence than owned behavior.",
    "Return JSON only with exactly these keys: description, routing.",
    `description: one sentence, <= ${MAX_DESCRIPTION_LENGTH} characters, concrete and neutral.`,
    "routing.role: short architectural label such as shared-library, infra-stack, developer-cli, service-application, platform-application, microservice, frontend-application.",
    `routing.reach: 0-${ROUTING_LIMITS.reach} concise surface labels.`,
    `routing.responsibilities: 0-${ROUTING_LIMITS.responsibilities} concrete responsibility statements.`,
    `routing.owns: 0-${ROUTING_LIMITS.owns} domains, APIs, surfaces, or behaviors this repo owns.`,
    `routing.exposes: 0-${ROUTING_LIMITS.exposes} commands, domains, endpoints, apps, or service surfaces this repo exposes.`,
    `routing.consumes: 0-${ROUTING_LIMITS.consumes} external systems, infrastructure dependencies, data stores, queues, or third-party service surfaces this repo depends on but does not own.`,
    `routing.workflows: 0-${ROUTING_LIMITS.workflows} recurring user or system workflows owned here.`,
    `routing.boundaries: 0-${ROUTING_LIMITS.boundaries} "do not select for..." statements when they materially improve routing precision.`,
    `routing.selectWhen: 0-${ROUTING_LIMITS.selectWhen} "select when..." statements tied to owned behavior or exposed surfaces.`,
    `routing.selectWithOtherReposWhen: 0-${ROUTING_LIMITS.selectWithOtherReposWhen} "use with..." statements for cross-repo flows.`,
    "Do not mention the repo name as a routing signal unless it is part of a real exposed surface.",
    "Do not add generic filler such as api, backend, service, platform, setup, tooling, or internal unless they are genuinely specific in context.",
    "Do not put general libraries, runtimes, logging frameworks, build tools, test frameworks, or web frameworks into routing.consumes.",
    "Keep accurate draft values when they are already good. Improve them when the repo content shows a better answer.",
    "",
    "Current draft metadata:",
    JSON.stringify({
      name: repo.name,
      url: repo.url,
      defaultBranch: repo.defaultBranch,
      githubDescription: typeof sourceRepo.description === "string" ? sourceRepo.description : "",
      githubTopics: Array.isArray(sourceRepo.topics) ? sourceRepo.topics : [],
      inferredMetadata
    }, null, 2)
  ].join("\n");
}

function parseCuratedMetadata(text: string, inferredMetadata: RepoMetadata): RepoMetadata {
  if (text.trim() === "") {
    return inferredMetadata;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return inferredMetadata;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return inferredMetadata;
  }

  const parsedObject = parsed as Record<string, unknown>;
  const description = normalizeDescription(parsedObject.description) || inferredMetadata.description;

  return {
    description,
    routing: normalizeRouting(parsedObject.routing, inferredMetadata.routing)
  };
}

function normalizeDescription(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized === "") {
    return "";
  }

  if (normalized.length <= MAX_DESCRIPTION_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_DESCRIPTION_LENGTH - 3).trimEnd()}...`;
}

function normalizeRouting(value: unknown, fallback: RepoRoutingMetadata): RepoRoutingMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const rawRouting = value as Record<string, unknown>;

  return {
    ...createEmptyRepoRouting(),
    ...fallback,
    role: normalizeRole(rawRouting.role) || fallback.role,
    reach: normalizeRoutingList(rawRouting.reach, ROUTING_LIMITS.reach) ?? fallback.reach,
    responsibilities: normalizeRoutingList(rawRouting.responsibilities, ROUTING_LIMITS.responsibilities) ?? fallback.responsibilities,
    owns: normalizeRoutingList(rawRouting.owns, ROUTING_LIMITS.owns) ?? fallback.owns,
    exposes: normalizeRoutingList(rawRouting.exposes, ROUTING_LIMITS.exposes) ?? fallback.exposes,
    consumes: normalizeConsumes(rawRouting.consumes, fallback.consumes),
    workflows: normalizeRoutingList(rawRouting.workflows, ROUTING_LIMITS.workflows) ?? fallback.workflows,
    boundaries: normalizeRoutingList(rawRouting.boundaries, ROUTING_LIMITS.boundaries) ?? fallback.boundaries,
    selectWhen: normalizeRoutingList(rawRouting.selectWhen, ROUTING_LIMITS.selectWhen) ?? fallback.selectWhen,
    selectWithOtherReposWhen: normalizeRoutingList(
      rawRouting.selectWithOtherReposWhen,
      ROUTING_LIMITS.selectWithOtherReposWhen
    ) ?? fallback.selectWithOtherReposWhen
  };
}

function normalizeRole(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/gu, " ").trim();
}

function normalizeRoutingList(value: unknown, limit: number): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.replace(/\s+/gu, " ").trim();
    if (trimmed === "") {
      continue;
    }

    const normalizedKey = trimmed.toLowerCase();
    if (seen.has(normalizedKey)) {
      continue;
    }

    seen.add(normalizedKey);
    normalized.push(trimmed);

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}

function normalizeConsumes(value: unknown, fallback: string[]): string[] {
  const normalized = normalizeRoutingList(value, ROUTING_LIMITS.consumes);
  return normalized == null ? fallback : filterRepoRoutingConsumes(normalized);
}
