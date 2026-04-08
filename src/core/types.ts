import type { AnswerAudience } from "./answer/answer-audience.js";

export type Environment = NodeJS.ProcessEnv;

export type RepoClassification =
  | "infra"
  | "library"
  | "internal"
  | "external"
  | "frontend"
  | "backend"
  | "cli"
  | "microservice";

export interface RepoRecord {
  name: string;
  url: string;
  defaultBranch: string;
  description: string;
  topics: string[];
  classifications: RepoClassification[];
  aliases: string[];
  alwaysSelect: boolean;
  branch?: string;
  clone_url?: string;
  directory?: string;
  full_name?: string;
  fork?: boolean;
  html_url?: string;
  owner?: {
    login?: string;
  };
  size?: number;
  sourceFullName?: string;
  sourceOwner?: string;
}

export interface ManagedRepoDefinition extends RepoRecord {}

export interface ManagedRepo extends RepoRecord {
  directory: string;
}

export interface LoadedConfig {
  configPath: string;
  managedReposRoot: string;
  repos: ManagedRepo[];
}

export interface InitializeConfigResult {
  configPath: string;
  managedReposRoot: string;
  repoCount: number;
}

export interface ConfigMutationResult {
  configPath: string;
  addedCount: number;
  overriddenCount?: number;
  totalCount: number;
}

export interface AskRequest {
  question: string;
  repoNames: string[] | null;
  audience: AnswerAudience;
  model: string | null;
  reasoningEffort: string | null;
  noSync: boolean;
  noSynthesis: boolean;
}

export interface AskCommandOptions extends AskRequest {
  command: "ask";
  questionFile: string | null;
  model: string;
  reasoningEffort: string;
}

export interface ReposListCommandOptions {
  command: "repos-list";
}

export interface ReposSyncCommandOptions {
  command: "repos-sync";
  repoNames: string[];
}

export interface ConfigPathCommandOptions {
  command: "config-path";
}

export interface ConfigInitCommandOptions {
  command: "config-init";
  catalogPath: string | null;
  managedReposRoot: string | null;
  force: boolean;
}

export interface ConfigDiscoverGithubCommandOptions {
  command: "config-discover-github";
  owner: string | null;
  includeForks: boolean;
  includeArchived: boolean;
  addRepoNames: string[];
  overrideRepoNames: string[];
}

export type CliCommandOptions =
  | AskCommandOptions
  | ReposListCommandOptions
  | ReposSyncCommandOptions
  | ConfigPathCommandOptions
  | ConfigInitCommandOptions
  | ConfigDiscoverGithubCommandOptions;

export interface ServerCommandOptions {
  host: string;
  port: number;
}

export type RepoSyncAction = "cloned" | "updated" | "skipped" | "failed";
export type RepoSyncStartAction = "clone" | "update";

export interface SyncReportItem {
  name: string;
  directory: string;
  action: RepoSyncAction;
  detail?: string;
}

export type RepoSelectionMode = "requested" | "resolved" | "all";

export interface RepoSelectionResult {
  repos: ManagedRepo[];
  mode: RepoSelectionMode;
}

export interface RepoSyncCallbacks {
  onRepoStart?: (repo: ManagedRepo, action: RepoSyncStartAction, trunkBranch: string) => void;
  onRepoWait?: (repo: ManagedRepo, trunkBranch: string) => void;
  onRepoResult?: (item: SyncReportItem) => void;
}

export interface StatusReporter {
  info(message: string): void;
  flush?(): void;
}

export interface CodexSynthesis {
  text: string;
}

export interface RunCodexQuestionInput {
  question: string;
  audience: string | null | undefined;
  model: string | null;
  reasoningEffort: string | null;
  selectedRepos: ManagedRepo[];
  workspaceRoot: string;
  timeoutMs?: number;
  onStatus?: (message: string) => void;
}

