// @ts-check

import {
  createAskPayload,
  escapeHtml,
  getExpertViewFromHash,
  getProgressPanelSummary,
  renderMarkdownHtml,
  renderRepositoryListHtml
} from "./client-helpers.js";
import { createInitialPipeline, reducePipelineEvent, STAGE_IDS } from "./stage-mapping.js";

const THEME_STORAGE_KEY = "atc:theme";
const MAX_CLIENT_ATTACHMENTS = 8;
const MAX_CLIENT_ATTACHMENT_BYTES = 1024 * 1024;

if (typeof document !== "undefined") {
  initApp();
}

function initApp() {
  const elements = getElements();
  let pipeline = createInitialPipeline();
  let currentAnswer = "";
  let askBlockedByAuth = false;
  /** @type {Array<{ name: string, mediaType: string, contentBase64: string, size: number }>} */
  let attachedFiles = [];
  /** @type {EventSource | null} */
  let eventSource = null;

  applyInitialTheme(elements);
  bindCollapsiblePanels();
  bindModeSwitch(elements);
  bindExpertViews(elements);
  elements.onAuthSession = session => {
    askBlockedByAuth = session.githubConfigured && !session.authenticated;
    setAskAuthState(elements, askBlockedByAuth);
  };
  void initAuth(elements);
  renderPipeline(elements, pipeline);

  elements.themeToggle?.addEventListener("click", () => {
    const currentTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(currentTheme, elements);
  });

  elements.browseFiles?.addEventListener("click", () => {
    elements.fileInput?.click();
  });

  elements.fileInput?.addEventListener("change", async () => {
    attachedFiles = await addAttachedFiles(elements, attachedFiles, Array.from(elements.fileInput?.files ?? []));
    if (elements.fileInput) {
      elements.fileInput.value = "";
    }
    renderAttachedFiles(elements, attachedFiles, nextFiles => {
      attachedFiles = nextFiles;
    });
  });

  elements.dropZone?.addEventListener("dragover", event => {
    event.preventDefault();
    elements.dropZone?.classList.add("dragging");
  });
  elements.dropZone?.addEventListener("dragleave", () => {
    elements.dropZone?.classList.remove("dragging");
  });
  elements.dropZone?.addEventListener("drop", async event => {
    event.preventDefault();
    elements.dropZone?.classList.remove("dragging");
    attachedFiles = await addAttachedFiles(elements, attachedFiles, Array.from(event.dataTransfer?.files ?? []));
    renderAttachedFiles(elements, attachedFiles, nextFiles => {
      attachedFiles = nextFiles;
    });
  });

  elements.logToggle?.addEventListener("click", () => {
    const isHidden = elements.statusLog?.hidden ?? true;
    if (elements.statusLog) {
      elements.statusLog.hidden = !isHidden;
    }
    if (elements.logToggle) {
      elements.logToggle.textContent = isHidden ? "Hide Full Log" : "View Full Log";
    }
  });

  elements.copyAnswer?.addEventListener("click", async () => {
    if (!currentAnswer) {
      return;
    }

    await navigator.clipboard?.writeText(currentAnswer);
    showToast(elements, "Answer copied.");
  });

  elements.downloadAnswer?.addEventListener("click", () => {
    if (!currentAnswer) {
      return;
    }

    const blob = new Blob([currentAnswer], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ask-the-code-answer.md";
    link.click();
    URL.revokeObjectURL(url);
  });

  elements.form?.addEventListener("submit", async event => {
    event.preventDefault();
    if (askBlockedByAuth) {
      showToast(elements, "Sign in with GitHub before asking a question.");
      return;
    }

    const question = elements.question?.value.trim() ?? "";
    if (!question) {
      elements.question?.focus();
      return;
    }

    eventSource?.close();
    currentAnswer = "";
    setSubmitting(elements, true);
    setAnswer(elements, "");
    pipeline = createInitialPipeline();
    pipeline = reducePipelineEvent(pipeline, {
      type: "job-creating",
      timestamp: new Date().toISOString()
    });
    renderPipeline(elements, pipeline);

    try {
      const response = await fetch("/ask", {
        body: JSON.stringify(createAskPayload(question, getCurrentMode(), readExpertOptions(), attachedFiles.map(({ size: _size, ...attachment }) => attachment))),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Request failed with ${response.status}`);
      }

      pipeline = reducePipelineEvent(pipeline, {
        type: "job-created",
        jobId: typeof payload.id === "string" ? payload.id : undefined,
        timestamp: new Date().toISOString()
      });
      renderPipeline(elements, pipeline);
      eventSource = subscribeToJob(payload.links?.events ?? `/jobs/${payload.id}/events`, {
        onComplete(job) {
          setSubmitting(elements, false);
          currentAnswer = getAnswerText(job);
          setAnswer(elements, currentAnswer);
          renderSelectedRepos(elements, job.result?.selectedRepos ?? []);
          pipeline = reducePipelineEvent(pipeline, {
            type: "completed",
            timestamp: new Date().toISOString()
          });
          renderPipeline(elements, pipeline);
        },
        onFailed(eventPayload) {
          setSubmitting(elements, false);
          pipeline = reducePipelineEvent(pipeline, {
            type: "failed",
            message: eventPayload.error ?? "Run failed",
            timestamp: new Date().toISOString()
          });
          renderPipeline(elements, pipeline);
          showToast(elements, eventPayload.error ?? "Run failed.");
        },
        onStatus(message) {
          pipeline = reducePipelineEvent(pipeline, {
            type: "status",
            message,
            timestamp: new Date().toISOString()
          });
          renderPipeline(elements, pipeline);
        }
      });
    } catch (error) {
      setSubmitting(elements, false);
      pipeline = reducePipelineEvent(pipeline, {
        type: "job-create-failed",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      renderPipeline(elements, pipeline);
      showToast(elements, error instanceof Error ? error.message : String(error));
    }
  });
}

function getElements() {
  return {
    answerContent: document.querySelector("[data-answer-content]"),
    answerPanel: document.querySelector("[data-answer-panel]"),
    browseFiles: document.querySelector("[data-browse-files]"),
    copyAnswer: document.querySelector("[data-copy-answer]"),
    downloadAnswer: document.querySelector("[data-download-answer]"),
    dropZone: document.querySelector("[data-drop-zone]"),
    fileInput: /** @type {HTMLInputElement | null} */ (document.querySelector("[data-file-input]")),
    fileList: document.querySelector("[data-file-list]"),
    form: document.querySelector("[data-ask-form]"),
    authSignins: Array.from(document.querySelectorAll("[data-auth-signin]")),
    logToggle: document.querySelector("[data-log-toggle]"),
    progressSummary: document.querySelector("[data-progress-summary]"),
    question: /** @type {HTMLTextAreaElement | null} */ (document.querySelector("[data-question-input]")),
    runEmpty: document.querySelector("[data-run-empty]"),
    runSummary: document.querySelector("[data-run-summary]"),
    selectedRepos: document.querySelector("[data-selected-repos]"),
    statusLog: /** @type {HTMLPreElement | null} */ (document.querySelector("[data-status-log]")),
    submitButton: /** @type {HTMLButtonElement | null} */ (document.querySelector("[data-submit-button]")),
    themeIcon: document.querySelector("[data-theme-icon]"),
    themeToggle: document.querySelector("[data-theme-toggle]"),
    toastRegion: document.querySelector("[data-toast-region]")
  };
}

function bindModeSwitch(elements) {
  document.querySelectorAll("[data-mode-target]").forEach(button => {
    button.addEventListener("click", () => {
      const mode = button.getAttribute("data-mode-target");
      if (mode !== "simple" && mode !== "expert") {
        return;
      }

      document.body.dataset.mode = mode;
      document.querySelector("[data-app-root]")?.setAttribute("data-mode", mode);
      document.cookie = `atc_mode=${mode}; Path=/; Max-Age=31536000; SameSite=Lax`;
      const url = new URL(window.location.href);
      url.searchParams.set("mode", mode);
      history.replaceState(null, "", url);
      updateModeSwitch(mode);
      activateExpertView(getExpertViewFromHash(window.location.hash));
      showToast(elements, `${mode === "expert" ? "Expert" : "Simple"} mode`);
    });
  });
  updateModeSwitch(getCurrentMode());
}

function bindExpertViews(elements) {
  window.addEventListener("hashchange", () => {
    activateExpertView(getExpertViewFromHash(window.location.hash));
  });
  document.querySelectorAll("[data-view-link]").forEach(link => {
    link.addEventListener("click", () => {
      const view = link.getAttribute("data-view-link") ?? "new-ask";
      activateExpertView(getExpertViewFromHash(`#${view}`));
    });
  });
  activateExpertView(getExpertViewFromHash(window.location.hash));
}

function bindCollapsiblePanels() {
  document.querySelectorAll("[data-collapsible-trigger]").forEach(trigger => {
    trigger.addEventListener("click", () => {
      const panelId = trigger.getAttribute("data-collapsible-trigger");
      if (!panelId) {
        return;
      }

      const body = document.querySelector(`[data-collapsible-body="${panelId}"]`);
      if (!body) {
        return;
      }

      const willExpand = body.hasAttribute("hidden");
      body.toggleAttribute("hidden", !willExpand);
      trigger.setAttribute("aria-expanded", String(willExpand));
    });
  });
}

function activateExpertView(view) {
  if (getCurrentMode() !== "expert") {
    showNewAskView();
    return;
  }

  document.querySelectorAll("[data-view-link]").forEach(link => {
    link.classList.toggle("active", link.getAttribute("data-view-link") === view);
  });

  if (view === "new-ask") {
    showNewAskView();
    return;
  }

  document.querySelectorAll("[data-new-ask-panel]").forEach(element => {
    element.setAttribute("hidden", "");
  });
  document.querySelectorAll("[data-view-panel]").forEach(element => {
    const isActive = element.getAttribute("data-view-panel") === view;
    element.toggleAttribute("hidden", !isActive);
  });

  if (view === "repos") {
    void loadRepositoriesView();
  }
}

function showNewAskView() {
  document.querySelectorAll("[data-new-ask-panel]").forEach(element => {
    if (element.matches("[data-answer-panel]") && element.querySelector("[data-answer-content]")?.textContent === "") {
      return;
    }
    element.removeAttribute("hidden");
  });
  document.querySelectorAll("[data-view-panel]").forEach(element => {
    element.setAttribute("hidden", "");
  });
}

async function loadRepositoriesView() {
  const container = document.querySelector("[data-repos-view]");
  if (!container) {
    return;
  }

  try {
    const response = await fetch("/repos", {
      headers: {
        Accept: "application/json"
      }
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load repositories.");
    }

    container.innerHTML = renderRepositoryListHtml(Array.isArray(payload.repos) ? payload.repos : [], payload.setupHint ?? null);
  } catch (error) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  }
}

function updateModeSwitch(mode) {
  document.querySelectorAll("[data-mode-target]").forEach(button => {
    button.setAttribute("aria-selected", String(button.getAttribute("data-mode-target") === mode));
  });
}

function getCurrentMode() {
  return document.body.dataset.mode === "expert" ? "expert" : "simple";
}

function readExpertOptions() {
  const form = document.querySelector("[data-ask-form]");
  const audience = document.querySelector('input[name="audience"]:checked')?.getAttribute("value") ?? "general";
  return {
    audience,
    model: getSelectValue("model"),
    noSynthesis: getCheckboxValue("noSynthesis"),
    noSync: getCheckboxValue("noSync"),
    reasoningEffort: getSelectValue("reasoningEffort"),
    selectionMode: getSelectValue("selectionMode"),
    selectionShadowCompare: getCheckboxValue("selectionShadowCompare")
  };
}

function getSelectValue(name) {
  return /** @type {HTMLSelectElement | null} */ (document.querySelector(`select[name="${name}"]`))?.value ?? "";
}

function getCheckboxValue(name) {
  return /** @type {HTMLInputElement | null} */ (document.querySelector(`input[name="${name}"]`))?.checked === true;
}

function applyInitialTheme(elements) {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const theme = storedTheme === "light" || storedTheme === "dark"
    ? storedTheme
    : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  setTheme(theme, elements);
}

function setTheme(theme, elements) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  if (elements.themeIcon) {
    elements.themeIcon.textContent = theme === "dark" ? "☾" : "☀";
  }
}

async function initAuth(elements) {
  if (elements.authSignins.length === 0) {
    return;
  }

  try {
    const response = await fetch("/auth/session", {
      headers: {
        Accept: "application/json"
      }
    });
    const session = await response.json();
    if (!response.ok) {
      throw new Error(session.error || "Failed to load auth session.");
    }

    updateAuthSignin(elements, session);
    elements.onAuthSession?.(session);
  } catch (error) {
    for (const button of elements.authSignins) {
      replaceButtonHandler(button, () => {
        showToast(elements, error instanceof Error ? error.message : String(error));
      });
    }
  }
}

function setAskAuthState(elements, isBlocked) {
  elements.askBlockedByAuth = isBlocked;
  if (!elements.submitButton) {
    return;
  }

  elements.submitButton.disabled = isBlocked;
  elements.submitButton.title = isBlocked ? "Sign in with GitHub before asking a question." : "";
}

function updateAuthSignin(elements, session) {
  if (elements.authSignins.length === 0) {
    return;
  }

  elements.authSignins = Array.from(document.querySelectorAll("[data-auth-signin]"));
  for (const button of elements.authSignins) {
    updateAuthSigninButton(elements, button, session);
  }
}

function updateAuthSigninButton(elements, button, session) {
  if (session.authenticated && session.user) {
    const nextButton = replaceButtonHandler(button, async () => {
      const response = await fetch("/auth/logout", {
        headers: {
          Accept: "application/json"
        },
        method: "POST"
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        showToast(elements, payload.error || "Failed to sign out.");
        return;
      }
      await initAuth(elements);
      showToast(elements, "Signed out.");
    });
    nextButton.textContent = `Sign out ${session.user.email ?? ""}`.trim();
    return;
  }

  const nextButton = replaceButtonHandler(button, () => {
    if (!session.githubConfigured) {
      showToast(elements, "GitHub SSO is not configured on this server.");
      return;
    }
    window.location.href = "/auth/github/start";
  });
  nextButton.textContent = "Sign in with GitHub";
}

function replaceButtonHandler(button, onClick) {
  const nextButton = button.cloneNode(true);
  nextButton.addEventListener("click", onClick);
  button.replaceWith(nextButton);
  return nextButton;
}

async function addAttachedFiles(elements, existingFiles, files) {
  const nextFiles = [...existingFiles];
  for (const file of files) {
    if (nextFiles.length >= MAX_CLIENT_ATTACHMENTS) {
      showToast(elements, `You can attach at most ${MAX_CLIENT_ATTACHMENTS} files.`);
      break;
    }

    if (file.size > MAX_CLIENT_ATTACHMENT_BYTES) {
      showToast(elements, `${file.name} exceeds the 1 MB attachment limit.`);
      continue;
    }

    nextFiles.push(await readAttachment(file));
  }

  return nextFiles;
}

async function readAttachment(file) {
  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    mediaType: file.type || "application/octet-stream",
    contentBase64: arrayBufferToBase64(buffer),
    size: file.size
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function renderAttachedFiles(elements, files, onChange) {
  renderFiles(elements, files, index => {
    const nextFiles = files.filter((_file, fileIndex) => fileIndex !== index);
    renderAttachedFiles(elements, nextFiles, onChange);
    onChange(nextFiles);
  });
}

function renderFiles(elements, files, onRemove) {
  if (!elements.fileList) {
    return;
  }

  elements.fileList.replaceChildren();
  files.forEach((file, index) => {
    const item = document.createElement("li");
    const removeButton = document.createElement("button");
    removeButton.className = "icon-button";
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Remove ${file.name}`);
    removeButton.textContent = "x";
    removeButton.addEventListener("click", () => onRemove(index));
    item.innerHTML = `<span>${escapeHtml(file.name)}</span><span>${formatFileSize(file.size)} attached</span>`;
    item.append(removeButton);
    elements.fileList.append(item);
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setSubmitting(elements, isSubmitting) {
  if (elements.submitButton) {
    elements.submitButton.disabled = isSubmitting || elements.askBlockedByAuth === true;
    elements.submitButton.textContent = isSubmitting ? "Asking..." : "Ask";
  }
}

function renderPipeline(elements, pipeline) {
  for (const id of STAGE_IDS) {
    const stage = pipeline.stages[id];
    const row = document.querySelector(`[data-stage="${id}"]`);
    const detail = document.querySelector(`[data-stage-detail="${id}"]`);
    const time = document.querySelector(`[data-stage-time="${id}"]`);
    row?.setAttribute("data-state", stage.state);
    if (detail) {
      detail.textContent = stage.detail;
    }
    if (time) {
      time.textContent = stage.timestamp ? formatTime(stage.timestamp) : "";
    }
  }

  if (elements.statusLog) {
    elements.statusLog.textContent = pipeline.log.map(entry => `[${formatTime(entry.timestamp)}] ${entry.message}`).join("\n");
  }
  if (elements.progressSummary) {
    elements.progressSummary.textContent = getProgressPanelSummary(pipeline);
  }
}

function subscribeToJob(eventsUrl, handlers) {
  const source = new EventSource(eventsUrl);
  source.addEventListener("status", event => {
    handlers.onStatus(parseEventData(event).message ?? "");
  });
  source.addEventListener("completed", event => {
    source.close();
    handlers.onComplete(parseEventData(event));
  });
  source.addEventListener("failed", event => {
    source.close();
    handlers.onFailed(parseEventData(event));
  });
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      return;
    }
    handlers.onFailed({ error: "Lost connection to job stream." });
    source.close();
  };
  return source;
}

function parseEventData(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return {};
  }
}

function getAnswerText(job) {
  if (job.result?.synthesis?.text) {
    return job.result.synthesis.text;
  }

  const repoNames = (job.result?.selectedRepos ?? []).map(repo => repo.name).filter(Boolean);
  return `Retrieval only. Selected repos: ${repoNames.join(", ") || "none"}`;
}

function setAnswer(elements, text) {
  if (!elements.answerPanel || !elements.answerContent) {
    return;
  }

  if (!text) {
    elements.answerPanel.hidden = true;
    elements.answerContent.textContent = "";
    return;
  }

  elements.answerPanel.hidden = false;
  elements.answerContent.innerHTML = renderMarkdownHtml(text);
}

function renderSelectedRepos(elements, repos) {
  if (!elements.selectedRepos || !elements.runEmpty || !elements.runSummary) {
    return;
  }

  elements.selectedRepos.replaceChildren();
  if (!repos.length) {
    elements.runEmpty.hidden = false;
    elements.selectedRepos.hidden = true;
    elements.runSummary.textContent = "No repositories were selected.";
    return;
  }

  for (const repo of repos) {
    const item = document.createElement("li");
    item.textContent = repo.path ? `${repo.name} · ${repo.path}` : repo.name;
    elements.selectedRepos.append(item);
  }
  elements.runEmpty.hidden = true;
  elements.selectedRepos.hidden = false;
  elements.runSummary.textContent = `${repos.length} repositor${repos.length === 1 ? "y" : "ies"} used.`;
}

function showToast(elements, message) {
  if (!elements.toastRegion) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  elements.toastRegion.append(toast);
  setTimeout(() => toast.remove(), 4000);
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
