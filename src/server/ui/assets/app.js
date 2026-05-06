// @ts-check
import {
  createAskPayload,
  getExpertViewFromHash,
  renderMarkdownHtml,
  renderRepositoryListHtml
} from "./client-helpers.js";
import {
  createInitialPipeline,
  reducePipelineEvent,
  STAGE_ORDER
} from "./stage-mapping.js";

const COOKIE_NAME = "atc_mode";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const THEME_STORAGE_KEY = "atc:theme";

const state = {
  /** @type {"simple" | "expert"} */
  mode: document.body.dataset.mode === "expert" ? "expert" : "simple",
  attachments: /** @type {File[]} */ ([]),
  jobId: /** @type {string | null} */ (null),
  jobStartTimestamp: /** @type {number | null} */ (null),
  jobEndTimestamp: /** @type {number | null} */ (null),
  pipeline: createInitialPipeline(),
  currentAnswer: /** @type {string | null} */ (null),
  eventSource: /** @type {EventSource | null} */ (null)
};

/** @param {string} id */
function $(id) {
  return document.getElementById(id);
}

function init() {
  initTheme();
  initThemeToggle();
  initToggles();
  initDropZone();
  initSubmit();
  initModeSwitch();
  initViewRouter();
  initAuth();
  void refreshHistoryBadge();
  renderPipeline();
}

function initTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = stored ?? (prefersDark ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  const button = $("theme-toggle");
  if (button) button.textContent = theme === "dark" ? "🌙" : "☀";
}

function initThemeToggle() {
  const button = $("theme-toggle");
  if (!button) return;
  button.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_STORAGE_KEY, next);
    button.textContent = next === "dark" ? "🌙" : "☀";
  });
}

