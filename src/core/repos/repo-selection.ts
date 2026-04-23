import path from "node:path";

import { runCodexPrompt } from "../codex/codex-runner.ts";
import { DEFAULT_CODEX_MODEL } from "../codex/constants.ts";
import { repoMatchesAnyName, selectReposByRequestedNames } from "./repo-identifiers.ts";
import { filterRepoRoutingConsumes } from "./repo-routing.ts";
import type {
  LoadedConfig,
  ManagedRepo,
  RepoSelectionCodexEffort,
  RepoSelectionResult,
  RepoSelectionStrategy,
  RepoSelectionSummary
} from "../types.ts";

const MAX_AUTOMATIC_REPOS = 4;
const DEFAULT_REPO_SELECTION_CODEX_TIMEOUT_MS = 60_000;
const REPO_SELECTION_CODEX_MODEL = DEFAULT_CODEX_MODEL;
const REPO_SELECTION_SINGLE_EFFORT: RepoSelectionCodexEffort = "none";
const REPO_SELECTION_CASCADE_EFFORTS: RepoSelectionCodexEffort[] = ["none", "minimal", "low", "medium", "high"];
const REPO_SELECTION_SHADOW_COMPARE_EFFORTS: RepoSelectionCodexEffort[] = ["none", "low", "high"];
const REPO_SELECTION_PROMPT_COMPACT_REPO_THRESHOLD = 16;
const REPO_SELECTION_PROMPT_LIMITS = {
  aliases: 4,
  reach: 4,
  responsibilities: 2,
  owns: 6,
  exposes: 6,
  consumes: 3,
  workflows: 3,
  boundaries: 3,
  selectWhen: 3,
  selectWithOtherReposWhen: 2
} as const;
const REPO_SELECTION_CONFIDENCE_THRESHOLDS: Record<RepoSelectionCodexEffort, number> = {
  none: 0.78,
  minimal: 0.74,
  low: 0.68,
  medium: 0.58,
  high: 0
};

type RepoSelectionDependencies = {
  runCodexPromptFn?: typeof runCodexPrompt;
  nowFn?: () => number;
};
type RepoSelectionOptions = {
  selectionMode?: RepoSelectionStrategy | null;
  selectionShadowCompare?: boolean;
};

type RepoSelectionRunResult = {
  effort: RepoSelectionCodexEffort;
  repoNames: string[];
  repos: ManagedRepo[] | null;
  confidence: number | null;
  latencyMs: number;
};

export async function selectRepos(
  config: LoadedConfig,
  question: string,
  requestedRepoNames: string[] | null,
  {
    selectionMode = null,
    selectionShadowCompare = false
  }: RepoSelectionOptions = {},
  {
    runCodexPromptFn = runCodexPrompt,
    nowFn = Date.now
  }: RepoSelectionDependencies = {}
): Promise<RepoSelectionResult> {
  const resolvedSelectionMode = selectionMode || "single";

  if (requestedRepoNames && requestedRepoNames.length > 0) {
    const repos = selectRequestedRepos(config, requestedRepoNames);
    return {
      repos,
      mode: "requested",
      selection: {
        mode: resolvedSelectionMode,
        shadowCompare: selectionShadowCompare,
        source: "requested",
        finalEffort: null,
        finalRepoNames: repos.map(repo => repo.name),
        runs: []
      }
    };
  }

  const automaticSelection = await selectAutomaticRepos(config, question, {
    selectionMode: resolvedSelectionMode,
    selectionShadowCompare,
    runCodexPromptFn,
    nowFn
  });

  if (automaticSelection) {
    return automaticSelection;
  }

  const heuristicSelection = selectReposHeuristically(config, question, requestedRepoNames);
  return {
    ...heuristicSelection,
    selection: {
      mode: resolvedSelectionMode,
      shadowCompare: selectionShadowCompare,
      source: "heuristic",
      finalEffort: null,
      finalRepoNames: heuristicSelection.repos.map(repo => repo.name),
      runs: []
    }
  };
}

export function selectReposHeuristically(
  config: LoadedConfig,
  question: string,
  requestedRepoNames: string[] | null
): RepoSelectionResult {
  if (requestedRepoNames && requestedRepoNames.length > 0) {
    const repos = selectRequestedRepos(config, requestedRepoNames);
    return {
      repos,
      mode: "requested",
      selection: null
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
      mode: "all",
      selection: null
    };
  }

  const repos = mergeRepos(alwaysSelectedRepos, scoredRepos);
  return {
    repos,
    mode: repos.length === config.repos.length ? "all" : "resolved",
    selection: null
  };
}

