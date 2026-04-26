export type StageId =
  | "job-created"
  | "repo-selection"
  | "repository-sync"
  | "codex-execution"
  | "synthesis";

export type StageState = "waiting" | "running" | "ok" | "failed";

export interface Stage {
  id: StageId;
  label: string;
  state: StageState;
  detail: string;
  timestamp: string | null;
}

export interface Pipeline {
  stages: Record<StageId, Stage>;
  activeStage: StageId | null;
  log: Array<{ message: string; timestamp: string }>;
}

export type PipelineEvent =
  | { type: "job-creating" }
  | { type: "job-created"; jobId: string; timestamp: string }
  | { type: "job-create-failed"; message: string }
  | { type: "status"; message: string; timestamp: string }
  | { type: "completed"; timestamp: string }
  | { type: "failed"; message: string; timestamp: string };

export const STAGE_ORDER: readonly StageId[];

export function createInitialPipeline(): Pipeline;
export function reducePipelineEvent(pipeline: Pipeline, event: PipelineEvent): Pipeline;
export function mapStatusToStage(
  message: string
): "repo-selection" | "repository-sync" | "codex-execution" | "synthesis" | null;