async function initAuth() {
  const signinButton = $("github-signin");
  const userBox = $("auth-user");
  const logoutButton = $("auth-logout");
  const nameEl = $("auth-name");
  const avatarEl = /** @type {HTMLImageElement | null} */ ($("auth-avatar"));
  const area = $("auth-area");
  if (!signinButton || !userBox || !logoutButton || !nameEl || !avatarEl || !area) return;

  signinButton.addEventListener("click", () => {
    window.location.assign("/auth/github/login");
  });
  logoutButton.addEventListener("click", async () => {
    try {
      await fetch("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    window.location.reload();
  });

  try {
    const response = await fetch("/auth/me", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.authenticated && data.user) {
      area.dataset.authState = "signed-in";
      userBox.hidden = false;
      signinButton.hidden = true;
      nameEl.textContent = data.user.name || data.user.login;
      if (data.user.avatarUrl) {
        avatarEl.src = data.user.avatarUrl;
      }
    } else if (data.configured) {
      area.dataset.authState = "signed-out";
      signinButton.hidden = false;
      userBox.hidden = true;
    } else {
      area.dataset.authState = "unconfigured";
      signinButton.hidden = false;
      userBox.hidden = true;
      signinButton.addEventListener(
        "click",
        e => {
          e.preventDefault();
          showToast("GitHub sign-in not configured. Set ATC_GITHUB_CLIENT_ID, ATC_GITHUB_CLIENT_SECRET, ATC_SESSION_SECRET.");
        },
        { capture: true, once: false }
      );
    }
  } catch {
    area.dataset.authState = "error";
    signinButton.hidden = false;
    userBox.hidden = true;
  }
}

function initToggles() {
  const toggleLog = $("toggle-full-log");
  const log = $("full-log");
  if (toggleLog && log) {
    toggleLog.addEventListener("click", () => {
      log.classList.toggle("visible");
      toggleLog.textContent = log.classList.contains("visible") ? "Hide Full Log" : "View Full Log";
    });
  }
  const copyAnswer = $("copy-answer");
  if (copyAnswer) {
    copyAnswer.addEventListener("click", async () => {
      if (!state.currentAnswer) return;
      try {
        await navigator.clipboard.writeText(state.currentAnswer);
        showToast("Answer copied");
      } catch {
        showToast("Copy failed");
      }
    });
  }
  const downloadAnswer = $("download-answer");
  if (downloadAnswer) {
    downloadAnswer.addEventListener("click", () => {
      if (!state.currentAnswer) return;
      const blob = new Blob([state.currentAnswer], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "answer.md";
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}

function initDropZone() {
  const zone = $("drop-zone");
  const input = /** @type {HTMLInputElement | null} */ ($("file-input"));
  const attach = $("attach-button");
  if (!zone || !input || !attach) return;

  attach.addEventListener("click", e => {
    e.preventDefault();
    input.click();
  });
  zone.addEventListener("click", () => input.click());

  ["dragenter", "dragover"].forEach(evt =>
    zone.addEventListener(evt, e => {
      e.preventDefault();
      zone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach(evt =>
    zone.addEventListener(evt, e => {
      e.preventDefault();
      zone.classList.remove("dragover");
    })
  );
  zone.addEventListener("drop", e => {
    const files = /** @type {DragEvent} */ (e).dataTransfer?.files;
    if (files) addFiles(Array.from(files));
  });
  input.addEventListener("change", () => {
    if (input.files) addFiles(Array.from(input.files));
  });
}

/** @param {File[]} files */
function addFiles(files) {
  for (const file of files) {
    state.attachments.push(file);
  }
  renderFileList();
}

function renderFileList() {
  const list = $("file-list");
  const banner = $("attach-banner");
  if (!list) return;
  list.innerHTML = "";
  state.attachments.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "file-row";
    row.innerHTML = `
      <span aria-hidden="true">📄</span>
      <div><div class="name"></div><div class="meta"></div></div>
      <span class="ok">✓ Uploaded</span>
      <button class="remove" type="button" aria-label="Remove">✕</button>`;
    const nameEl = row.querySelector(".name");
    const metaEl = row.querySelector(".meta");
    const removeEl = row.querySelector("button.remove");
    if (nameEl) nameEl.textContent = file.name;
    if (metaEl) metaEl.textContent = `${file.type || "file"} · ${formatSize(file.size)}`;
    if (removeEl) {
      removeEl.addEventListener("click", () => {
        state.attachments.splice(index, 1);
        renderFileList();
      });
    }
    list.appendChild(row);
  });
  if (banner) banner.hidden = state.attachments.length === 0;
}

/** @param {number} bytes */
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initSubmit() {
  const button = $("ask-button");
  if (!button) return;
  button.addEventListener("click", () => void submitAsk());
}

async function submitAsk() {
  const textarea = /** @type {HTMLTextAreaElement | null} */ ($("question"));
  if (!textarea || !textarea.value.trim()) return;

  resetRun();
  dispatch({ type: "job-creating" });
  state.jobStartTimestamp = Date.now();

  const payload = buildPayload(textarea.value.trim());
  const button = /** @type {HTMLButtonElement | null} */ ($("ask-button"));
  if (button) {
    button.disabled = true;
    button.textContent = "Asking...";
  }

  try {
    const response = state.attachments.length > 0
      ? await fetch("/ask", { method: "POST", body: buildMultipart(payload, state.attachments) })
      : await fetch("/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? `HTTP ${response.status}`);
    }
    state.jobId = data.id;
    dispatch({
      type: "job-created",
      jobId: data.id,
      timestamp: new Date().toLocaleTimeString()
    });
    connectSse(data.links.events);
  } catch (error) {
    dispatch({
      type: "job-create-failed",
      message: error instanceof Error ? error.message : String(error)
    });
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.defaultLabel ?? "Ask";
    }
  }
}

/**
 * @param {import("./stage-mapping.js").PipelineEvent} event
 */
function dispatch(event) {
  state.pipeline = reducePipelineEvent(state.pipeline, event);
  renderPipeline();
}

/**
 * @param {Record<string, unknown>} payload
 * @param {File[]} files
 */
function buildMultipart(payload, files) {
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  files.forEach((file, index) => {
    form.append(`file_${index}`, file, file.name);
  });
  return form;
}

/** @param {string} question */
function buildPayload(question) {
  return createAskPayload(question, state.mode, {
    audience: readSelect("opt-audience") ?? undefined,
    model: readSelect("opt-model") ?? undefined,
    reasoningEffort: readSelect("opt-reasoning") ?? undefined,
    selectionMode: readSelect("opt-selection-mode") ?? undefined,
    noSync: readChecked("opt-no-sync"),
    noSynthesis: readChecked("opt-no-synthesis"),
    selectionShadowCompare: readChecked("opt-shadow-compare")
  });
}

/** @param {string} id */
function readSelect(id) {
  const el = /** @type {HTMLSelectElement | null} */ (document.getElementById(id));
  return el && el.value ? el.value : null;
}

/** @param {string} id */
function readChecked(id) {
  const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
  return Boolean(el && el.checked);
}

/** @param {string} url */
function connectSse(url) {
  closeSse();
  const source = new EventSource(url);
  state.eventSource = source;
  source.addEventListener("status", evt => {
    const data = parseSafe(/** @type {MessageEvent} */ (evt).data);
    if (data && typeof data.message === "string") {
      dispatch({
        type: "status",
        message: data.message,
        timestamp: data.timestamp ?? new Date().toLocaleTimeString()
      });
    }
  });
  source.addEventListener("snapshot", evt => {
    handleSnapshot(parseSafe(/** @type {MessageEvent} */ (evt).data));
  });
  source.addEventListener("completed", () => {
    closeSse();
  });
  source.addEventListener("failed", evt => {
    const data = parseSafe(/** @type {MessageEvent} */ (evt).data);
    failRun((data && data.message) || "Job failed.");
    closeSse();
  });
  source.addEventListener("error", () => {
    /* SSE auto-reconnects on transient errors; nothing to do. */
  });
}

function closeSse() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

/** @param {{ status?: string; result?: { synthesis?: { text?: string }; selectedRepos?: Array<{ name: string; path?: string }> }; error?: string } | null} job */
function handleSnapshot(job) {
  if (!job) return;
  if (job.status === "completed") completeRun(job);
  else if (job.status === "failed") failRun(job.error ?? "Job failed.");
}

/** @param {{ result?: { synthesis?: { text?: string }; selectedRepos?: Array<{ name: string; path?: string }> } }} job */
function completeRun(job) {
  state.jobEndTimestamp = Date.now();
  dispatch({ type: "completed", timestamp: new Date().toLocaleTimeString() });

  const answerText = job.result?.synthesis?.text ?? "";
  state.currentAnswer = answerText;
  if (answerText) renderAnswer(answerText);

  const repos = Array.isArray(job.result?.selectedRepos) ? job.result.selectedRepos : [];
  renderRepos(repos);
  updateRunSummary(repos.length);

  const success = $("run-summary-success");
  if (success) success.hidden = false;

  const button = /** @type {HTMLButtonElement | null} */ ($("ask-button"));
  if (button) {
    button.disabled = false;
    button.textContent = button.dataset.defaultLabel ?? "Ask";
  }
  void refreshHistoryBadge();
}

/** @param {string} message */
function failRun(message) {
  dispatch({ type: "failed", message, timestamp: new Date().toLocaleTimeString() });
  const button = /** @type {HTMLButtonElement | null} */ ($("ask-button"));
  if (button) {
    button.disabled = false;
    button.textContent = button.dataset.defaultLabel ?? "Ask";
  }
  void refreshHistoryBadge();
}

function renderPipeline() {
  for (const id of STAGE_ORDER) {
    const stage = state.pipeline.stages[id];
    const item = /** @type {HTMLElement | null} */ (document.querySelector(`.progress-item[data-stage="${id}"]`));
    if (!item) continue;
    item.dataset.state = stage.state;
    const sub = item.querySelector(".progress-sub");
    const t = item.querySelector(".progress-time");
    if (sub) sub.textContent = stage.detail;
    if (t) t.textContent = stage.timestamp ?? "";
  }
  const log = $("full-log");
  if (log) {
    log.textContent = state.pipeline.log.map(entry => `${entry.timestamp} ${entry.message}`).join("\n");
    log.scrollTop = log.scrollHeight;
  }
}

/** @param {string} text */
function renderAnswer(text) {
  const card = $("answer-card");
  const target = $("answer");
  if (!card || !target) return;
  target.innerHTML = renderMarkdownHtml(text);
  card.hidden = false;
}

/** @param {Array<{ name: string; path?: string }>} repos */
function renderRepos(repos) {
  const empty = $("after-empty");
  const content = $("after-content");
  const list = $("after-repos");
  if (!list || !content || !empty) return;
  if (repos.length === 0) return;
  empty.hidden = true;
  content.hidden = false;
  list.innerHTML = "";
  for (const repo of repos) {
    const row = document.createElement("div");
    row.className = "repo-row";
    row.innerHTML = `<span>📁</span><div><div class="repo-name"></div><div class="repo-path"></div></div>`;
    const nameEl = row.querySelector(".repo-name");
    const pathEl = row.querySelector(".repo-path");
    if (nameEl) nameEl.textContent = repo.name;
    if (pathEl) pathEl.textContent = repo.path ?? "";
    list.appendChild(row);
  }
}

/** @param {number} repoCount */
function updateRunSummary(repoCount) {
  const repoEl = $("summary-repo-count");
  const durationEl = $("summary-duration");
  const stepsEl = $("summary-steps");
  if (repoEl) repoEl.textContent = String(repoCount);
  if (durationEl && state.jobStartTimestamp && state.jobEndTimestamp) {
    durationEl.textContent = formatDuration(state.jobEndTimestamp - state.jobStartTimestamp);
  }
  if (stepsEl) {
    let completed = 0;
    for (const id of STAGE_ORDER) {
      if (state.pipeline.stages[id].state === "ok") completed += 1;
    }
    stepsEl.textContent = String(completed);
  }
}

/** @param {number} ms */
function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function resetRun() {
  closeSse();
  state.jobId = null;
  state.currentAnswer = null;
  state.jobStartTimestamp = null;
  state.jobEndTimestamp = null;
  state.pipeline = createInitialPipeline();
  renderPipeline();
  const card = $("answer-card");
  if (card) card.hidden = true;
  const success = $("run-summary-success");
  if (success) success.hidden = true;
  const empty = $("after-empty");
  const content = $("after-content");
  if (empty && content) {
    empty.hidden = false;
    content.hidden = true;
  }
}

/** @param {string} message */
function showToast(message) {
  const region = document.querySelector("[data-toast-region]") ?? document.body;
  const existing = region.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

/** @param {unknown} text */
function parseSafe(text) {
  try {
    return JSON.parse(typeof text === "string" ? text : "");
  } catch {
    return null;
  }
}

/** @param {"simple" | "expert"} nextMode */
export function setMode(nextMode) {
  if (nextMode === state.mode) return;
  state.mode = nextMode;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(nextMode)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  document.body.dataset.mode = nextMode;
  const shell = document.querySelector(".app-shell");
  if (shell instanceof HTMLElement) shell.dataset.mode = nextMode;
  document.querySelectorAll(".mode-switch button[data-mode]").forEach(btn => {
    if (btn instanceof HTMLElement) {
      btn.setAttribute("aria-pressed", String(btn.dataset.mode === nextMode));
    }
  });
  const url = new URL(window.location.href);
  url.searchParams.set("mode", nextMode);
  window.history.replaceState(null, "", url.toString());
}

function initModeSwitch() {
  const buttons = document.querySelectorAll(".mode-switch button[data-mode]");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn instanceof HTMLElement ? btn.dataset.mode : null;
      if (target === "simple" || target === "expert") setMode(target);
    });
  });
}

function initViewRouter() {
  const links = document.querySelectorAll(".sidebar-link[data-view]");
  links.forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const id = link instanceof HTMLElement ? link.dataset.view : null;
      if (!id) return;
      activateView(id);
      history.replaceState(null, "", `#${id}`);
    });
  });
  activateView(getExpertViewFromHash(window.location.hash));
}

