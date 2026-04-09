export const HTML_UI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>archa</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: #0f1117;
  color: #c9d1d9;
  line-height: 1.5;
  min-height: 100vh;
}
main {
  max-width: 720px;
  margin: 0 auto;
  padding: 2rem 1rem;
}
h1 {
  font-size: 1.4rem;
  font-weight: 600;
  color: #e6edf3;
  margin-bottom: 0.25rem;
}
.subtitle {
  font-size: 0.85rem;
  color: #7d8590;
  margin-bottom: 1.5rem;
}
form { margin-bottom: 1.5rem; }
label {
  display: block;
  font-size: 0.8rem;
  color: #7d8590;
  margin-bottom: 0.25rem;
}
textarea, input[type="text"], select {
  width: 100%;
  background: #161b22;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-family: inherit;
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.15s;
}
textarea:focus, input[type="text"]:focus, select:focus {
  border-color: #58a6ff;
}
textarea {
  resize: vertical;
  min-height: 5rem;
}
.field { margin-bottom: 0.75rem; }
.field-hint {
  margin-top: 0.35rem;
  font-size: 0.78rem;
  color: #7d8590;
}
.repo-picker {
  display: grid;
  gap: 0.5rem;
}
.repo-selected {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.repo-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.55rem;
  border: 1px solid #30363d;
  border-radius: 999px;
  background: #161b22;
  color: #c9d1d9;
  font-size: 0.75rem;
}
.repo-chip-muted {
  color: #7d8590;
}
.repo-chip-remove {
  border: 0;
  background: transparent;
  color: #7d8590;
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
.repo-options {
  display: grid;
  gap: 0.35rem;
  max-height: 14rem;
  overflow-y: auto;
  padding: 0.5rem;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: #0f1117;
}
.repo-options[hidden] {
  display: none;
}
.repo-option {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem;
  align-items: start;
  padding: 0.5rem;
  border: 1px solid transparent;
  border-radius: 6px;
  background: #161b22;
  cursor: pointer;
}
.repo-option:hover {
  border-color: #30363d;
}
.repo-option input {
  margin-top: 0.15rem;
  accent-color: #58a6ff;
}
.repo-option-text {
  display: grid;
  gap: 0.15rem;
}
.repo-option-name {
  color: #e6edf3;
  font-size: 0.88rem;
}
.repo-option-meta,
.repo-option-description,
.repo-options-empty {
  color: #7d8590;
  font-size: 0.75rem;
}
details {
  margin-bottom: 0.75rem;
}
details summary {
  font-size: 0.8rem;
  color: #7d8590;
  cursor: pointer;
  user-select: none;
}
details summary:hover { color: #c9d1d9; }
.advanced-options-list {
  display: grid;
  gap: 0.75rem;
  margin-top: 0.5rem;
}
.checkbox-field {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: #7d8590;
}
.checkbox-field input { accent-color: #58a6ff; }
button[type="submit"] {
  background: #238636;
  color: #fff;
  border: 1px solid rgba(240,246,252,0.1);
  border-radius: 6px;
  padding: 0.5rem 1.25rem;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
button[type="submit"]:hover { background: #2ea043; }
button[type="submit"]:disabled {
  background: #21262d;
  color: #484f58;
  cursor: not-allowed;
}
#result {
  display: none;
  border: 1px solid #30363d;
  border-radius: 6px;
  overflow: hidden;
}
#result.visible { display: block; }
#status-log {
  padding: 0.75rem;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 0.8rem;
  color: #7d8590;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 12rem;
  overflow-y: auto;
  border-bottom: 1px solid #30363d;
}
#status-log:empty { display: none; }
.answer-pane {
  display: none;
  border-top: 1px solid #30363d;
}
.answer-pane.visible {
  display: block;
}
#status-log:empty + .answer-pane {
  border-top: none;
}
.answer-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 0.5rem 0.75rem 0;
}
.answer-copy {
  border: 0;
  background: transparent;
  color: #58a6ff;
  font-size: 0.8rem;
  cursor: pointer;
}
.answer-copy:hover {
  color: #79c0ff;
}
.answer-copy:disabled {
  color: #484f58;
  cursor: not-allowed;
}
.setup-hint {
  display: none;
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid #30363d;
  border-radius: 12px;
  background: #161b22;
  color: #c9d1d9;
  font-size: 0.95rem;
  line-height: 1.5;
  white-space: pre-wrap;
}
.setup-hint.visible {
  display: block;
}
#answer {
  display: none;
  width: 100%;
  min-height: 10rem;
  padding: 0.75rem 1rem 1rem;
  background: #0f1117;
  border: 0;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 0.85rem;
  color: #e6edf3;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}
#answer.visible { display: block; }
#error-box {
  display: none;
  padding: 0.75rem 1rem;
  color: #f85149;
  font-size: 0.85rem;
}
#error-box.visible { display: block; }
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  white-space: nowrap;
  border: 0;
}
</style>
</head>
<body>
<main>
  <h1>archa</h1>
  <p class="subtitle">Ask your codebase how it behaves.</p>
  <div id="setup-hint" class="setup-hint"></div>

  <form id="ask-form">
    <div class="field">
      <label for="question">Question</label>
      <textarea id="question" name="question" rows="4" placeholder="Ask your codebase a question..." required></textarea>
    </div>
    <details id="advanced-options" hidden>
      <summary>Advanced options</summary>
      <div class="advanced-options-list">
        <div class="field">
          <label for="repo-filter">Repos <span style="color:#484f58">(optional)</span></label>
          <div id="repo-picker" class="repo-picker">
            <div id="repo-selected" class="repo-selected" aria-live="polite"></div>
            <input type="text" id="repo-filter" placeholder="Loading configured repos..." disabled>
            <div id="repo-options" class="repo-options" role="listbox" aria-multiselectable="true" hidden></div>
          </div>
          <div id="repo-help" class="field-hint">
            Leave it empty to use automatic repo selection, or search to narrow the scope explicitly.
          </div>
        </div>
        <div class="field">
          <label for="audience">Audience</label>
          <select id="audience" name="audience">
            <option value="general" selected>general</option>
            <option value="codebase">codebase</option>
          </select>
          <div class="field-hint">General keeps the answer self-contained. Codebase mode can reference implementation details directly.</div>
        </div>
        <div class="field">
          <label for="model">Model</label>
          <select id="model" name="model">
            <option value="gpt-5.4">gpt-5.4</option>
            <option value="gpt-5.4-mini" selected>gpt-5.4-mini</option>
          </select>
        </div>
        <div class="field">
          <label for="reasoning-effort">Reasoning effort</label>
          <select id="reasoning-effort" name="reasoningEffort">
            <option value="none">none</option>
            <option value="minimal">minimal</option>
            <option value="low" selected>low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="xhigh">xhigh</option>
          </select>
        </div>
        <label class="checkbox-field">
          <input type="checkbox" id="no-sync" name="noSync"> Skip repo sync
        </label>
      </div>
    </details>
    <button type="submit" id="submit-btn">Ask</button>
  </form>

  <div id="result">
    <div id="status-log"></div>
    <div id="answer-pane" class="answer-pane">
      <div class="answer-toolbar">
        <button type="button" id="copy-answer" class="answer-copy" disabled>Copy</button>
      </div>
      <textarea id="answer" readonly spellcheck="false"></textarea>
    </div>
    <div id="error-box"></div>
  </div>
