import type { AnswerAudience } from "./answer/answer-audience.ts";

export type Environment = NodeJS.ProcessEnv;

export const REPO_CLASSIFICATIONS = [
  "infra",
  "library",
  "internal",
  "external",
  "frontend",
  "backend",
  "cli",
  "microservice"
] as const;

export type RepoClassification = typeof REPO_CLASSIFICATIONS[number];

export type RepoSelectionStrategy = "single" | "cascade";
export type RepoSelectionCodexEffort = "none" | "minimal" | "low" | "medium" | "high";
export type RepoSelectionSource = "requested" | "codex" | "heuristic";

export interface RepoIdentityFields {
  name: string;
  url: string;
  defaultBranch: string;
  branch?: string;
}

export interface RepoRoutingMetadata {
  role: string;
  reach: string[];
  responsibilities: string[];
  owns: string[];
  exposes: string[];
  consumes: string[];
  workflows: string[];
  boundaries: string[];
  selectWhen: string[];
  selectWithOtherReposWhen: string[];
}

export interface RepoMetadataFields {
  description: string;
  routing: RepoRoutingMetadata;
  aliases: string[];
  alwaysSelect: boolean;
}

export interface RepoDefinitionFields extends RepoIdentityFields, RepoMetadataFields {}

export interface RepoSourceMetadata {
  sourceFullName?: string;
  sourceOwner?: string;
}

export interface GithubRepoOwner {
  login?: string;
}

export interface GithubRepoApiFields {
  archived?: boolean;
  clone_url?: string;
  default_branch?: string;
  disabled?: boolean;
  full_name?: string;
  fork?: boolean;
  html_url?: string;
  owner?: GithubRepoOwner;
  private?: boolean;
  size?: number;
  topics?: string[];
}

export interface ManagedRepoDefinition extends RepoDefinitionFields, RepoSourceMetadata {}

export interface RepoRecord extends Partial<RepoIdentityFields>, Partial<RepoMetadataFields>, RepoSourceMetadata, GithubRepoApiFields {
  name: string;
}

export interface ManagedRepo extends ManagedRepoDefinition {
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

export interface AttachmentRef {
  name: string;
  path: string;
  type: string;
  size: number;
}

export interface AskRequest {
  question: string;
  repoNames: string[] | null;
  audience?: AnswerAudience | null;
  model: string | null;
  reasoningEffort: string | null;
  selectionMode?: RepoSelectionStrategy | null;
  selectionShadowCompare?: boolean;
  noSync: boolean;
  noSynthesis: boolean;
  attachments?: AttachmentRef[];
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

export interface RepoSyncTarget {
  name: string;
  url?: string;
  directory: string;
  defaultBranch: string;
  branch?: string;
}

export interface SyncReportItem {
  name: string;
  directory?: string;
  action: RepoSyncAction;
  detail?: string;
}

export interface RepoSyncCallbacks {
  onRepoStart?: (repo: RepoSyncTarget, action: RepoSyncStartAction, trunkBranch: string) => void;
  onRepoWait?: (repo: RepoSyncTarget, trunkBranch: string) => void;
  onRepoResult?: (item: SyncReportItem) => void;
}

export interface StatusReporter {
  info(message: string): void;
  flush?(): void;
}

export interface CodexSynthesis {
  text: string;
}

export interface CodexScopeRepo {
  name: string;
  directory: string;
  description?: string;
  defaultBranch?: string;
  branch?: string;
}

export interface RunCodexQuestionInput {
  question: string;
  audience?: AnswerAudience | null;
  model: string | null;
  reasoningEffort: string | null;
  selectedRepos: CodexScopeRepo[];
  workspaceRoot: string;
  timeoutMs?: number;
  attachments?: AttachmentRef[];
  onStatus?: (message: string) => void;
}

export interface SelectedRepoSummary {
  name: string;
}

export interface RepoSelectionRunDiagnostic {
  effort: RepoSelectionCodexEffort;
  repoNames: string[];
  latencyMs: number;
  confidence: number | null;
  usedForFinal: boolean;
}

export interface RepoSelectionSummary {
  mode: RepoSelectionStrategy;
  shadowCompare: boolean;
  source: RepoSelectionSource;
  finalEffort: RepoSelectionCodexEffort | null;
  finalRepoNames: string[];
  runs: RepoSelectionRunDiagnostic[];
}

export interface RetrievalOnlyResult {
  mode: "retrieval-only";
  question: string;
  selectedRepos: SelectedRepoSummary[];
  selection?: RepoSelectionSummary | null;
  syncReport: SyncReportItem[];
}

export interface AnswerResult {
  mode: "answer";
  question: string;
  selectedRepos: SelectedRepoSummary[];
  selection?: RepoSelectionSummary | null;
  syncReport: SyncReportItem[];
  synthesis: CodexSynthesis;
}

export type AskResult = RetrievalOnlyResult | AnswerResult;

export type RepoSelectionMode = "requested" | "resolved" | "all";

export interface RepoSelectionResult {
  repos: ManagedRepo[];
  mode: RepoSelectionMode;
  selection: RepoSelectionSummary | null;
  selectionPromise?: Promise<RepoSelectionSummary | null>;
}

export interface QuestionExecutionOptions {
  env: Environment;
  statusReporter: StatusReporter | null;
  loadConfigFn: (env: Environment) => Promise<LoadedConfig>;
  selectReposFn: (
    config: LoadedConfig,
    question: string,
    requestedRepoNames: string[] | null,
    options: {
      selectionMode: RepoSelectionStrategy | null;
      selectionShadowCompare: boolean;
    }
  ) => Promise<RepoSelectionResult>;
  syncReposFn: (repos: RepoSyncTarget[], callbacks?: RepoSyncCallbacks) => Promise<SyncReportItem[]>;
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
      owner?: string;
      page: number;
      fetchedCount: number;
      hasMorePages: boolean;
    }
  | {
      type: "discovery-listed";
      owner?: string;
      discoveredCount: number;
      eligibleCount: number;
      hydrateMetadata: boolean;
      inspectRepos: boolean;
      curateWithCodex?: boolean;
      skippedForks?: number;
      skippedArchived?: number;
      skippedDisabled?: number;
    }
  | {
      type: "repo-hydrated";
      owner?: string;
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
