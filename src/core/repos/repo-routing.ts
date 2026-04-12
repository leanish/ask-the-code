import type { RepoRoutingMetadata } from "../types.js";

const ROUTING_LIST_FIELDS = [
  "reach",
  "responsibilities",
  "owns",
  "exposes",
  "consumes",
  "workflows",
  "boundaries",
  "selectWhen",
  "selectWithOtherReposWhen"
] as const;

const GENERIC_CONSUMED_TECHNOLOGY_PATTERNS = [
  /^(?:java|jdk|jre|javascript|typescript|node|node\.js)$/iu,
  /^(?:gradle|maven|npm|yarn|pnpm|pip|poetry|bundler)$/iu,
  /^(?:guava|slf4j|log4j|logback|jackson|lombok)$/iu,
  /^(?:spring|spring boot|spring framework|play|play framework|express|koa|react|next|next\.js|vue|vue\.js|nuxt|svelte|angular|cobra)$/iu,
  /^(?:graphql|graphql api|rest|rest api|grpc)$/iu,
  /^(?:db|database|data store|datastore|queue|message queue|cache|state store|index|file storage|object storage)$/iu,
  /^(?:mongodb|postgres|postgresql|redis|elasticsearch|cassandra|kafka|kinesis|(?:aws )?sqs|(?:aws )?s3)$/iu,
  /^git$/iu
] as const;

const ROUTING_SPECIFICITY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "app",
  "application",
  "applications",
  "behavior",
  "because",
  "build",
  "code",
  "component",
  "components",
  "config",
  "configuration",
  "do",
  "for",
  "generic",
  "handles",
  "helper",
  "helpers",
  "implementation",
  "internal",
  "library",
  "need",
  "only",
  "owned",
  "owns",
  "package",
  "pages",
  "provider",
  "providers",
  "repo",
  "repos",
  "route",
  "routes",
  "select",
  "service",
  "surfaces",
  "task",
  "the",
  "this",
  "ui",
  "unrelated",
  "use",
  "used",
  "when",
  "with",
  "workflow",
  "workflows"
]);
const LOW_SIGNAL_DESCRIPTION_SURFACES = new Set([
  "admin-surface",
  "background-jobs",
  "developer-cli",
  "external-surface",
  "http-surface",
  "infrastructure",
  "internal-surface",
  "service-api",
  "shared-library",
  "webapp"
]);
const WEAK_ROUTING_DESCRIPTION_PATTERNS = [
  /\bframework based\b/iu,
  /\bimplementation of\b/iu,
  /\bwrapper for\b/iu,
  /^monorepo for\b/iu
] as const;
const OWNERSHIP_DESCRIPTION_VERB_PATTERN = /\b(?:owns|serves|handles|exposes|starts|stores|bundles|injects|builds|publishes|orchestrates|provides)\b/iu;
const HTTP_METHOD_PATTERN = /^(?:get|post|put|patch|delete|head|options)\s+\//iu;

type RoutingListField = typeof ROUTING_LIST_FIELDS[number];

export function createEmptyRepoRouting(): RepoRoutingMetadata {
  return {
    role: "",
    reach: [],
    responsibilities: [],
    owns: [],
    exposes: [],
    consumes: [],
    workflows: [],
    boundaries: [],
    selectWhen: [],
    selectWithOtherReposWhen: []
  };
}

