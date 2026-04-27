// @ts-check
//
// Pure browser-side helpers extracted from app.js so they can be unit-tested
// without a DOM. app.js wires DOM lookups to these functions.

const EXPERT_VIEW_IDS = /** @type {const} */ ([
  "new-ask",
  "history",
  "repos",
  "sync-status",
  "config-path",
  "edit-config",
  "init-config",
  "discover",
  "add-repository"
]);

const EXPERT_VIEW_SET = new Set(EXPERT_VIEW_IDS);
const DEFAULT_EXPERT_VIEW = "new-ask";

/**
 * Map a URL hash to a known expert view id. Falls back to "new-ask" for unknown
 * or empty hashes.
 *
 * @param {string} hash
 * @returns {string}
 */
export function getExpertViewFromHash(hash) {
  if (typeof hash !== "string") return DEFAULT_EXPERT_VIEW;
  const id = hash.replace(/^#/u, "");
  return EXPERT_VIEW_SET.has(/** @type {any} */ (id)) ? id : DEFAULT_EXPERT_VIEW;
}

/**
 * @param {Record<string, unknown>} target
 * @param {string} key
 * @param {unknown} value
 * @param {string} defaultValue
 */
function addNonDefaultString(target, key, value, defaultValue) {
  if (typeof value === "string" && value.length > 0 && value !== defaultValue) {
    target[key] = value;
  }
}

/**
 * @param {Record<string, unknown>} target
 * @param {string} key
 * @param {unknown} value
 */
function addTrueBoolean(target, key, value) {
  if (value === true) {
    target[key] = true;
  }
}

/**
 * @typedef {{
 *   audience?: string;
 *   model?: string;
 *   reasoningEffort?: string;
 *   selectionMode?: string;
 *   noSync?: boolean;
 *   noSynthesis?: boolean;
 *   selectionShadowCompare?: boolean;
 * }} AskPayloadOptions
 */

/**
 * Build the JSON body for POST /ask. Simple mode submits only the question;
 * Expert mode adds non-default option fields.
 *
 * @param {string} question
 * @param {"simple" | "expert"} mode
 * @param {AskPayloadOptions} [options]
 * @returns {Record<string, unknown>}
 */
export function createAskPayload(question, mode, options = {}) {
  /** @type {Record<string, unknown>} */
  const payload = { question };
  if (mode !== "expert") return payload;

  addNonDefaultString(payload, "audience", options.audience, "general");
  addNonDefaultString(payload, "model", options.model, "");
  addNonDefaultString(payload, "reasoningEffort", options.reasoningEffort, "");
  addNonDefaultString(payload, "selectionMode", options.selectionMode, "single");
  addTrueBoolean(payload, "noSync", options.noSync);
  addTrueBoolean(payload, "noSynthesis", options.noSynthesis);
  addTrueBoolean(payload, "selectionShadowCompare", options.selectionShadowCompare);
  return payload;
}

/**
 * @typedef {{
 *   parse(input: string): string;
 * }} MarkedLike
 *
 * @typedef {{
 *   sanitize(input: string, options?: unknown): string;
 * }} DomPurifyLike
 *
 * @typedef {{ marked: MarkedLike; DOMPurify: DomPurifyLike }} MarkdownRuntime
 */

/** @returns {MarkdownRuntime | null} */
function getDefaultMarkdownRuntime() {
  if (typeof window === "undefined") return null;
  const w = /** @type {any} */ (window);
  if (!w.marked || !w.DOMPurify) return null;
  return { marked: w.marked, DOMPurify: w.DOMPurify };
}

/**
 * Render markdown to sanitized HTML using `marked` for parsing and `DOMPurify`
 * for sanitization. Pass an explicit runtime to test without a global window.
 *
 * @param {string} text
 * @param {MarkdownRuntime | null} [runtime]
 * @returns {string}
 */
export function renderMarkdownHtml(text, runtime = getDefaultMarkdownRuntime()) {
  if (!runtime) return escapeHtml(text);
  const html = runtime.marked.parse(text);
  return runtime.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

/**
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @typedef {{
 *   name: string;
 *   defaultBranch?: string | null;
 *   description?: string | null;
 *   aliases?: string[];
 * }} RepoSummary
 */

/**
 * Render the All-Repositories panel as a static HTML fragment. Returns an
 * empty-state block when the list is empty.
 *
 * @param {ReadonlyArray<RepoSummary>} repos
 * @param {string | null} [setupHint]
 * @returns {string}
 */
export function renderRepositoryListHtml(repos, setupHint = null) {
  if (!Array.isArray(repos) || repos.length === 0) {
    const message = setupHint && setupHint.trim() ? setupHint : "No configured repos.";
    return `<div class="empty-state"><strong>${escapeHtml(message)}</strong></div>`;
  }

  const rows = repos
    .map(
      repo => `<div class="repo-row"><span aria-hidden="true">📁</span><div><div class="repo-name">${escapeHtml(repo.name)}</div><div class="repo-path">${escapeHtml(repo.description ?? repo.defaultBranch ?? "")}</div></div></div>`
    )
    .join("");
  return `<div class="repo-list">${rows}</div>`;
}

export { EXPERT_VIEW_IDS, DEFAULT_EXPERT_VIEW };
