// @ts-check

export const STAGE_ORDER = /** @type {const} */ ([
  "job-created",
  "repo-selection",
  "repository-sync",
  "codex-execution",
  "synthesis"
]);

const STAGE_LABELS = {
  "job-created": "Job Created",
  "repo-selection": "Repo Selection",
  "repository-sync": "Repository Sync",
  "codex-execution": "Codex Execution",
  synthesis: "Synthesis"
};

const STAGE_WAITING_DETAIL = {
  "job-created": "Your job will be created when you run it.",
  "repo-selection": "Waiting",
  "repository-sync": "Waiting",
  "codex-execution": "Waiting",
  synthesis: "Waiting"
};

const CODEX_STATUS_PREFIX = "[codex]";

/**
 * @typedef {"job-created" | "repo-selection" | "repository-sync" | "codex-execution" | "synthesis"} StageId
 * @typedef {"waiting" | "running" | "ok" | "failed"} StageState
 * @typedef {{ id: StageId, label: string, state: StageState, detail: string, timestamp: string | null }} Stage
 * @typedef {{ stages: Record<StageId, Stage>, activeStage: StageId | null, log: Array<{ message: string, timestamp: string }> }} Pipeline
 *
 * @typedef {{ type: "job-creating" }} JobCreatingEvent
 * @typedef {{ type: "job-created", jobId: string, timestamp: string }} JobCreatedEvent
 * @typedef {{ type: "job-create-failed", message: string }} JobCreateFailedEvent
 * @typedef {{ type: "status", message: string, timestamp: string }} StatusEvent
 * @typedef {{ type: "completed", timestamp: string }} CompletedEvent
 * @typedef {{ type: "failed", message: string, timestamp: string }} FailedEvent
 * @typedef {JobCreatingEvent | JobCreatedEvent | JobCreateFailedEvent | StatusEvent | CompletedEvent | FailedEvent} PipelineEvent
 */

/** @returns {Pipeline} */
export function createInitialPipeline() {
  /** @type {Record<StageId, Stage>} */
  const stages = /** @type {any} */ ({});
  for (const id of STAGE_ORDER) {
    stages[id] = {
      id,
      label: STAGE_LABELS[id],
      state: "waiting",
      detail: STAGE_WAITING_DETAIL[id],
      timestamp: null
    };
  }
  return { stages, activeStage: null, log: [] };
}

/**
 * @param {Pipeline} pipeline
 * @param {PipelineEvent} event
 * @returns {Pipeline}
 */
export function reducePipelineEvent(pipeline, event) {
  switch (event.type) {
    case "job-creating":
      return setStage(pipeline, "job-created", { state: "running", detail: "Submitting..." });
    case "job-created":
      return {
        ...setStage(pipeline, "job-created", {
          state: "ok",
          detail: `Job ${event.jobId}`,
          timestamp: event.timestamp
        }),
        activeStage: "job-created"
      };
    case "job-create-failed":
      return setStage(pipeline, "job-created", {
        state: "failed",
        detail: event.message
      });
    case "status":
      return reduceStatusEvent(pipeline, event);
    case "completed":
      return reduceCompletedEvent(pipeline, event);
    case "failed":
      return reduceFailedEvent(pipeline, event);
    default:
      return pipeline;
  }
}

/**
 * @param {string} message
 * @returns {("repo-selection" | "repository-sync" | "codex-execution" | "synthesis" | null)}
 */
export function mapStatusToStage(message) {
  if (typeof message !== "string") return null;

  if (/synthesis|answer ready|generating answer/i.test(message)) {
    return "synthesis";
  }

  if (message.startsWith(CODEX_STATUS_PREFIX) || /codex|analyzing/i.test(message)) {
    return "codex-execution";
  }

  if (/repository sync|syncing|up to date|cloning|fetching/i.test(message)) {
    return "repository-sync";
  }

  if (/repo selection|selecting repos|selected \d+ repositor/i.test(message)) {
    return "repo-selection";
  }

  return null;
}

/**
 * @param {Pipeline} pipeline
 * @param {StatusEvent} event
 */
function reduceStatusEvent(pipeline, event) {
  const log = appendLog(pipeline.log, event.message, event.timestamp);
  const stage = mapStatusToStage(event.message);
  if (!stage) {
    return { ...pipeline, log };
  }

  let next = { ...pipeline, log };
  for (const earlier of stagesBefore(stage)) {
    const existing = next.stages[earlier];
    if (existing.state === "running") {
      next = setStage(next, earlier, {
        state: "ok",
        timestamp: existing.timestamp ?? event.timestamp
      });
    } else if (existing.state === "waiting") {
      next = setStage(next, earlier, {
        state: "ok",
        timestamp: event.timestamp
      });
    }
  }

  next = setStage(next, stage, {
    state: "running",
    detail: event.message,
    timestamp: event.timestamp
  });
  next = { ...next, activeStage: stage };
  return next;
}

/**
 * @param {Pipeline} pipeline
 * @param {CompletedEvent} event
 */
function reduceCompletedEvent(pipeline, event) {
  let next = pipeline;
  for (const id of STAGE_ORDER) {
    const stage = next.stages[id];
    if (stage.state === "running" || stage.state === "waiting") {
      next = setStage(next, id, {
        state: "ok",
        timestamp: stage.timestamp ?? event.timestamp
      });
    }
  }
  next = setStage(next, "synthesis", {
    state: "ok",
    detail: "Answer ready.",
    timestamp: event.timestamp
  });
  return { ...next, activeStage: "synthesis" };
}

/**
 * @param {Pipeline} pipeline
 * @param {FailedEvent} event
 */
function reduceFailedEvent(pipeline, event) {
  const targetStageId = pipeline.activeStage ?? findRunningStage(pipeline) ?? "job-created";
  const next = setStage(pipeline, targetStageId, {
    state: "failed",
    detail: event.message,
    timestamp: event.timestamp
  });
  return { ...next, log: appendLog(next.log, `ERROR: ${event.message}`, event.timestamp) };
}

/**
 * @param {Pipeline} pipeline
 * @returns {StageId | null}
 */
function findRunningStage(pipeline) {
  for (const id of STAGE_ORDER) {
    if (pipeline.stages[id].state === "running") return id;
  }
  return null;
}

/**
 * @param {string} stage
 * @returns {Array<"repo-selection" | "repository-sync" | "codex-execution" | "synthesis">}
 */
function stagesBefore(stage) {
  const order = ["repo-selection", "repository-sync", "codex-execution", "synthesis"];
  const idx = order.indexOf(stage);
  return idx <= 0 ? [] : /** @type {Array<"repo-selection" | "repository-sync" | "codex-execution" | "synthesis">} */ (order.slice(0, idx));
}

/**
 * @param {Pipeline} pipeline
 * @param {StageId} id
 * @param {Partial<Stage>} updates
 * @returns {Pipeline}
 */
function setStage(pipeline, id, updates) {
  const existing = pipeline.stages[id];
  return {
    ...pipeline,
    stages: {
      ...pipeline.stages,
      [id]: { ...existing, ...updates }
    }
  };
}

/**
 * @param {Array<{ message: string, timestamp: string }>} log
 * @param {string} message
 * @param {string} timestamp
 */
function appendLog(log, message, timestamp) {
  return [...log, { message, timestamp }];
}