/** @param {string} viewId */
function activateView(viewId) {
  const target = getExpertViewFromHash(`#${viewId}`);
  const shell = document.querySelector(".app-shell");
  if (shell instanceof HTMLElement) shell.dataset.view = target;
  document.querySelectorAll(".sidebar-link[data-view]").forEach(link => {
    if (link instanceof HTMLElement) {
      if (link.dataset.view === target) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  });
  document.querySelectorAll(".expert-view-panel[data-view-panel]").forEach(panel => {
    if (panel instanceof HTMLElement) {
      panel.hidden = panel.dataset.viewPanel !== target;
    }
  });
  if (target === "repos") void renderRepoList();
  if (target === "history") void renderHistoryView();
}

async function refreshHistoryBadge() {
  const badge = document.querySelector('[data-badge="history"]');
  if (!badge) return;
  try {
    const response = await fetch("/history", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const data = await response.json();
    badge.textContent = String(data.total ?? 0);
  } catch {
    /* leave the placeholder */
  }
}

async function renderHistoryView() {
  const target = document.querySelector('[data-view-panel="history"]');
  if (!target) return;
  try {
    const response = await fetch("/history", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    /** @type {Array<{id:string;question:string;status:string;createdAt:string;finishedAt:string|null;repos:string[]}>} */
    const items = Array.isArray(data.items) ? data.items : [];
    target.innerHTML = `<h2>History</h2><div data-history-list></div>`;
    const list = target.querySelector("[data-history-list]");
    if (!list) return;
    if (items.length === 0) {
      list.innerHTML = `<div class="empty-state"><strong>No previous questions yet.</strong><div>Ask something to start a history.</div></div>`;
      return;
    }
    list.innerHTML = "";
    for (const item of items) {
      const row = document.createElement("article");
      row.className = "history-row";
      const repos = item.repos.length > 0 ? item.repos.join(", ") : "—";
      row.innerHTML = `
        <header>
          <strong></strong>
          <span class="history-status" data-status=""></span>
        </header>
        <p class="history-question"></p>
        <footer>
          <span class="history-meta"></span>
        </footer>`;
      const titleEl = row.querySelector("strong");
      const statusEl = row.querySelector(".history-status");
      const questionEl = row.querySelector(".history-question");
      const metaEl = row.querySelector(".history-meta");
      if (titleEl) titleEl.textContent = item.id;
      if (statusEl) {
        statusEl.textContent = item.status;
        if (statusEl instanceof HTMLElement) statusEl.dataset.status = item.status;
      }
      if (questionEl) questionEl.textContent = item.question;
      if (metaEl) {
        const finished = item.finishedAt ? ` · finished ${item.finishedAt}` : "";
        metaEl.textContent = `created ${item.createdAt}${finished} · ${repos}`;
      }
      list.appendChild(row);
    }
    void refreshHistoryBadge();
  } catch {
    target.innerHTML = `<h2>History</h2><div class="empty-state"><strong>Could not load history.</strong></div>`;
  }
}

async function renderRepoList() {
  const target = document.querySelector('[data-view-panel="repos"] [data-repos-view]');
  if (!target) return;
  try {
    const response = await fetch("/repos", { headers: { Accept: "application/json" } });
    const data = await response.json();
    const repos = Array.isArray(data.repos) ? data.repos : [];
    target.innerHTML = renderRepositoryListHtml(repos, data.setupHint ?? null);
  } catch (error) {
    console.error("repos fetch failed", error);
    target.innerHTML = renderRepositoryListHtml([], "Could not load repositories.");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
