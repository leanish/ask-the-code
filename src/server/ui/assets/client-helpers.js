// @ts-check

export const DEFAULT_ADVANCED_VIEW = "new-ask";
export const DEFAULT_ADVANCED_MODEL = "gpt-5.4-mini";
export const DEFAULT_ADVANCED_REASONING_EFFORT = "low";
export const MODE_COOKIE_MAX_AGE_SECONDS = 31_536_000;
export const ADVANCED_VIEW_IDS = [
  "new-ask",
  "history",
  "repos",
  "sync-status",
  "config-path",
  "edit-config",
  "init-config",
  "discover",
  "add-repository"
];

const ADVANCED_VIEWS = new Set(ADVANCED_VIEW_IDS);

/**
 * @typedef {{ marked: { parse(input: string): string }, DOMPurify: { sanitize(input: string, options?: unknown): string } }} MarkdownRuntime
 */

/**
 * @param {string} text
 * @param {MarkdownRuntime | null} [runtime]
 * @returns {string}
 */
export function renderMarkdownHtml(text, runtime = getMarkdownRuntime()) {
  if (!runtime?.marked || !runtime.DOMPurify) {
    return escapeHtml(text);
  }

  return runtime.DOMPurify.sanitize(runtime.marked.parse(text), {
    USE_PROFILES: { html: true }
  });
}

/**
 * @param {string} question
 * @param {"simple" | "advanced"} mode
 * @param {Record<string, unknown>} [options]
 * @param {Array<{ name: string, mediaType: string, contentBase64: string }>} [attachments]
 * @returns {Record<string, unknown>}
 */
export function createAskPayload(question, mode, options = {}, attachments = []) {
  const payload = { question };
  if (attachments.length > 0) {
    payload.attachments = attachments;
  }
  if (mode !== "advanced") {
    return payload;
  }

  addNonDefaultString(payload, "audience", options.audience, "general");
  addNonDefaultString(payload, "model", options.model, DEFAULT_ADVANCED_MODEL);
  addNonDefaultString(payload, "reasoningEffort", options.reasoningEffort, DEFAULT_ADVANCED_REASONING_EFFORT);
  addNonDefaultString(payload, "selectionMode", options.selectionMode, "single");
  addTrueBoolean(payload, "noSync", options.noSync);
  addTrueBoolean(payload, "noSynthesis", options.noSynthesis);
  addTrueBoolean(payload, "selectionShadowCompare", options.selectionShadowCompare);
  return payload;
}

/**
 * @param {Record<string, unknown>} payload
 * @param {File[]} files
 * @returns {FormData}
 */
export function createAskFormData(payload, files) {
  const formData = new FormData();
  formData.set("payload", JSON.stringify(payload));
  files.forEach((file, index) => {
    formData.set(`file_${index}`, file, file.name);
  });
  return formData;
}

/**
 * @param {string} hash
 * @returns {string}
 */
export function getAdvancedViewFromHash(hash) {
  const view = hash.replace(/^#/u, "");
  return ADVANCED_VIEWS.has(view) ? view : DEFAULT_ADVANCED_VIEW;
}

/**
 * @param {"simple" | "advanced"} mode
 * @returns {string}
 */
export function formatModeCookie(mode) {
  return `atc_mode=${mode}; Path=/; Max-Age=${MODE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

/**
 * @param {Array<{ name: string, defaultBranch?: string | null, aliases?: string[], description?: string | null }>} repos
 * @param {string | null} [setupHint]
 * @returns {string}
 */
export function renderRepositoryListHtml(repos, setupHint = null) {
  if (repos.length === 0) {
    return `<div class="empty-state">${escapeHtml(setupHint ?? "No configured repositories yet.")}</div>`;
  }

  return `<div class="repository-list">${repos.map(repo => `
    <article class="repository-item">
      <div>
        <h3>${escapeHtml(repo.name)}</h3>
        <p>${escapeHtml(repo.description ?? "No description.")}</p>
      </div>
      <dl>
        <div><dt>Default branch</dt><dd>${escapeHtml(repo.defaultBranch ?? "unknown")}</dd></div>
        <div><dt>Aliases</dt><dd>${escapeHtml((repo.aliases ?? []).join(", ") || "none")}</dd></div>
      </dl>
    </article>
  `).join("")}</div>`;
}

/**
 * @param {{ stages: Record<string, { state: string, detail: string, timestamp: string | null, touched: boolean }> }} pipeline
 * @returns {string}
 */
export function getProgressPanelSummary(pipeline) {
  const stages = Object.values(pipeline.stages);
  const failed = stages.find(stage => stage.state === "failed");
  if (failed) {
    return failed.detail;
  }

  const running = stages.find(stage => stage.state === "running");
  if (running) {
    return running.detail;
  }

  const latestTouched = stages
    .filter(stage => stage.touched)
    .sort((left, right) => Date.parse(right.timestamp ?? "") - Date.parse(left.timestamp ?? ""))[0];

  return latestTouched?.detail ?? "Waiting for a question.";
}

/**
 * @param {{
 *   pipeline: { stages: Record<string, { state: string, timestamp: string | null }> },
 *   repos: Array<{ name?: string }>,
 *   status?: string
 * }} input
 * @returns {{ badge: string, summary: string }}
 */
export function summarizeRun({ pipeline, repos, status }) {
  const repoCount = repos.length;
  const completedSteps = Object.values(pipeline.stages).filter(stage => stage.state === "ok").length;
  const totalSteps = Object.keys(pipeline.stages).length;
  const duration = formatPipelineDuration(pipeline);
  return {
    badge: status === "completed" ? "Completed successfully" : "",
    summary: [
      `${repoCount} repositor${repoCount === 1 ? "y" : "ies"} used.`,
      duration ? `Total duration: ${duration}.` : "",
      `Steps completed: ${completedSteps}/${totalSteps}.`
    ].filter(Boolean).join(" ")
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}

/**
 * @returns {MarkdownRuntime | null}
 */
function getMarkdownRuntime() {
  if (typeof window === "undefined") {
    return null;
  }

  const runtime = /** @type {Partial<MarkdownRuntime>} */ (window);
  if (!runtime.marked || !runtime.DOMPurify) {
    return null;
  }

  return /** @type {MarkdownRuntime} */ (runtime);
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} key
 * @param {unknown} value
 * @param {string} defaultValue
 */
function addNonDefaultString(payload, key, value, defaultValue) {
  if (typeof value === "string" && value !== "" && value !== defaultValue) {
    payload[key] = value;
  }
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} key
 * @param {unknown} value
 */
function addTrueBoolean(payload, key, value) {
  if (value === true) {
    payload[key] = true;
  }
}

/**
 * @param {{ stages: Record<string, { timestamp: string | null }> }} pipeline
 * @returns {string}
 */
function formatPipelineDuration(pipeline) {
  const timestamps = Object.values(pipeline.stages)
    .map(stage => stage.timestamp)
    .filter(value => typeof value === "string")
    .map(value => Date.parse(value));
  if (timestamps.length < 2 || timestamps.some(Number.isNaN)) {
    return "";
  }

  return formatDuration(Math.max(...timestamps) - Math.min(...timestamps));
}

/**
 * @param {number} milliseconds
 * @returns {string}
 */
function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}
