import path from "node:path";

import { runCodexPrompt } from "../codex/codex-runner.js";
import type { LoadedConfig, ManagedRepo, RepoClassification, RepoSelectionResult } from "../types.js";

const MAX_AUTOMATIC_REPOS = 4;
const DEFAULT_REPO_SELECTION_CODEX_TIMEOUT_MS = 60_000;
const REPO_SELECTION_CODEX_REASONING_EFFORT = "none";
const CLASSIFICATION_ALIASES = new Map<RepoClassification, string[]>([
  ["infra", ["infra", "infrastructure", "ops", "devops"]],
  ["library", ["library", "lib", "sdk", "module", "package"]],
  ["internal", ["internal", "private", "proprietary"]],
  ["microservice", ["microservice", "worker", "daemon"]],
  ["external", ["external", "customer-facing", "user-facing", "merchant-facing", "partner-facing", "checkout", "storefront", "onboarding", "pricing", "public"]],
  ["frontend", ["frontend", "ui", "browser", "web"]],
  ["backend", ["backend", "server", "api", "graphql", "rest"]],
  ["cli", ["cli", "terminal", "command"]]
]);

type RepoSelectionDependencies = {
  runCodexPromptFn?: typeof runCodexPrompt;
};

export async function selectRepos(
  config: LoadedConfig,
  question: string,
  requestedRepoNames: string[] | null,
  {
    runCodexPromptFn = runCodexPrompt
  }: RepoSelectionDependencies = {}
): Promise<RepoSelectionResult> {
  if (requestedRepoNames && requestedRepoNames.length > 0) {
    return {
      repos: selectRequestedRepos(config, requestedRepoNames),
      mode: "requested"
    };
  }

  const codexSelectedRepos = await selectReposWithCodex(config, question, {
    runCodexPromptFn
  }).catch(() => null);
  if (codexSelectedRepos) {
    const repos = mergeRepos(
      config.repos.filter(repo => repo.alwaysSelect),
      codexSelectedRepos
    );
    if (repos.length === 0) {
      return selectReposHeuristically(config, question, requestedRepoNames);
    }

    return {
      repos,
      mode: repos.length === config.repos.length ? "all" : "resolved"
    };
  }

  return selectReposHeuristically(config, question, requestedRepoNames);
}

