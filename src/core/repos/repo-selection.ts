import path from "node:path";

import { runCodexPrompt } from "../codex/codex-runner.js";
import { DEFAULT_CODEX_MODEL } from "../codex/codex-defaults.js";
import { filterRepoRoutingConsumes } from "./repo-routing.js";
import type {
  CodexUsage,
  LoadedConfig,
  ManagedRepo,
  RepoSelectionCodexEffort,
  RepoSelectionRunStatus,
  RepoSelectionResult,
  RepoSelectionStrategy,
  RepoSelectionSummary
} from "../types.js";

const MAX_AUTOMATIC_REPOS = 4;
const DEFAULT_REPO_SELECTION_CODEX_TIMEOUT_MS = 60_000;
const REPO_SELECTION_DIAGNOSTIC_COLLECTION_TIMEOUT_MS = 85_000;
const REPO_SELECTION_MAX_ATTEMPTS = 2;
const REPO_SELECTION_CODEX_MODEL = DEFAULT_CODEX_MODEL;
const REPO_SELECTION_ALT_CODEX_MODEL = "gpt-5.4";
const REPO_SELECTION_CASCADE_RUNS = (["medium", "high", "xhigh"] as const).map(effort => ({
  model: REPO_SELECTION_CODEX_MODEL,
  effort
}));
const REPO_SELECTION_SHADOW_COMPARE_RUNS = [
  ...(["none", "low", "medium", "high", "xhigh"] as const).map(effort => ({
    model: REPO_SELECTION_CODEX_MODEL,
    effort
  })),
  ...(["none", "low", "medium", "high"] as const).map(effort => ({
    model: REPO_SELECTION_ALT_CODEX_MODEL,
    effort
  }))
];
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
  high: 0,
  xhigh: 0
};

type RepoSelectionDependencies = {
  runCodexPromptFn?: typeof runCodexPrompt;
  nowFn?: () => number;
};
type RepoSelectionOptions = {
  selectionMode?: RepoSelectionStrategy | null;
  selectionShadowCompare?: boolean;
};

type RepoSelectionRunConfig = {
  model: string;
  effort: RepoSelectionCodexEffort;
};