async function selectAutomaticRepos(
  config: LoadedConfig,
  question: string,
  {
    selectionMode,
    selectionShadowCompare,
    runCodexPromptFn,
    nowFn
  }: {
    selectionMode: RepoSelectionStrategy;
    selectionShadowCompare: boolean;
    runCodexPromptFn: typeof runCodexPrompt;
    nowFn: () => number;
  }
): Promise<RepoSelectionResult | null> {
  const alwaysSelectedRepos = config.repos.filter(repo => repo.alwaysSelect);
  const runPromises = new Map<RepoSelectionCodexEffort, Promise<RepoSelectionRunResult>>();
  const prompt = buildRepoSelectionPrompt(config, question);
  const getRun = (effort: RepoSelectionCodexEffort): Promise<RepoSelectionRunResult> => {
    const existingRun = runPromises.get(effort);
    if (existingRun) {
      return existingRun;
    }

    const startedAt = nowFn();
    const runPromise = runCodexPromptFn({
      prompt,
      model: REPO_SELECTION_CODEX_MODEL,
      reasoningEffort: effort,
      workingDirectory: path.dirname(config.configPath),
      timeoutMs: DEFAULT_REPO_SELECTION_CODEX_TIMEOUT_MS
    }).then(result => parseRepoSelectionRunResult(result.text, config, effort, nowFn() - startedAt))
      .catch(() => createInvalidRunResult(effort, nowFn() - startedAt));

    runPromises.set(effort, runPromise);
    return runPromise;
  };

  if (selectionShadowCompare) {
    for (const effort of REPO_SELECTION_SHADOW_COMPARE_EFFORTS) {
      void getRun(effort);
    }
  }

  let selectedRun: RepoSelectionRunResult | null = null;
  if (selectionMode === "single") {
    const singleRun = await getRun(REPO_SELECTION_SINGLE_EFFORT);
    if (isUsableCodexRun(singleRun, alwaysSelectedRepos.length, REPO_SELECTION_SINGLE_EFFORT)) {
      selectedRun = singleRun;
    }
  } else {
    for (const effort of REPO_SELECTION_CASCADE_EFFORTS) {
      const run = await getRun(effort);
      if (isUsableCodexRun(run, alwaysSelectedRepos.length, effort)) {
        selectedRun = run;
        break;
      }
    }
  }

  if (!selectedRun) {
    return null;
  }

  const repos = mergeRepos(alwaysSelectedRepos, selectedRun.repos || []);
  if (repos.length === 0) {
    return null;
  }
  const resolvedMode = repos.length === config.repos.length ? "all" : "resolved";

  const baseSelection = {
    mode: selectionMode,
    shadowCompare: selectionShadowCompare,
    source: "codex" as const,
    finalEffort: selectedRun.effort,
    finalRepoNames: repos.map(repo => repo.name)
  };
  const completedRuns = await collectCompletedRuns(runPromises, selectedRun.effort);
  const immediateSelection = {
    ...baseSelection,
    runs: buildSelectionRuns(completedRuns, selectedRun.effort)
  };
  const hasAdditionalBackgroundRuns = Array.from(runPromises.keys()).some(
    effort => !completedRuns.some(run => run.effort === effort)
  );

  const selectionPromise = hasAdditionalBackgroundRuns
    ? collectAllRuns(runPromises).then(allRuns => ({
        ...baseSelection,
        runs: buildSelectionRuns(allRuns, selectedRun?.effort ?? null)
      }))
    : null;

  if (!selectionPromise) {
    return {
      repos,
      mode: resolvedMode,
      selection: immediateSelection
    };
  }

  return {
    repos,
    mode: resolvedMode,
    selection: immediateSelection,
    selectionPromise
  };
}

export function buildRepoSelectionPrompt(config: LoadedConfig, question: string): string {
  const useCompactSummaries = config.repos.length > REPO_SELECTION_PROMPT_COMPACT_REPO_THRESHOLD;
  const repoSummaries = config.repos.map(repo => summarizeRepoForSelectionPrompt(repo, {
    compact: useCompactSummaries
  }));
  const alwaysSelectedRepoNames = config.repos
    .filter(repo => repo.alwaysSelect)
    .map(repo => repo.name);

  return [
    "Select the configured repositories that should be searched to answer the user question.",
    "Select repos by ownership and exposed surfaces, not by generic keyword overlap.",
    "Strong evidence: description, routing.role, routing.reach, routing.responsibilities, routing.owns, routing.exposes, routing.workflows, routing.selectWhen, and aliases.",
    "Weaker evidence: routing.consumes and generic ecosystem overlap.",
    "Negative evidence: routing.boundaries and routing.selectWithOtherReposWhen when the question does not cross repo boundaries.",
    "Prefer precision over recall. Only choose repos that are likely to contain the answer.",
    "Return at most 4 configured repos.",
    "Return JSON only with exactly this shape: {\"selectedRepoNames\":[\"repo-a\",\"repo-b\"],\"confidence\":0.0}.",
    "Confidence must be a number from 0.0 to 1.0 for how confident you are that the selected set is sufficient.",
    "Use configured repo names exactly as provided.",
    "Return an empty array when no extra repos are clearly relevant.",
    alwaysSelectedRepoNames.length > 0
      ? `Repos marked alwaysSelect are already included automatically: ${alwaysSelectedRepoNames.join(", ")}.`
      : "There are no alwaysSelect repos.",
    "",
    useCompactSummaries
      ? "Large repo set detected; omitting lower-signal routing fields to control prompt size."
      : "Using full routing summaries for the configured repos.",
    `Configured repositories from ${config.configPath} (one JSON object per line):`,
    ...repoSummaries.map(summary => JSON.stringify(summary)),
    "",
    "User question:",
    '"""',
    question,
    '"""'
  ].join("\n");
}