export interface RetrievalOnlyResult {
  mode: "retrieval-only";
  question: string;
  selectedRepos: ManagedRepo[];
  syncReport: SyncReportItem[];
}

export interface AnswerResult {
  mode: "answer";
  question: string;
  selectedRepos: ManagedRepo[];
  syncReport: SyncReportItem[];
  synthesis: CodexSynthesis;
}

export type AskResult = RetrievalOnlyResult | AnswerResult;

export interface QuestionExecutionOptions {
  env: Environment;
  statusReporter: StatusReporter | null;
  loadConfigFn: (env: Environment) => Promise<LoadedConfig>;
  selectReposFn: (
    config: LoadedConfig,
    question: string,
    requestedRepoNames: string[] | null
  ) => Promise<RepoSelectionResult>;
  syncReposFn: (repos: ManagedRepo[], callbacks?: RepoSyncCallbacks) => Promise<SyncReportItem[]>;
  existsSyncFn: (targetPath: string) => boolean;
  getCodexTimeoutMsFn: (env: Environment) => number;
  runCodexQuestionFn: (input: RunCodexQuestionInput) => Promise<CodexSynthesis>;
  nowFn: () => number;
}

export type QuestionExecutionOverrides = Partial<QuestionExecutionOptions>;

export type AnswerQuestionFn = (
  request: AskRequest,
  envOrExecution?: Environment | QuestionExecutionOverrides,
  legacyStatusReporter?: StatusReporter | null
) => Promise<AskResult>;

export interface GithubDiscoverySelection {
  reposToAdd: RepoRecord[];
  reposToOverride: RepoRecord[];
}

export interface GithubDiscoveryPlanEntry {
  repo: RepoRecord;
  status: "new" | "configured" | "conflict";
  configuredRepo: ManagedRepoDefinition | null;
  suggestions: string[];
}

export interface GithubDiscoveryPlan {
  owner: string;
  ownerDisplay?: string;
  ownerType: string;
  skippedForks: number;
  skippedArchived: number;
  entries: GithubDiscoveryPlanEntry[];
  reposToAdd: RepoRecord[];
  counts: {
    discovered: number;
    configured: number;
    new: number;
    conflicts: number;
    withSuggestions: number;
  };
}

export interface GithubDiscoveryPipelineResult {
  plan: GithubDiscoveryPlan;
  appliedEntries: GithubDiscoveryPlanEntry[];
  selectedCount: number;
  configPath: string | null;
  addedCount: number;
  overriddenCount: number;
}

export type GithubDiscoveryProgressEvent =
  | {
      type: "discovery-fetching";
      owner: string;
    }
  | {
      type: "discovery-page";
      page: number;
      fetchedCount: number;
      hasMorePages: boolean;
    }
  | {
      type: "discovery-listed";
      discoveredCount: number;
      eligibleCount: number;
      hydrateMetadata: boolean;
      inspectRepos: boolean;
    }
  | {
      type: "repo-hydrated";
      inspectRepos: boolean;
      processedCount: number;
      totalCount: number;
      repoName: string;
    };

export type AskJobStatus = "queued" | "running" | "completed" | "failed";
export type AskJobEventType = "queued" | "started" | "status" | "completed" | "failed";

export interface AskJobEvent {
  sequence: number;
  type: AskJobEventType;
  message: string;
  timestamp: string;
}

export interface AskJobSnapshot {
  id: string;
  status: AskJobStatus;
  request: AskRequest;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  result: AskResult | null;
  events: AskJobEvent[];
}

export interface AskJobStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
}

export interface AskJobManager {
  createJob(request: Partial<AskRequest> & Pick<AskRequest, "question">): AskJobSnapshot;
  getJob(jobId: string): AskJobSnapshot | null;
  getStats(): AskJobStats;
  shutdown(): Promise<void>;
  subscribe(jobId: string, listener: (event: AskJobEvent) => void): (() => void) | null;
  close(): void;
}