type RepoSelectionRunResult = {
  model: string;
  effort: RepoSelectionCodexEffort;
  repoNames: string[];
  repos: ManagedRepo[] | null;
  confidence: number | null;
  latencyMs: number;
  usage?: CodexUsage | null;
  status: RepoSelectionRunStatus;
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
        finalModel: null,
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

  throw createAutomaticRepoSelectionError(resolvedSelectionMode);
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
  const selectionPathRuns = selectionMode === "single"
    ? [REPO_SELECTION_CASCADE_RUNS[0]!]
    : REPO_SELECTION_CASCADE_RUNS;
  const runPromises = new Map<string, Promise<RepoSelectionRunResult>>();
  const getRun = ({ model, effort }: RepoSelectionRunConfig): Promise<RepoSelectionRunResult> => {
    const runKey = getRunKey(model, effort);
    const existingRun = runPromises.get(runKey);
    if (existingRun) {
      return existingRun;
    }

    const startedAt = nowFn();
    const runPromise = runRepoSelectionPromptWithRetry({
      config,
      question,
      model,
      effort,
      runCodexPromptFn,
      nowFn,
      workingDirectory: path.dirname(config.configPath)
    });

    runPromises.set(runKey, runPromise);
    return runPromise;
  };

  const primaryRun = getRun(selectionPathRuns[0]!);

  if (selectionShadowCompare) {
    for (const runConfig of REPO_SELECTION_SHADOW_COMPARE_RUNS) {
      void getRun(runConfig);
    }
  }

  let selectedRun: RepoSelectionRunResult | null = null;
  if (selectionMode === "single") {
    const firstRun = await primaryRun;
    if (hasUsableSingleModeRun(firstRun, alwaysSelectedRepos)) {
      selectedRun = firstRun;
    }
  } else {
    const firstRunConfig = REPO_SELECTION_CASCADE_RUNS[0]!;
    const remainingRunConfigs = REPO_SELECTION_CASCADE_RUNS.slice(1);
    const firstRun = await primaryRun;
    if (isUsableCascadeRun(firstRun, firstRunConfig.effort, alwaysSelectedRepos)) {
      selectedRun = firstRun;
    }

    for (const runConfig of remainingRunConfigs) {
      if (selectedRun) {
        break;
      }

      const run = await getRun(runConfig);
      if (isUsableCascadeRun(run, runConfig.effort, alwaysSelectedRepos)) {
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

  const baseSelection = {
    mode: selectionMode,
    shadowCompare: selectionShadowCompare,
    source: "codex" as const,
    finalModel: selectedRun.model,
    finalEffort: selectedRun.effort,
    finalRepoNames: repos.map(repo => repo.name)
  };
  const orderedRunConfigs = buildOrderedRunConfigs(selectionPathRuns, selectionShadowCompare);
  const completedRuns = await collectCompletedRuns(runPromises, selectionPathRuns, selectedRun);
  const immediateSelection = {
    ...baseSelection,
    runs: buildSelectionRuns(completedRuns, selectedRun)
  };
  const hasAdditionalBackgroundRuns = runPromises.size > completedRuns.length;

  const selectionPromise = hasAdditionalBackgroundRuns
    ? collectRunsWithinTimeout(runPromises, orderedRunConfigs, REPO_SELECTION_DIAGNOSTIC_COLLECTION_TIMEOUT_MS).then(allRuns => ({
        ...baseSelection,
        runs: buildSelectionRuns(orderRunsForDisplay(allRuns, orderedRunConfigs), selectedRun)
      }))
    : null;

  if (!selectionPromise) {
    return {
      repos,
      mode: repos.length === config.repos.length ? "all" : "resolved",
      selection: immediateSelection
    };
  }

  return {
    repos,
    mode: repos.length === config.repos.length ? "all" : "resolved",
    selection: immediateSelection,
    selectionPromise
  };
}

export function buildRepoSelectionPrompt(
  config: LoadedConfig,
  question: string,
  {
    attempt = 1
  }: {
    attempt?: number;
  } = {}
): string {
  const useCompactSummaries = config.repos.length > REPO_SELECTION_PROMPT_COMPACT_REPO_THRESHOLD;
  const repoSummaries = config.repos.map(repo => summarizeRepoForSelectionPrompt(repo, {
    compact: useCompactSummaries
  }));
  const alwaysSelectedRepoNames = config.repos
    .filter(repo => repo.alwaysSelect)
    .map(repo => repo.name);
  const strongEvidenceLine = useCompactSummaries
    ? "Strong evidence: description, routing.role, routing.reach, routing.owns, routing.exposes, routing.selectWhen, routing.boundaries, and aliases."
    : "Strong evidence: description, routing.role, routing.reach, routing.responsibilities, routing.owns, routing.exposes, routing.workflows, routing.selectWhen, and aliases.";
  const weakerEvidenceLine = useCompactSummaries
    ? null
    : "Weaker evidence: routing.consumes and generic ecosystem overlap.";
  const negativeEvidenceLine = useCompactSummaries
    ? "Use routing.boundaries as negative evidence when they clearly rule a repo out."
    : "Negative evidence: routing.boundaries and routing.selectWithOtherReposWhen when the question does not cross repo boundaries.";
  const summaryModeLine = useCompactSummaries
    ? "Large repo set detected; using compact routing summaries with description, role, reach, owns, exposes, selectWhen, boundaries, and aliases only."
    : "Using full routing summaries for the configured repos.";

  return [
    "Select the configured repositories that should be searched to answer the user question.",
    "Select repos by ownership and exposed surfaces, not by generic keyword overlap.",
    strongEvidenceLine,
    weakerEvidenceLine,
    negativeEvidenceLine,
    "Prefer precision over recall. Only choose repos that are likely to contain the answer.",
    "Return between 0 and 4 configured repos.",
    "If no configured repo is relevant, return an empty array.",
    "Return raw JSON only with exactly this shape: {\"selectedRepoNames\":[\"repo-a\",\"repo-b\"],\"confidence\":0.0}.",
    "Do not wrap the JSON in markdown fences. Do not add explanation, commentary, or any extra text.",
    "Confidence must be a number from 0.0 to 1.0 for how confident you are that the selected set is sufficient.",
    "Use configured repo names exactly as provided. Unknown repo names will be rejected.",
    attempt > 1
      ? "Previous output was invalid or did not follow the schema. Reply again with valid raw JSON only."
      : null,
    alwaysSelectedRepoNames.length > 0
      ? `Repos marked alwaysSelect are already included automatically: ${alwaysSelectedRepoNames.join(", ")}.`
      : "There are no alwaysSelect repos.",
    "",
    summaryModeLine,
    `Configured repositories from ${config.configPath} (one JSON object per line):`,
    ...repoSummaries.map(summary => JSON.stringify(summary)),
    "",
    "User question:",
    '"""',
    question,
    '"""'
  ].filter(line => line != null).join("\n");
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
  latencyMs: number,
  model: string = REPO_SELECTION_CODEX_MODEL
): RepoSelectionRunResult {
  if (typeof text !== "string" || text.trim() === "") {
    return createInvalidRunResult(model, effort, latencyMs);
  }

  const parsedObject = parseRepoSelectionResponseObject(text);
  if (!parsedObject) {
    return createInvalidRunResult(model, effort, latencyMs);
  }
  const selectedRepoNames = extractSelectedRepoNames(parsedObject.selectedRepoNames);
  if (!selectedRepoNames) {
    return createInvalidRunResult(model, effort, latencyMs);
  }

  if (selectedRepoNames.length > MAX_AUTOMATIC_REPOS) {
    return {
      model,
      effort,
      repoNames: selectedRepoNames,
      repos: null,
      confidence: normalizeConfidence(parsedObject.confidence),
      latencyMs,
      status: "invalid"
    };
  }

  const requestedNames = new Set(selectedRepoNames.map(name => name.toLowerCase()));
  const selectedRepos = config.repos.filter(repo => repoMatchesAnyName(repo, requestedNames));
  const hasEmptySelection = selectedRepoNames.length === 0;

  return {
    model,
    effort,
    repoNames: selectedRepoNames,
    repos: hasEmptySelection ? [] : selectedRepos.length > 0 ? selectedRepos : null,
    confidence: normalizeConfidence(parsedObject.confidence),
    latencyMs,
    status: hasEmptySelection || selectedRepos.length > 0 ? "ok" : "invalid"
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
  effort: RepoSelectionCodexEffort
): boolean {
  if (!hasResolvedRepoSelection(run)) {
    return false;
  }

  const confidence = run.confidence;
  if (confidence == null) {
    return effort === "high";
  }

  return confidence >= REPO_SELECTION_CONFIDENCE_THRESHOLDS[effort];
}

function hasResolvedRepoSelection(run: RepoSelectionRunResult): boolean {
  return run.repos != null && run.repos.length > 0;
}

function hasValidRepoSelectionResponse(run: RepoSelectionRunResult): boolean {
  return run.status === "ok" && run.repos != null;
}

function hasUsableSingleModeRun(run: RepoSelectionRunResult, alwaysSelectedRepos: ManagedRepo[]): boolean {
  const selectedRepos = run.repos;
  if (!hasValidRepoSelectionResponse(run) || selectedRepos == null) {
    return false;
  }

  return mergeRepos(alwaysSelectedRepos, selectedRepos).length > 0;
}

function isUsableCascadeRun(
  run: RepoSelectionRunResult,
  effort: RepoSelectionCodexEffort,
  alwaysSelectedRepos: ManagedRepo[]
): boolean {
  const selectedRepos = run.repos;
  if (!hasValidRepoSelectionResponse(run) || selectedRepos == null) {
    return false;
  }

  const mergedRepos = mergeRepos(alwaysSelectedRepos, selectedRepos);
  if (mergedRepos.length === 0) {
    return false;
  }

  if (selectedRepos.length === 0) {
    return true;
  }

  return isUsableCodexRun(run, effort);
}

async function collectCompletedRuns(
  runPromises: Map<string, Promise<RepoSelectionRunResult>>,
  selectionPathRuns: RepoSelectionRunConfig[],
  finalRun: RepoSelectionRunConfig
): Promise<RepoSelectionRunResult[]> {
  const finalIndex = selectionPathRuns.findIndex(runConfig => isSameRunConfig(runConfig, finalRun));
  const completedRunConfigs = finalIndex >= 0 ? selectionPathRuns.slice(0, finalIndex + 1) : selectionPathRuns;

  return Promise.all(
    completedRunConfigs.map(runConfig => runPromises.get(getRunKey(runConfig.model, runConfig.effort)) as Promise<RepoSelectionRunResult>)
  );
}

async function collectAllRuns(
  runPromises: Map<string, Promise<RepoSelectionRunResult>>
): Promise<RepoSelectionRunResult[]> {
  return Promise.all(Array.from(runPromises.values()));
}

async function collectRunsWithinTimeout(
  runPromises: Map<string, Promise<RepoSelectionRunResult>>,
  orderedRunConfigs: RepoSelectionRunConfig[],
  timeoutMs: number
): Promise<RepoSelectionRunResult[]> {
  const timeoutResult = Symbol("repo-selection-collection-timeout");
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    const timeoutPromise = new Promise<typeof timeoutResult>(resolve => {
      timeoutHandle = setTimeout(() => resolve(timeoutResult), timeoutMs);
    });

    const settledRuns = await Promise.all(
      orderedRunConfigs.map(async runConfig => {
        const runPromise = runPromises.get(getRunKey(runConfig.model, runConfig.effort));
        if (!runPromise) {
          return null;
        }

        const result = await Promise.race<RepoSelectionRunResult | typeof timeoutResult>([
          runPromise,
          timeoutPromise
        ]);

        return result === timeoutResult
          ? createInvalidRunResult(runConfig.model, runConfig.effort, timeoutMs, "timed_out")
          : result;
      })
    );

    return settledRuns.filter((run): run is RepoSelectionRunResult => run !== null);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function buildSelectionRuns(
  runs: RepoSelectionRunResult[],
  finalRun: RepoSelectionRunConfig | null
): RepoSelectionSummary["runs"] {
  return runs
    .map(run => ({
      model: run.model,
      effort: run.effort,
      repoNames: run.repoNames,
      latencyMs: run.latencyMs,
      confidence: run.confidence,
      usage: run.usage ?? null,
      status: run.status,
      usedForFinal: finalRun ? isSameRunConfig(run, finalRun) : false
    }));
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

function getRunKey(model: string, effort: RepoSelectionCodexEffort): string {
  return `${model}\u0000${effort}`;
}

function isSameRunConfig(left: RepoSelectionRunConfig, right: RepoSelectionRunConfig): boolean {
  return left.model === right.model && left.effort === right.effort;
}

function buildOrderedRunConfigs(
  selectionPathRuns: RepoSelectionRunConfig[],
  selectionShadowCompare: boolean
): RepoSelectionRunConfig[] {
  const orderedConfigs = [
    ...selectionPathRuns,
    ...(selectionShadowCompare ? REPO_SELECTION_SHADOW_COMPARE_RUNS : [])
  ];
  const seenRunKeys = new Set<string>();

  return orderedConfigs.filter(runConfig => {
    const runKey = getRunKey(runConfig.model, runConfig.effort);
    if (seenRunKeys.has(runKey)) {
      return false;
    }

    seenRunKeys.add(runKey);
    return true;
  });
}

function orderRunsForDisplay(
  runs: RepoSelectionRunResult[],
  orderedRunConfigs: RepoSelectionRunConfig[]
): RepoSelectionRunResult[] {
  const orderByRunKey = new Map(
    orderedRunConfigs.map((runConfig, index) => [getRunKey(runConfig.model, runConfig.effort), index])
  );

  return [...runs].sort((left, right) => {
    const leftIndex = orderByRunKey.get(getRunKey(left.model, left.effort)) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderByRunKey.get(getRunKey(right.model, right.effort)) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

async function runRepoSelectionPromptWithRetry({
  config,
  question,
  model,
  effort,
  runCodexPromptFn,
  nowFn,
  workingDirectory
}: {
  config: LoadedConfig;
  question: string;
  model: string;
  effort: RepoSelectionCodexEffort;
  runCodexPromptFn: typeof runCodexPrompt;
  nowFn: () => number;
  workingDirectory: string;
}): Promise<RepoSelectionRunResult> {
  let totalLatencyMs = 0;
  let lastRun = createInvalidRunResult(model, effort, 0);

  for (let attempt = 1; attempt <= REPO_SELECTION_MAX_ATTEMPTS; attempt += 1) {
    const attemptStartedAt = nowFn();

    try {
      const result = await runCodexPromptFn({
        prompt: buildRepoSelectionPrompt(config, question, {
          attempt
        }),
        model,
        reasoningEffort: effort,
        workingDirectory,
        timeoutMs: DEFAULT_REPO_SELECTION_CODEX_TIMEOUT_MS
      });
      const attemptRun = parseRepoSelectionRunResult(result.text, config, effort, nowFn() - attemptStartedAt, model);
      totalLatencyMs += attemptRun.latencyMs;
      lastRun = {
        ...attemptRun,
        usage: result.usage ?? null,
        latencyMs: totalLatencyMs
      };
    } catch (error) {
      totalLatencyMs += nowFn() - attemptStartedAt;
      const failureStatus = error instanceof Error && /\btimed out\b/i.test(error.message)
        ? "timed_out"
        : "failed";
      lastRun = createInvalidRunResult(model, effort, totalLatencyMs, failureStatus);
    }

    if (!shouldRetryRepoSelectionRun(lastRun) || attempt === REPO_SELECTION_MAX_ATTEMPTS) {
      return lastRun;
    }
  }

  return lastRun;
}

function shouldRetryRepoSelectionRun(run: RepoSelectionRunResult): boolean {
  return run.status !== "ok" || run.confidence == null;
}

function createInvalidRunResult(
  model: string,
  effort: RepoSelectionCodexEffort,
  latencyMs: number,
  status: RepoSelectionRunStatus = "invalid"
): RepoSelectionRunResult {
  return {
    model,
    effort,
    repoNames: [],
    repos: null,
    confidence: null,
    latencyMs,
    status
  };
}

function parseRepoSelectionResponseObject(text: string): Record<string, unknown> | null {
  const trimmedText = text.trim();
  const candidateTexts = [
    trimmedText,
    extractFencedJson(trimmedText),
    extractWrappedJsonObject(trimmedText)
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate !== "");

  for (const candidateText of candidateTexts) {
    try {
      const parsed = JSON.parse(candidateText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function extractFencedJson(text: string): string | null {
  const fencedMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return fencedMatch?.[1]?.trim() || null;
}

function extractWrappedJsonObject(text: string): string | null {
  const firstBraceIndex = text.indexOf("{");
  const lastBraceIndex = text.lastIndexOf("}");

  if (firstBraceIndex === -1 || lastBraceIndex <= firstBraceIndex) {
    return null;
  }

  return text.slice(firstBraceIndex, lastBraceIndex + 1).trim();
}

function createAutomaticRepoSelectionError(selectionMode: RepoSelectionStrategy): Error {
  if (selectionMode === "single") {
    return new Error(
      "Automatic repo selection failed. Codex did not return a usable repo set. Retry, use --repo <name>, or try --selection-mode cascade."
    );
  }

  return new Error(
    "Automatic repo selection failed. Codex did not return a usable repo set. Retry or use --repo <name>."
  );
}
