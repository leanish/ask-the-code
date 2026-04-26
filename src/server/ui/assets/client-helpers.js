// @ts-check

export const DEFAULT_EXPERT_VIEW = "new-ask";
export const DEFAULT_EXPERT_MODEL = "gpt-5.4-mini";
export const DEFAULT_EXPERT_REASONING_EFFORT = "low";
export const EXPERT_VIEW_IDS = [
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

const EXPERT_VIEWS = new Set(EXPERT_VIEW_IDS);

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
 * @param {"simple" | "expert"} mode
 * @param {Record<string, unknown>} [options]
 * @param {Array<{ name: string, mediaType: string, contentBase64: string }>} [attachments]
 * @returns {Record<string, unknown>}
 */
export function createAskPayload(question, mode, options = {}, attachments = []) {
  const payload = { question };
  if (attachments.length > 0) {
    payload.attachments = attachments;
  }
  if (mode !== "expert") {
    return payload;
  }

  addNonDefaultString(payload, "audience", options.audience, "general");
  addNonDefaultString(payload, "model", options.model, DEFAULT_EXPERT_MODEL);
  addNonDefaultString(payload, "reasoningEffort", options.reasoningEffort, DEFAULT_EXPERT_REASONING_EFFORT);
  addNonDefaultString(payload, "selectionMode", options.selectionMode, "single");
  addTrueBoolean(payload, "noSync", options.noSync);
  addTrueBoolean(payload, "noSynthesis", options.noSynthesis);
  addTrueBoolean(payload, "selectionShadowCompare", options.selectionShadowCompare);
  return payload;
}

/**
 * @param {string} hash
 * @returns {string}
 */
export function getExpertViewFromHash(hash) {
  const view = hash.replace(/^#/u, "");
  return EXPERT_VIEWS.has(view) ? view : DEFAULT_EXPERT_VIEW;
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
