export type StageId = "job-created" | "repo-selection" | "repository-sync" | "codex-execution" | "synthesis";
export type StageState = "waiting" | "running" | "ok" | "failed";
export type Stage = {
  id: StageId;
  label: string;
  state: StageState;
  detail: string;
  timestamp: string | null;
  touched: boolean;
};
export type Pipeline = {
  stages: Record<StageId, Stage>;
  activeStage: StageId | null;
  log: Array<{ message: string; timestamp: string }>;
};
export type PipelineEvent = {
  type: "job-creating" | "job-created" | "job-create-failed" | "status" | "completed" | "failed";
  jobId?: string;
  message?: string;
  timestamp?: string;
};
export const STAGE_ORDER: StageId[];
export const STAGE_IDS: StageId[];
export function createInitialPipeline(): Pipeline;
export function mapStatusToStage(message: string): StageId | null;
export function mapStatusMessageToStage(message: string, fallbackStage?: StageId | null): StageId;
export function reducePipelineEvent(pipeline: Pipeline, event: PipelineEvent): Pipeline;
