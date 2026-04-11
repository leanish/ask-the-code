import { createEmptyRepoRouting } from "../repos/repo-routing.js";
import type { RepoClassification, RepoRoutingMetadata } from "../types.js";

type BuildRepoRoutingDraftOptions = {
  repoName: string;
  description: string;
  topics?: string[];
  classifications?: RepoClassification[];
  routeEndpoints?: string[];
  consumedTechnologies?: string[];
  readmeLeadText?: string;
  readmeDomains?: string[];
};

const MAX_ROUTING_ITEMS = 8;

export function buildRepoRoutingDraft({
  repoName,
  description,
  topics = [],
  classifications = [],
  routeEndpoints = [],
  consumedTechnologies = [],
  readmeLeadText = "",
  readmeDomains = []
}: BuildRepoRoutingDraftOptions): RepoRoutingMetadata {
  const role = inferRepoRole(classifications);
  const reach = inferRepoReach(classifications, routeEndpoints);
  const normalizedTopics = dedupeEntries(topics, MAX_ROUTING_ITEMS);
  const normalizedEndpoints = dedupeEntries(routeEndpoints, MAX_ROUTING_ITEMS);
  const normalizedConsumes = dedupeEntries(consumedTechnologies, MAX_ROUTING_ITEMS);
  const normalizedDomains = dedupeEntries(readmeDomains, MAX_ROUTING_ITEMS);
  const responsibilities = dedupeEntries([
    description,
    readmeLeadText,
    ...describeResponsibilities(classifications, normalizedEndpoints)
  ], 5);
  const owns = normalizedTopics;
  const exposes = dedupeEntries([
    ...normalizedDomains,
    ...normalizedEndpoints
  ], MAX_ROUTING_ITEMS);
  const workflows = dedupeEntries([
    ...describeWorkflows(normalizedEndpoints, classifications)
  ], 6);
  const boundaries = describeBoundaries(classifications, normalizedConsumes);
  const selectWhen = dedupeEntries([
    ...describeSelectWhen(owns, exposes, responsibilities)
  ], 5);
  const selectWithOtherReposWhen = dedupeEntries([
    ...describeSelectWithOtherReposWhen(normalizedConsumes)
  ], 4);

  return {
    ...createEmptyRepoRouting(),
    role,
    reach,
    responsibilities,
    owns,
    exposes,
    consumes: normalizedConsumes,
    workflows,
    boundaries,
    selectWhen,
    selectWithOtherReposWhen
  };
}

export function inferRepoRole(classifications: RepoClassification[]): string {
  if (classifications.includes("infra")) {
    return "infra-stack";
  }

  if (classifications.includes("cli")) {
    return "developer-cli";
  }

  if (classifications.includes("library")) {
    return "shared-library";
  }

  if (classifications.includes("microservice")) {
    return "microservice";
  }

  if (classifications.includes("frontend") && classifications.includes("backend")) {
    return "platform-application";
  }

  if (classifications.includes("backend")) {
    return "service-application";
  }

  if (classifications.includes("frontend")) {
    return "frontend-application";
  }

  return "";
}

export function inferRepoReach(
  classifications: RepoClassification[],
  routeEndpoints: string[]
): string[] {
  const reach: string[] = [];

  if (classifications.includes("infra")) {
    reach.push("infrastructure");
  }

  if (classifications.includes("cli")) {
    reach.push("developer-cli");
  }

  if (classifications.includes("library")) {
    reach.push("shared-library");
  }

  if (classifications.includes("frontend")) {
    reach.push("webapp");
  }

  if (classifications.includes("backend")) {
    reach.push("service-api");
  }

  if (classifications.includes("external")) {
    reach.push("external-surface");
  }

  if (classifications.includes("internal")) {
    reach.push("internal-surface");
  }

  if (routeEndpoints.some(endpoint => hasHttpRouteSurface(endpoint))) {
    reach.push("http-surface");
  }

  if (routeEndpoints.some(endpoint => endpoint.includes("/admin/"))) {
    reach.push("admin-surface");
  }

  if (routeEndpoints.some(endpoint => endpoint.includes("/cron/"))) {
    reach.push("background-jobs");
  }

  return dedupeEntries(reach, 5);
}

function describeResponsibilities(classifications: RepoClassification[], routeEndpoints: string[]): string[] {
  const responsibilities: string[] = [];

  if (classifications.includes("infra")) {
    responsibilities.push("Owns infrastructure provisioning and operational runtime configuration.");
  }

  if (classifications.includes("cli")) {
    responsibilities.push("Owns a command-line interface and related operator workflows.");
  }

  if (classifications.includes("library")) {
    responsibilities.push("Provides reusable library code consumed by other applications or services.");
  }

  if (classifications.includes("backend")) {
    responsibilities.push("Owns backend behavior, request handling, and service integration logic.");
  }

  if (classifications.includes("frontend")) {
    responsibilities.push("Owns user-facing application flows and rendered UI surfaces.");
  }

  if (routeEndpoints.some(endpoint => endpoint.includes("/graphql"))) {
    responsibilities.push("Exposes GraphQL request handling for selected application surfaces.");
  }

  if (routeEndpoints.some(endpoint => endpoint.includes("/cron/"))) {
    responsibilities.push("Runs background or scheduled operational jobs.");
  }

  return responsibilities;
}

function describeWorkflows(routeEndpoints: string[], classifications: RepoClassification[]): string[] {
  const workflows: string[] = [];

  if (routeEndpoints.some(endpoint => endpoint.includes("/admin/"))) {
    workflows.push("Handles admin-facing workflows.");
  }

  if (routeEndpoints.some(endpoint => /\/orders?\b/u.test(endpoint))) {
    workflows.push("Handles order-related workflows.");
  }

  if (classifications.includes("cli")) {
    workflows.push("Handles command execution workflows.");
  }

  return workflows;
}

function describeBoundaries(
  classifications: RepoClassification[],
  consumes: string[]
): string[] {
  const boundaries: string[] = [];

  if (classifications.includes("library")) {
    boundaries.push("Do not select only because another repo depends on this library.");
  }

  if (classifications.includes("infra")) {
    boundaries.push("Do not select for application behavior unless the question is about deployed infrastructure ownership.");
  }

  if (consumes.length > 0) {
    boundaries.push("Do not select only because it consumes shared infrastructure or external services.");
  }

  return dedupeEntries(boundaries, 3);
}

function describeSelectWhen(
  owns: string[],
  exposes: string[],
  responsibilities: string[]
): string[] {
  const conditions: string[] = [];

  if (owns.length > 0) {
    conditions.push(`The question is about ${owns.slice(0, 3).join(", ")}.`);
  }

  if (exposes.length > 0) {
    conditions.push(`The question is about ${exposes.slice(0, 3).join(", ")}.`);
  }

  const firstResponsibility = responsibilities[0];
  if (typeof firstResponsibility === "string" && firstResponsibility !== "") {
    conditions.push(`The question matches responsibilities such as ${firstResponsibility.replace(/\.$/u, "")}.`);
  }

  return conditions;
}

function describeSelectWithOtherReposWhen(consumes: string[]): string[] {
  if (consumes.length === 0) {
    return [];
  }

  return [`Use with related repos when the question crosses into ${consumes.slice(0, 3).join(", ")} ownership.`];
}

function hasHttpRouteSurface(endpoint: string): boolean {
  return /^[A-Z]+\s+\//u.test(endpoint) || endpoint.includes("/graphql");
}

function dedupeEntries(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.replace(/\s+/gu, " ").trim();
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
