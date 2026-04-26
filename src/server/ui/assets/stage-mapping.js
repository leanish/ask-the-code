// @ts-check

export const STAGE_ORDER = [
  "job-created",
  "repo-selection",
  "repository-sync",
  "codex-execution",
  "synthesis"
];
export const STAGE_IDS = STAGE_ORDER;

const STAGE_LABELS = {
  "job-created": "Job Created",
  "repo-selection": "Repo Selection",
  "repository-sync": "Repository Sync",
  "codex-execution": "Codex Execution",
  synthesis: "Synthesis"
};

const CODEX_STATUS_PREFIX = "Running Codex";

/**
 * @typedef {"job-created" | "repo-selection" | "repository-sync" | "codex-execution" | "synthesis"} StageId
 * @typedef {"waiting" | "running" | "ok" | "failed"} StageState
 * @typedef {{ id: StageId, label: string, state: StageState, detail: string, timestamp: string | null, touched: boolean }} Stage
 * @typedef {{ stages: Record<StageId, Stage>, activeStage: StageId | null, log: Array<{ message: string, timestamp: string }> }} Pipeline
 * @typedef {{ type: "job-creating" | "job-created" | "job-create-failed" | "status" | "completed" | "failed", jobId?: string, message?: string, timestamp?: string }} PipelineEvent
 */

/**
 * @returns {Pipeline}
 */
export function createInitialPipeline() {
  /** @type {Record<StageId, Stage>} */
  const stages = {};
  for (const id of STAGE_ORDER) {
    stages[id] = {
      id,
      label: STAGE_LABELS[id],
      state: "waiting",
      detail: "Waiting",
      timestamp: null,
      touched: false
    };
  }

  return {
    activeStage: null,
    log: [],
    stages
  };
}

/**
 * @param {string} message
 * @returns {StageId | null}
 */
export function mapStatusToStage(message) {
  if (/selecting repos|repo selection|selected \d+ repositor|resolved repos|all repos/i.test(message)) {
    return "repo-selection";
  }

  if (/repository sync|repo sync|syncing|up to date|cloning|updating|fetching|waiting for .* sync/i.test(message)) {
    return "repository-sync";
  }

  if (message.startsWith(CODEX_STATUS_PREFIX) || /codex|analyzing/i.test(message)) {
    return "codex-execution";
  }

  if (/synthesis|answer ready|generating answer|retrieval only/i.test(message)) {
    return "synthesis";
  }

  return null;
}

/**
 * @param {string} message
 * @param {StageId | null} [fallbackStage]
 * @returns {StageId}
 */
export function mapStatusMessageToStage(message, fallbackStage = null) {
  const stage = mapStatusToStage(message);
  if (stage) {
    return stage;
  }

  return fallbackStage ?? "synthesis";
}

/**
 * @param {Pipeline} pipeline
 * @param {PipelineEvent} event
 * @returns {Pipeline}
 */
export function reducePipelineEvent(pipeline, event) {
  const next = clonePipeline(pipeline);
  const timestamp = event.timestamp ?? new Date().toISOString();

  if (event.type === "job-creating") {
    setStage(next, "job-created", "running", "Submitting job...", timestamp, true);
    next.activeStage = "job-created";
    next.log.push({ message: "Submitting job...", timestamp });
    return next;
  }

  if (event.type === "job-created") {
    setStage(next, "job-created", "ok", event.jobId ? `Job ID: ${event.jobId}` : "Job accepted", timestamp, true);
    next.activeStage = null;
    return next;
  }

  if (event.type === "job-create-failed") {
    const message = event.message ?? "Failed to create job.";
    setStage(next, "job-created", "failed", message, timestamp, true);
    next.activeStage = "job-created";
    next.log.push({ message: `ERROR: ${message}`, timestamp });
    return next;
  }

  if (event.type === "status") {
    const message = event.message ?? "";
    const stageId = mapStatusToStage(message) ?? next.activeStage ?? "synthesis";
    markEarlierStagesOk(next, stageId, timestamp);
    setStage(next, stageId, "running", message || "Running", timestamp, true);
    next.activeStage = stageId;
    next.log.push({ message, timestamp });
    return next;
  }

  if (event.type === "completed") {
    completeAllStages(next, timestamp);
    setStage(next, "synthesis", "ok", "Answer ready.", timestamp, true);
    next.activeStage = null;
    return next;
  }

  if (event.type === "failed") {
    const stageId = next.activeStage ?? "job-created";
    const message = event.message ?? "Failed";
    setStage(next, stageId, "failed", message, timestamp, true);
    next.activeStage = stageId;
    next.log.push({ message: `ERROR: ${message}`, timestamp });
    return next;
  }

  return next;
}

/**
 * @param {Pipeline} pipeline
 * @returns {Pipeline}
 */
function clonePipeline(pipeline) {
  /** @type {Record<StageId, Stage>} */
  const stages = {};
  for (const id of STAGE_ORDER) {
    stages[id] = { ...pipeline.stages[id] };
  }

  return {
    activeStage: pipeline.activeStage,
    log: [...pipeline.log],
    stages
  };
}

/**
 * @param {Pipeline} pipeline
 * @param {StageId} stageId
 * @param {StageState} state
 * @param {string} detail
 * @param {string} timestamp
 * @param {boolean} touched
 */
function setStage(pipeline, stageId, state, detail, timestamp, touched) {
  pipeline.stages[stageId] = {
    ...pipeline.stages[stageId],
    detail,
    state,
    timestamp,
    touched: pipeline.stages[stageId].touched || touched
  };
}

/**
 * @param {Pipeline} pipeline
 * @param {StageId} activeStage
 * @param {string} timestamp
 */
function markEarlierStagesOk(pipeline, activeStage, timestamp) {
  const activeIndex = STAGE_ORDER.indexOf(activeStage);
  for (const id of STAGE_ORDER.slice(0, activeIndex)) {
    if (pipeline.stages[id].state !== "failed") {
      setStage(pipeline, id, "ok", pipeline.stages[id].detail === "Waiting" ? "Done" : pipeline.stages[id].detail, pipeline.stages[id].timestamp ?? timestamp, true);
    }
  }
}

/**
 * @param {Pipeline} pipeline
 * @param {string} timestamp
 */
function completeAllStages(pipeline, timestamp) {
  for (const id of STAGE_ORDER) {
    const stage = pipeline.stages[id];
    if (stage.state !== "failed") {
      setStage(pipeline, id, "ok", stage.detail === "Waiting" ? "Done" : stage.detail, stage.timestamp ?? timestamp, true);
    }
  }
}