export function selectReposHeuristically(
  config: LoadedConfig,
  question: string,
  requestedRepoNames: string[] | null
): RepoSelectionResult {
  if (requestedRepoNames && requestedRepoNames.length > 0) {
    return {
      repos: selectRequestedRepos(config, requestedRepoNames),
      mode: "requested"
    };
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

  if (scoredRepos.length === 0) {
    return {
      repos: [...config.repos],
      mode: "all"
    };
  }

  const repos = mergeRepos(alwaysSelectedRepos, scoredRepos);
  return {
    repos,
    mode: repos.length === config.repos.length ? "all" : "resolved"
  };
}

async function selectReposWithCodex(
  config: LoadedConfig,
  question: string,
  {
    runCodexPromptFn
  }: Required<RepoSelectionDependencies>
): Promise<ManagedRepo[] | null> {
  const result = await runCodexPromptFn({
    prompt: buildRepoSelectionPrompt(config, question),
    workingDirectory: path.dirname(config.configPath),
    reasoningEffort: REPO_SELECTION_CODEX_REASONING_EFFORT,
    timeoutMs: DEFAULT_REPO_SELECTION_CODEX_TIMEOUT_MS
  });

  return parseRepoSelectionResult(result.text, config);
}

function buildRepoSelectionPrompt(config: LoadedConfig, question: string): string {
  const repoSummaries = config.repos.map(repo => ({
    name: repo.name,
    description: repo.description,
    topics: repo.topics,
    classifications: repo.classifications,
    aliases: repo.aliases,
    alwaysSelect: repo.alwaysSelect
  }));
  const alwaysSelectedRepoNames = config.repos
    .filter(repo => repo.alwaysSelect)
    .map(repo => repo.name);

  return [
    "Select the configured repositories that should be searched to answer the user question.",
    "Prefer precision over recall. Only choose repos that are likely to contain the answer.",
    "Do not select repos because of generic words such as api, backend, internal, service, data, or platform alone.",
    "Use repo names, descriptions, topics, classifications, and aliases as the evidence.",
    "Return JSON only with exactly this shape: {\"selectedRepoNames\":[\"repo-a\",\"repo-b\"]}.",
    "Use configured repo names exactly as provided.",
    "Return an empty array when no extra repos are clearly relevant.",
    alwaysSelectedRepoNames.length > 0
      ? `Repos marked alwaysSelect are already included automatically: ${alwaysSelectedRepoNames.join(", ")}.`
      : "There are no alwaysSelect repos.",
    "",
    `Configured repositories from ${config.configPath}:`,
    JSON.stringify(repoSummaries, null, 2),
    "",
    "User question:",
    '"""',
    question,
    '"""'
  ].join("\n");
}

function parseRepoSelectionResult(text: string, config: LoadedConfig): ManagedRepo[] | null {
  if (typeof text !== "string" || text.trim() === "") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const selectedRepoNames = extractSelectedRepoNames(parsed);
  if (!selectedRepoNames) {
    return null;
  }

  if (selectedRepoNames.length === 0) {
    return [];
  }

  const requestedNames = new Set(selectedRepoNames.map(name => name.toLowerCase()));
  const selectedRepos = config.repos.filter(repo => repoMatchesAnyName(repo, requestedNames));

  return selectedRepos.length > 0 ? selectedRepos : null;
}

function extractSelectedRepoNames(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return normalizeSelectedRepoNames(value);
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const selectedRepoNames = (value as { selectedRepoNames?: unknown }).selectedRepoNames;
  if (!Array.isArray(selectedRepoNames)) {
    return null;
  }

  return normalizeSelectedRepoNames(selectedRepoNames);
}

function normalizeSelectedRepoNames(value: unknown[]): string[] | null {
  if (!value.every(item => typeof item === "string" && item.trim() !== "")) {
    return null;
  }

  return Array.from(new Set(value.map(item => (item as string).trim())));
}

function selectRequestedRepos(config: LoadedConfig, requestedRepoNames: string[]): ManagedRepo[] {
  const requested = new Set(requestedRepoNames.map(name => name.toLowerCase()));
  const selectedRepos = config.repos.filter(repo => repoMatchesAnyName(repo, requested));
  const missing = requestedRepoNames.filter(name => !selectedRepos.some(repo => repoMatchesName(repo, name)));

  if (missing.length > 0) {
    throw new Error(`Unknown managed repo(s): ${missing.join(", ")}`);
  }

  return selectedRepos;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9-]+/g) || []).filter(token => token.length >= 3);
}

function tokenizeRepoName(name: string): string[] {
  return Array.from(new Set(
    tokenize(name).flatMap(token => token.includes("-") ? [token, ...token.split("-")] : [token])
  ));
}

function repoMatchesName(repo: ManagedRepo, name: string): boolean {
  return repoMatchesAnyName(repo, new Set([name.toLowerCase()]));
}

function repoMatchesAnyName(
  repo: Pick<ManagedRepo, "name"> & {
    aliases?: string[];
  },
  requestedNames: Set<string>
): boolean {
  if (requestedNames.has(repo.name.toLowerCase())) {
    return true;
  }

  return (repo.aliases ?? []).some(alias => requestedNames.has(alias.toLowerCase()));
}

function scoreRepo(
  repo: Pick<ManagedRepo, "name" | "description"> & {
    topics?: string[];
    classifications?: RepoClassification[];
  },
  questionTokens: string[]
): number {
  const repoNameTokens = new Set(tokenizeRepoName(repo.name));
  const metadataTokens = new Set(tokenize([
    repo.description,
    ...(repo.topics ?? [])
  ].join(" ")));
  const classificationTokens = new Set(
    (repo.classifications ?? []).flatMap(classification => CLASSIFICATION_ALIASES.get(classification) || [classification])
  );

  let score = 0;
  for (const token of questionTokens) {
    if (repoNameTokens.has(token)) {
      score += 5;
    }
    if (metadataTokens.has(token)) {
      score += 3;
    }
    if (classificationTokens.has(token)) {
      score += 6;
    }
    if (repo.name.toLowerCase().includes(token)) {
      score += 4;
    }
  }

  return score;
}

function mergeRepos(preferredRepos: ManagedRepo[], fallbackRepos: ManagedRepo[]): ManagedRepo[] {
  const seenNames = new Set<string>();
  const mergedRepos: ManagedRepo[] = [];

  for (const repo of [...preferredRepos, ...fallbackRepos]) {
    if (seenNames.has(repo.name)) {
      continue;
    }

    seenNames.add(repo.name);
    mergedRepos.push(repo);
  }

  return mergedRepos;
}
