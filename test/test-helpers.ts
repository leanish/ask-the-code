import { createEmptyRepoRouting } from "../src/core/repos/repo-routing.js";
import type { SpawnSyncReturns } from "node:child_process";

import type {
  AnswerResult,
  GithubDiscoveryPlan,
  GithubDiscoveryPlanEntry,
  InitializeConfigResult,
  LoadedConfig,
  ManagedRepo,
  RepoRecord,
  RetrievalOnlyResult,
  SyncReportItem
} from "../src/core/types.js";

export function createManagedRepo(overrides: Partial<ManagedRepo> = {}): ManagedRepo {
  const name = overrides.name ?? "repo";

  return {
    name,
    url: overrides.url ?? `https://github.com/example/${name}.git`,
    defaultBranch: overrides.defaultBranch ?? "main",
    description: overrides.description ?? "",
    routing: overrides.routing ?? createEmptyRepoRouting(),
    aliases: overrides.aliases ?? [],
    alwaysSelect: overrides.alwaysSelect ?? false,
    directory: overrides.directory ?? `/workspace/repos/${name}`,
    ...(overrides.branch ? { branch: overrides.branch } : {}),
    ...(overrides.sourceFullName ? { sourceFullName: overrides.sourceFullName } : {}),
    ...(overrides.sourceOwner ? { sourceOwner: overrides.sourceOwner } : {})
  };
}

export function createRepoRecord(overrides: Partial<RepoRecord> = {}): RepoRecord {
  const name = overrides.name ?? "repo";

  return {
    name,
    url: overrides.url ?? `https://github.com/example/${name}.git`,
    defaultBranch: overrides.defaultBranch ?? "main",
    description: overrides.description ?? "",
    routing: overrides.routing ?? createEmptyRepoRouting(),
    aliases: overrides.aliases ?? [],
    alwaysSelect: overrides.alwaysSelect ?? false,
    ...(overrides.branch ? { branch: overrides.branch } : {}),
    ...(overrides.sourceFullName ? { sourceFullName: overrides.sourceFullName } : {}),
    ...(overrides.sourceOwner ? { sourceOwner: overrides.sourceOwner } : {}),
    ...(overrides.clone_url ? { clone_url: overrides.clone_url } : {}),
    ...(overrides.full_name ? { full_name: overrides.full_name } : {}),
    ...(overrides.fork != null ? { fork: overrides.fork } : {}),
    ...(overrides.html_url ? { html_url: overrides.html_url } : {}),
    ...(overrides.owner ? { owner: overrides.owner } : {}),
    ...(overrides.size != null ? { size: overrides.size } : {})
  };
}

export function createLoadedConfig(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    configPath: overrides.configPath ?? "/tmp/atc-config.json",
    managedReposRoot: overrides.managedReposRoot ?? "/workspace/repos",
    repos: overrides.repos ?? []
  };
}

export function createInitializeConfigResult(overrides: Partial<InitializeConfigResult> = {}): InitializeConfigResult {
  return {
    configPath: overrides.configPath ?? "/tmp/atc-config.json",
    managedReposRoot: overrides.managedReposRoot ?? "/workspace/repos",
    repoCount: overrides.repoCount ?? 0
  };
}

export function createSyncReportItem(overrides: Partial<SyncReportItem> = {}): SyncReportItem {
  return {
    name: overrides.name ?? "repo",
    action: overrides.action ?? "updated",
    ...(overrides.directory ? { directory: overrides.directory } : {}),
    ...(overrides.detail ? { detail: overrides.detail } : {})
  };
}

export function createAnswerResult(overrides: Partial<AnswerResult> = {}): AnswerResult {
  return {
    mode: "answer",
    question: overrides.question ?? "question",
    selectedRepos: overrides.selectedRepos ?? [],
    selection: overrides.selection ?? null,
    syncReport: overrides.syncReport ?? [],
    synthesis: overrides.synthesis ?? { text: "answer" }
  };
}

export function createRetrievalOnlyResult(overrides: Partial<RetrievalOnlyResult> = {}): RetrievalOnlyResult {
  return {
    mode: "retrieval-only",
    question: overrides.question ?? "question",
    selectedRepos: overrides.selectedRepos ?? [],
    selection: overrides.selection ?? null,
    syncReport: overrides.syncReport ?? []
  };
}

export function createGithubDiscoveryPlanEntry(overrides: Partial<GithubDiscoveryPlanEntry> = {}): GithubDiscoveryPlanEntry {
  return {
    repo: overrides.repo ?? createRepoRecord(),
    status: overrides.status ?? "new",
    configuredRepo: overrides.configuredRepo ?? null,
    suggestions: overrides.suggestions ?? []
  };
}

export function createGithubDiscoveryPlan(overrides: Partial<GithubDiscoveryPlan> = {}): GithubDiscoveryPlan {
  const entries = overrides.entries ?? [];

  return {
    owner: overrides.owner ?? "leanish",
    ...(overrides.ownerDisplay ? { ownerDisplay: overrides.ownerDisplay } : {}),
    ownerType: overrides.ownerType ?? "User",
    skippedForks: overrides.skippedForks ?? 0,
    skippedArchived: overrides.skippedArchived ?? 0,
    entries,
    reposToAdd: overrides.reposToAdd ?? [],
    counts: overrides.counts ?? {
      discovered: entries.length,
      configured: 0,
      new: entries.length,
      conflicts: 0,
      withSuggestions: 0
    }
  };
}

export function createSpawnSyncResult(
  overrides: Partial<SpawnSyncReturns<string>> = {}
): SpawnSyncReturns<string> {
  return {
    pid: 1,
    output: [null, "", ""],
    stdout: "",
    stderr: "",
    status: 0,
    signal: null,
    ...overrides
  };
}