</main>

<script>
(function () {
  const form = document.getElementById("ask-form");
  const submitBtn = document.getElementById("submit-btn");
  const resultBox = document.getElementById("result");
  const statusLog = document.getElementById("status-log");
  const answerPane = document.getElementById("answer-pane");
  const answerBox = document.getElementById("answer");
  const copyAnswerButton = document.getElementById("copy-answer");
  const errorBox = document.getElementById("error-box");
  const advancedOptions = document.getElementById("advanced-options");
  const setupHint = document.getElementById("setup-hint");
  const repoSelected = document.getElementById("repo-selected");
  const repoOptions = document.getElementById("repo-options");
  const repoFilter = document.getElementById("repo-filter");
  const repoHelp = document.getElementById("repo-help");

  const repoState = {
    available: [],
    selected: new Set(),
    ready: false,
    isSearchActive: false
  };

  let eventSource = null;
  let copyFeedbackTimer = null;

  function isCodexStatus(message) {
    return typeof message === "string" && message.startsWith("Running Codex");
  }

  revealAdvancedOptionsWhenAllowed();
  renderRepoPicker();
  void initializeRepoPicker();

  repoFilter.addEventListener("input", () => {
    renderRepoOptions();
  });

  repoFilter.addEventListener("focus", () => {
    repoState.isSearchActive = true;
    renderRepoOptions();
  });

  repoFilter.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement === repoFilter) {
        return;
      }

      repoState.isSearchActive = false;
      renderRepoOptions();
    }, 0);
  });

  repoOptions.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest(".repo-option")) {
      return;
    }

    event.preventDefault();
  });

  repoOptions.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
      return;
    }

    const repoName = target.getAttribute("data-repo-name");
    if (!repoName) {
      return;
    }

    if (target.checked) {
      repoState.selected.add(repoName);
    } else {
      repoState.selected.delete(repoName);
    }

    repoFilter.focus({ preventScroll: true });
    renderRepoPicker();
  });

  repoSelected.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest("button[data-repo-name]");
    if (!button) {
      return;
    }

    const repoName = button.getAttribute("data-repo-name");
    if (!repoName) {
      return;
    }

    repoState.selected.delete(repoName);
    renderRepoPicker();
  });

  copyAnswerButton.addEventListener("click", async () => {
    if (!answerBox.value) {
      return;
    }

    try {
      await copyText(answerBox.value);
      setCopyButtonLabel("Copied");
    } catch (error) {
      setCopyButtonLabel("Copy failed");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    resetResult();

    const payload = buildPayload();
    if (!payload) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Asking...";
    resultBox.classList.add("visible");
    appendStatus("Submitting job...");

    try {
      const res = await fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const job = await res.json();
      if (!res.ok) {
        showError(job.error || "Failed to create job.");
        return;
      }
      appendStatus("Job queued.");
      connectSSE(job.links.events);
    } catch (err) {
      showError(err.message || "Network error.");
    }
  });

  function buildPayload() {
    const question = document.getElementById("question").value.trim();
    if (!question) return null;

    const noSync = document.getElementById("no-sync").checked;

    const payload = { question };
    const selectedRepoNames = Array.from(repoState.selected);
    if (selectedRepoNames.length > 0) payload.repoNames = selectedRepoNames;
    if (!advancedOptions.hidden) {
      const audience = document.getElementById("audience").value.trim() || null;
      const model = document.getElementById("model").value.trim() || null;
      const reasoningEffort = document.getElementById("reasoning-effort").value.trim() || null;
      if (audience) payload.audience = audience;
      if (model) payload.model = model;
      if (reasoningEffort) payload.reasoningEffort = reasoningEffort;
      if (noSync) payload.noSync = true;
    }
    return payload;
  }

  function revealAdvancedOptionsWhenAllowed() {
    const params = new URLSearchParams(window.location.search);
    if ((params.get("admin") || "").toLowerCase() === "true") {
      advancedOptions.hidden = false;
    }
  }

  async function initializeRepoPicker() {
    try {
      const response = await fetch("/repos", {
        headers: { Accept: "application/json" }
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load configured repos.");
      }

      const repos = Array.isArray(payload.repos)
        ? payload.repos.filter(repo => repo && typeof repo.name === "string")
        : [];
      if (repos.length === 0) {
        const setupHint = typeof payload.setupHint === "string" && payload.setupHint.trim()
          ? payload.setupHint.trim()
          : 'No configured repos available. Try "archa config discover-github" to discover and add repos.';
        repoFilter.disabled = true;
        repoFilter.placeholder = "No configured repos available";
        repoHelp.textContent = setupHint;
        setSetupHint(setupHint);
        renderRepoPicker();
        return;
      }

      repoState.available = repos.sort((left, right) => left.name.localeCompare(right.name));
      repoState.ready = true;
      repoFilter.disabled = false;
      repoFilter.placeholder = "Search configured repos";
      repoHelp.textContent = "Leave it empty to use automatic repo selection, or search to narrow to specific repos.";
      setSetupHint("");
      renderRepoPicker();
    } catch (error) {
      repoFilter.disabled = true;
      repoFilter.placeholder = "Configured repos unavailable";
      repoHelp.textContent = "Configured repo list unavailable. The server will still use automatic repo selection.";
      setSetupHint("");
      renderRepoPicker();
    }
  }

  function setSetupHint(message) {
    setupHint.textContent = message;
    setupHint.classList.toggle("visible", Boolean(message));
  }

  function renderRepoPicker() {
    renderSelectedRepos();
    renderRepoOptions();
  }

  function renderSelectedRepos() {
    repoSelected.textContent = "";

    const selectedNames = Array.from(repoState.selected);
    if (selectedNames.length === 0) {
      const chip = document.createElement("span");
      chip.className = "repo-chip repo-chip-muted";
      chip.textContent = "automatic";
      repoSelected.append(chip);
      return;
    }

    for (const repoName of selectedNames) {
      const chip = document.createElement("span");
      chip.className = "repo-chip";
      chip.append(document.createTextNode(repoName));

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "repo-chip-remove";
      removeButton.setAttribute("data-repo-name", repoName);
      removeButton.setAttribute("aria-label", "Remove " + repoName);
      removeButton.textContent = "x";
      chip.append(removeButton);

      repoSelected.append(chip);
    }
  }

  function renderRepoOptions() {
    repoOptions.textContent = "";

    if (!repoState.ready) {
      repoOptions.hidden = true;
      return;
    }

    if (!repoState.isSearchActive) {
      repoOptions.hidden = true;
      return;
    }

    const filter = repoFilter.value.trim().toLowerCase();
    const matchingRepos = filter
      ? repoState.available.filter(repo => matchesRepoFilter(repo, filter))
      : repoState.available;
    repoOptions.hidden = false;
    if (matchingRepos.length === 0) {
      const empty = document.createElement("div");
      empty.className = "repo-options-empty";
      empty.textContent = "No configured repos match this filter.";
      repoOptions.append(empty);
      return;
    }

    for (const repo of matchingRepos) {
      const option = document.createElement("label");
      option.className = "repo-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = repoState.selected.has(repo.name);
      checkbox.setAttribute("data-repo-name", repo.name);
      option.append(checkbox);

      const text = document.createElement("span");
      text.className = "repo-option-text";

      const name = document.createElement("span");
      name.className = "repo-option-name";
      name.textContent = repo.name;
      text.append(name);

      const meta = document.createElement("span");
      meta.className = "repo-option-meta";
      meta.textContent = formatRepoMeta(repo);
      text.append(meta);

      if (repo.description) {
        const description = document.createElement("span");
        description.className = "repo-option-description";
        description.textContent = repo.description;
        text.append(description);
      }

      option.append(text);
      repoOptions.append(option);
    }
  }

  function matchesRepoFilter(repo, filter) {
    if (!filter) {
      return true;
    }

    const aliases = Array.isArray(repo.aliases) ? repo.aliases : [];
    return [repo.name, repo.description || "", repo.defaultBranch || ""]
      .concat(aliases)
      .some(value => String(value).toLowerCase().includes(filter));
  }

  function formatRepoMeta(repo) {
    const parts = [];
    if (repo.defaultBranch) {
      parts.push(repo.defaultBranch);
    }

    if (Array.isArray(repo.aliases) && repo.aliases.length > 0) {
      parts.push("aliases: " + repo.aliases.join(", "));
    }

    return parts.join(" · ");
  }

  function connectSSE(eventsUrl) {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(eventsUrl);

    eventSource.addEventListener("snapshot", (e) => {
      const job = JSON.parse(e.data);
      if (job.status === "completed") {
        renderCompleted(job);
        closeSSE();
      } else if (job.status === "failed") {
        showError(job.error || "Job failed.");
        closeSSE();
      }
    });

    eventSource.addEventListener("started", () => {
      appendStatus("Job started.");
    });

    eventSource.addEventListener("status", (e) => {
      const event = JSON.parse(e.data);
      appendStatus(event.message);
    });

    eventSource.addEventListener("completed", (e) => {
      const event = JSON.parse(e.data);
      appendStatus(event.message);
    });

    eventSource.addEventListener("failed", (e) => {
      const event = JSON.parse(e.data);
      showError(event.message || "Job failed.");
      closeSSE();
    });

    eventSource.onerror = () => {
      if (eventSource && eventSource.readyState === EventSource.CLOSED) {
        closeSSE();
      }
    };
  }

  function renderCompleted(job) {
    if (job.result && job.result.synthesis && job.result.synthesis.text) {
      setAnswerText(job.result.synthesis.text);
    } else if (job.result && job.result.mode === "retrieval-only") {
      const repos = (job.result.selectedRepos || []).map(r => r.name).join(", ");
      setAnswerText("Retrieval only. Selected repos: " + (repos || "none"));
    }
    finish();
  }

  function setAnswerText(text) {
    answerBox.value = text;
    answerPane.classList.add("visible");
    answerBox.classList.add("visible");
    answerBox.style.height = "auto";
    answerBox.style.height = answerBox.scrollHeight + "px";
    copyAnswerButton.disabled = false;
    setCopyButtonLabel("Copy", false);
  }

  async function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }

    answerBox.focus();
    answerBox.select();
    answerBox.setSelectionRange(0, answerBox.value.length);

    if (!document.execCommand("copy")) {
      throw new Error("Copy command failed.");
    }
  }

  function setCopyButtonLabel(label, reset = true) {
    clearTimeout(copyFeedbackTimer);
    copyAnswerButton.textContent = label;

    if (!reset || label === "Copy") {
      return;
    }

    copyFeedbackTimer = setTimeout(() => {
      copyAnswerButton.textContent = "Copy";
    }, 1_500);
  }

  function appendStatus(msg) {
    const lines = statusLog.textContent ? statusLog.textContent.split("\\n") : [];
    const previousMessage = lines.at(-1);

    if (isCodexStatus(msg) && isCodexStatus(previousMessage)) {
      lines[lines.length - 1] = msg;
    } else {
      lines.push(msg);
    }

    statusLog.textContent = lines.join("\\n");
    statusLog.scrollTop = statusLog.scrollHeight;
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add("visible");
    finish();
  }

  function resetResult() {
    clearTimeout(copyFeedbackTimer);
    statusLog.textContent = "";
    answerBox.value = "";
    answerBox.style.height = "";
    answerPane.classList.remove("visible");
    answerBox.classList.remove("visible");
    copyAnswerButton.disabled = true;
    copyAnswerButton.textContent = "Copy";
    errorBox.textContent = "";
    errorBox.classList.remove("visible");
    resultBox.classList.remove("visible");
  }

  function closeSSE() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  function finish() {
    closeSSE();
    submitBtn.disabled = false;
    submitBtn.textContent = "Ask";
  }
})();
</script>
</body>
</html>`;