function summarizeRepoForSelectionPrompt(
  repo: ManagedRepo,
  {
    compact
  }: {
    compact: boolean;
  }
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    name: repo.name
  };
  const description = normalizePromptText(repo.description);
  if (description !== "") {
    summary.description = description;
  }

  const routing = summarizeRoutingForSelectionPrompt(repo, {
    compact
  });
  if (Object.keys(routing).length > 0) {
    summary.routing = routing;
  }

  if (repo.aliases.length > 0) {
    summary.aliases = repo.aliases.slice(0, REPO_SELECTION_PROMPT_LIMITS.aliases);
  }

  if (repo.alwaysSelect) {
    summary.alwaysSelect = true;
  }

  return summary;
}

function summarizeRoutingForSelectionPrompt(
  repo: ManagedRepo,
  {
    compact
  }: {
    compact: boolean;
  }
): Record<string, unknown> {
  const routingSummary: Record<string, unknown> = {};
  const consumes = filterRepoRoutingConsumes(repo.routing.consumes);

  if (repo.routing.role !== "") {
    routingSummary.role = repo.routing.role;
  }

  addPromptRoutingList(routingSummary, "reach", repo.routing.reach, REPO_SELECTION_PROMPT_LIMITS.reach);
  addPromptRoutingList(routingSummary, "owns", repo.routing.owns, REPO_SELECTION_PROMPT_LIMITS.owns);
  addPromptRoutingList(routingSummary, "exposes", repo.routing.exposes, REPO_SELECTION_PROMPT_LIMITS.exposes);
  addPromptRoutingList(routingSummary, "selectWhen", repo.routing.selectWhen, REPO_SELECTION_PROMPT_LIMITS.selectWhen);
  addPromptRoutingList(routingSummary, "boundaries", repo.routing.boundaries, REPO_SELECTION_PROMPT_LIMITS.boundaries);

  if (!compact) {
    addPromptRoutingList(
      routingSummary,
      "responsibilities",
      repo.routing.responsibilities,
      REPO_SELECTION_PROMPT_LIMITS.responsibilities
    );
    addPromptRoutingList(routingSummary, "workflows", repo.routing.workflows, REPO_SELECTION_PROMPT_LIMITS.workflows);
    addPromptRoutingList(routingSummary, "consumes", consumes, REPO_SELECTION_PROMPT_LIMITS.consumes);
    addPromptRoutingList(
      routingSummary,
      "selectWithOtherReposWhen",
      repo.routing.selectWithOtherReposWhen,
      REPO_SELECTION_PROMPT_LIMITS.selectWithOtherReposWhen
    );
  }

  return routingSummary;
}

function addPromptRoutingList(
  target: Record<string, unknown>,
  label: string,
  values: string[],
  limit: number
): void {
  if (values.length === 0) {
    return;
  }

  target[label] = values.slice(0, limit);
}

function normalizePromptText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function parseRepoSelectionRunResult(
  text: string,
  config: LoadedConfig,
  effort: RepoSelectionCodexEffort,
  latencyMs: number
): RepoSelectionRunResult {
  if (typeof text !== "string" || text.trim() === "") {
    return createInvalidRunResult(effort, latencyMs);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return createInvalidRunResult(effort, latencyMs);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return createInvalidRunResult(effort, latencyMs);
  }

  const parsedObject = parsed as Record<string, unknown>;
  const selectedRepoNames = extractSelectedRepoNames(parsedObject.selectedRepoNames);
  if (!selectedRepoNames) {
    return createInvalidRunResult(effort, latencyMs);
  }
  const confidence = normalizeConfidence(parsedObject.confidence);

  if (selectedRepoNames.length > MAX_AUTOMATIC_REPOS) {
    return {
      effort,
      repoNames: selectedRepoNames,
      repos: null,
      confidence,
      latencyMs
    };
  }

  const requestedNames = new Set(selectedRepoNames.map(name => name.toLowerCase()));
  const selectedRepos = config.repos.filter(repo => repoMatchesAnyName(repo, requestedNames));

  return {
    effort,
    repoNames: selectedRepoNames,
    repos: selectedRepoNames.length === 0 || selectedRepos.length > 0 ? selectedRepos : null,
    confidence,
    latencyMs
  };
}