export function normalizeRepoRouting(
  value: unknown,
  {
    repoName,
    sourcePath
  }: {
    repoName: string;
    sourcePath: string;
  }
): RepoRoutingMetadata {
  if (value == null) {
    return createEmptyRepoRouting();
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${repoName}" has non-object "routing".`);
  }

  const rawRouting = value as Record<string, unknown>;

  return {
    role: normalizeRoutingRole(rawRouting.role),
    reach: normalizeRoutingList(rawRouting.reach, "reach", repoName, sourcePath),
    responsibilities: normalizeRoutingList(rawRouting.responsibilities, "responsibilities", repoName, sourcePath),
    owns: normalizeRoutingList(rawRouting.owns, "owns", repoName, sourcePath),
    exposes: normalizeRoutingList(rawRouting.exposes, "exposes", repoName, sourcePath),
    consumes: normalizeRoutingList(rawRouting.consumes, "consumes", repoName, sourcePath),
    workflows: normalizeRoutingList(rawRouting.workflows, "workflows", repoName, sourcePath),
    boundaries: normalizeRoutingList(rawRouting.boundaries, "boundaries", repoName, sourcePath),
    selectWhen: normalizeRoutingList(rawRouting.selectWhen, "selectWhen", repoName, sourcePath),
    selectWithOtherReposWhen: normalizeRoutingList(
      rawRouting.selectWithOtherReposWhen,
      "selectWithOtherReposWhen",
      repoName,
      sourcePath
    )
  };
}

export function hasRepoRoutingContent(routing: RepoRoutingMetadata | null | undefined): boolean {
  if (!routing) {
    return false;
  }

  if (routing.role.trim() !== "") {
    return true;
  }

  return ROUTING_LIST_FIELDS.some(field => routing[field].length > 0);
}

export function getRepoRoutingSelectionEvidence(routing: RepoRoutingMetadata | null | undefined): string[] {
  if (!routing) {
    return [];
  }

  return [
    routing.role,
    ...routing.reach,
    ...routing.responsibilities,
    ...routing.owns,
    ...routing.exposes,
    ...filterRepoRoutingConsumes(routing.consumes),
    ...routing.workflows,
    ...routing.boundaries,
    ...routing.selectWhen,
    ...routing.selectWithOtherReposWhen
  ].filter(value => value.trim() !== "");
}

export function filterRepoRoutingConsumes(consumes: string[]): string[] {
  // Keep consumes selection-oriented rather than inventory-oriented. Generic
  // vendor and infrastructure names such as MongoDB, Redis, or SQS are too
  // noisy on their own; discovery should either qualify them with a clear
  // domain (for example "product data DB") or drop them entirely.
  return consumes.filter(consume => isSelectionRelevantConsumedTechnology(consume));
}

export function prioritizeRepoRouting(routing: RepoRoutingMetadata): RepoRoutingMetadata {
  return {
    ...routing,
    reach: routing.reach,
    responsibilities: routing.responsibilities,
    owns: prioritizeRoutingList("owns", routing.owns),
    exposes: prioritizeRoutingList("exposes", routing.exposes),
    consumes: routing.consumes,
    workflows: routing.workflows,
    boundaries: prioritizeRoutingList("boundaries", routing.boundaries),
    selectWhen: prioritizeRoutingList("selectWhen", routing.selectWhen),
    selectWithOtherReposWhen: routing.selectWithOtherReposWhen
  };
}

export function chooseRepoRoutingDescription(description: string, routing: RepoRoutingMetadata): string {
  const normalizedDescription = description.replace(/\s+/gu, " ").trim();
  if (!shouldReplaceRepoDescription(normalizedDescription)) {
    return normalizedDescription;
  }

  const synthesized = synthesizeRepoDescription(routing);
  return synthesized || normalizedDescription;
}

export function summarizeRepoRouting(routing: RepoRoutingMetadata | null | undefined): string {
  if (!routing || !hasRepoRoutingContent(routing)) {
    return "";
  }

  const parts: string[] = [];
  if (routing.role) {
    parts.push(`role=${routing.role}`);
  }

  if (routing.reach.length > 0) {
    parts.push(`reach=${routing.reach.join(",")}`);
  }

  if (routing.owns.length > 0) {
    parts.push(`owns=${routing.owns.slice(0, 4).join(",")}`);
  }

  if (routing.exposes.length > 0) {
    parts.push(`exposes=${routing.exposes.slice(0, 4).join(",")}`);
  }

  return parts.join(" ");
}

function normalizeRoutingRole(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/gu, " ").trim();
}