function createInvalidRunResult(
  effort: RepoSelectionCodexEffort,
  latencyMs: number,
  repoNames: string[] = []
): RepoSelectionRunResult {
  return {
    effort,
    repoNames,
    repos: null,
    confidence: null,
    latencyMs
  };
}

function extractSelectedRepoNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  if (!value.every(item => typeof item === "string" && item.trim() !== "")) {
    return null;
  }

  return Array.from(new Set((value as string[]).map(item => item.trim())));
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value < 0 || value > 1) {
    return null;
  }

  return value;
}

export function isUsableCodexRun(
  run: RepoSelectionRunResult,
  alwaysSelectedRepoCount: number,
  effort: RepoSelectionCodexEffort
): boolean {
  if (!run.repos) {
    return false;
  }

  if (run.repos.length === 0 && alwaysSelectedRepoCount === 0) {
    return false;
  }

  const confidence = run.confidence;
  if (confidence == null) {
    return effort === "high";
  }

  return confidence >= REPO_SELECTION_CONFIDENCE_THRESHOLDS[effort];
}

async function collectCompletedRuns(
  runPromises: Map<RepoSelectionCodexEffort, Promise<RepoSelectionRunResult>>,
  finalEffort: RepoSelectionCodexEffort
): Promise<RepoSelectionRunResult[]> {
  const efforts = Array.from(runPromises.keys());
  const finalIndex = efforts.indexOf(finalEffort);
  const completedEfforts = finalIndex >= 0 ? efforts.slice(0, finalIndex + 1) : efforts;

  return Promise.all(completedEfforts.map(effort => runPromises.get(effort) as Promise<RepoSelectionRunResult>));
}

async function collectAllRuns(
  runPromises: Map<RepoSelectionCodexEffort, Promise<RepoSelectionRunResult>>
): Promise<RepoSelectionRunResult[]> {
  const orderedEfforts = Array.from(runPromises.keys());
  return Promise.all(orderedEfforts.map(effort => runPromises.get(effort) as Promise<RepoSelectionRunResult>));
}

function buildSelectionRuns(
  runs: RepoSelectionRunResult[],
  finalEffort: RepoSelectionCodexEffort | null
): RepoSelectionSummary["runs"] {
  return runs.map(run => ({
    effort: run.effort,
    repoNames: run.repoNames,
    latencyMs: run.latencyMs,
    confidence: run.confidence,
    usedForFinal: finalEffort === run.effort
  }));
}

function selectRequestedRepos(config: LoadedConfig, requestedRepoNames: string[]): ManagedRepo[] {
  return selectReposByRequestedNames(config.repos, requestedRepoNames);
}

function scoreRepo(repo: ManagedRepo, questionTokens: string[]): number {
  const weights = [
    { values: tokenizeRepoName(repo.name), weight: 7 },
    { values: repo.aliases.flatMap(alias => tokenize(alias)), weight: 6 },
    { values: tokenize(repo.description), weight: 4 },
    { values: tokenize(repo.routing.role), weight: 5 },
    { values: repo.routing.reach.flatMap(value => tokenize(value)), weight: 5 },
    { values: repo.routing.responsibilities.flatMap(value => tokenize(value)), weight: 5 },
    { values: repo.routing.owns.flatMap(value => tokenize(value)), weight: 6 },
    { values: repo.routing.exposes.flatMap(value => tokenize(value)), weight: 6 },
    { values: repo.routing.workflows.flatMap(value => tokenize(value)), weight: 4 },
    { values: filterRepoRoutingConsumes(repo.routing.consumes).flatMap(value => tokenize(value)), weight: 2 }
  ];

  let score = 0;
  for (const { values, weight } of weights) {
    const evidence = new Set(values);
    for (const token of questionTokens) {
      if (evidence.has(token)) {
        score += weight;
      }
    }
  }

  return score;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9-]+/g) || []).filter(token => token.length >= 3);
}

function tokenizeRepoName(name: string): string[] {
  return Array.from(new Set(
    tokenize(name).flatMap(token => token.includes("-") ? [token, ...token.split("-")] : [token])
  ));
}

function mergeRepos(primaryRepos: ManagedRepo[], secondaryRepos: ManagedRepo[]): ManagedRepo[] {
  const repos: ManagedRepo[] = [];
  const seenRepoNames = new Set<string>();

  for (const repo of [...primaryRepos, ...secondaryRepos]) {
    const repoName = repo.name.toLowerCase();
    if (seenRepoNames.has(repoName)) {
      continue;
    }

    seenRepoNames.add(repoName);
    repos.push(repo);
  }

  return repos;
}