function normalizeRoutingList(
  value: unknown,
  label: RoutingListField,
  repoName: string,
  sourcePath: string
): string[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${repoName}" has non-array "${label}".`);
  }

  if (!value.every(item => typeof item === "string" && item.trim() !== "")) {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${repoName}" has non-string or empty ${label}.`);
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value) {
    const trimmed = item.trim();
    const normalizedKey = trimmed.toLowerCase();

    if (seen.has(normalizedKey)) {
      continue;
    }

    seen.add(normalizedKey);
    normalized.push(trimmed);
  }

  return normalized;
}

function isSelectionRelevantConsumedTechnology(value: string): boolean {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized === "") {
    return false;
  }

  return !GENERIC_CONSUMED_TECHNOLOGY_PATTERNS.some(pattern => pattern.test(normalized));
}

function prioritizeRoutingList(field: RoutingListField, values: string[]): string[] {
  return values
    .map((value, index) => ({
      value,
      index,
      score: scoreRoutingEntry(field, value)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(entry => entry.value);
}

function scoreRoutingEntry(field: RoutingListField, value: string): number {
  const normalized = value.toLowerCase();
  const specificityTokenCount = extractSpecificTokens(value).length;
  let score = Math.min(Math.max(specificityTokenCount - 2, 0), 4);

  if (HTTP_METHOD_PATTERN.test(value)) {
    score += 12;
  }

  if (value.includes("@")) {
    score += 10;
  }

  if (/^@[^/]+\/[^/]+$/u.test(value)) {
    score += 4;
  }

  if (/[{}]/u.test(value) || value.includes("*.")) {
    score += 8;
  }

  if (value.includes("*")) {
    score += 5;
  }

  if (/\b[a-z0-9.-]+\.[a-z]{2,}\b/iu.test(value)) {
    score += 7;
  }

  if (value.includes("/")) {
    score += 8;
  }

  if (field === "boundaries" && normalized.includes("only because")) {
    score -= 3;
  }

  if (normalized.includes("generic ")) {
    score -= 2;
  }

  if (normalized.includes("unrelated ")) {
    score -= 1;
  }

  return score;
}

function extractSpecificTokens(value: string): string[] {
  return [...new Set((value.match(/[a-z0-9]+/giu) || [])
    .map(token => token.toLowerCase())
    .filter(token => token.length >= 3 && !ROUTING_SPECIFICITY_STOP_WORDS.has(token)))];
}

function shouldReplaceRepoDescription(description: string): boolean {
  if (description === "") {
    return true;
  }

  if (OWNERSHIP_DESCRIPTION_VERB_PATTERN.test(description)) {
    return false;
  }

  return WEAK_ROUTING_DESCRIPTION_PATTERNS.some(pattern => pattern.test(description));
}

function synthesizeRepoDescription(routing: RepoRoutingMetadata): string {
  const orderedSurfaces = dedupeDescriptionSurfacesInOrder([
    ...routing.reach.filter(surface => !LOW_SIGNAL_DESCRIPTION_SURFACES.has(surface.toLowerCase())),
    ...routing.owns,
    ...routing.exposes
  ]);

  if (orderedSurfaces.length === 0) {
    return "";
  }

  return truncateDescription(`Owns ${joinDescriptionSurfaces(orderedSurfaces.slice(0, 3))}.`);
}

function dedupeDescriptionSurfacesInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const surfaces: string[] = [];

  for (const value of values) {
    const trimmed = value.replace(/\s+/gu, " ").trim();
    if (trimmed === "") {
      continue;
    }

    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    surfaces.push(trimmed);

    if (surfaces.length >= 6) {
      break;
    }
  }

  return surfaces;
}

function joinDescriptionSurfaces(values: string[]): string {
  if (values.length === 1) {
    return values[0] || "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function truncateDescription(value: string): string {
  if (value.length <= 180) {
    return value;
  }

  return `${value.slice(0, 177).trimEnd()}...`;
}
