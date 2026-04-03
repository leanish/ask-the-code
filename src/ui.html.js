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
textarea, input[type="text"] {
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
textarea:focus, input[type="text"]:focus {
  border-color: #58a6ff;
}
textarea {
  resize: vertical;
  min-height: 5rem;
}
.field { margin-bottom: 0.75rem; }
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
.options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
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
#status-log:empty + #answer { border-top: none; }
#answer {
  display: none;
  padding: 1rem;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 0.85rem;
  color: #e6edf3;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
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

  <form id="ask-form">
    <div class="field">
      <label for="question">Question</label>
      <textarea id="question" name="question" rows="4" placeholder="Ask your codebase a question..." required></textarea>
    </div>
    <div class="field">
      <label for="repo-names">Repos <span style="color:#484f58">(optional, comma-separated)</span></label>
      <input type="text" id="repo-names" name="repoNames" placeholder="e.g. archa, playcart">
    </div>
    <details>
      <summary>Advanced options</summary>
      <div class="options-grid">
        <div class="field">
          <label for="model">Model</label>
          <input type="text" id="model" name="model" placeholder="default">
        </div>
        <div class="field">
          <label for="reasoning-effort">Reasoning effort</label>
          <input type="text" id="reasoning-effort" name="reasoningEffort" placeholder="default">
        </div>
        <label class="checkbox-field">
          <input type="checkbox" id="no-sync" name="noSync"> Skip repo sync
        </label>
        <label class="checkbox-field">
          <input type="checkbox" id="no-synthesis" name="noSynthesis"> Retrieval only
        </label>
      </div>
    </details>
    <button type="submit" id="submit-btn">Ask</button>
  </form>

  <div id="result">
    <div id="status-log"></div>
    <div id="answer"></div>
    <div id="error-box"></div>
  </div>
</main>

<script>
(function () {
  const form = document.getElementById("ask-form");
  const submitBtn = document.getElementById("submit-btn");
  const resultBox = document.getElementById("result");
  const statusLog = document.getElementById("status-log");
  const answerBox = document.getElementById("answer");
  const errorBox = document.getElementById("error-box");

  let eventSource = null;

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

    const repoNamesRaw = document.getElementById("repo-names").value.trim();
    const model = document.getElementById("model").value.trim() || null;
    const reasoningEffort = document.getElementById("reasoning-effort").value.trim() || null;
    const noSync = document.getElementById("no-sync").checked;
    const noSynthesis = document.getElementById("no-synthesis").checked;

    const payload = { question };
    if (repoNamesRaw) payload.repoNames = repoNamesRaw;
    if (model) payload.model = model;
    if (reasoningEffort) payload.reasoningEffort = reasoningEffort;
    if (noSync) payload.noSync = true;
    if (noSynthesis) payload.noSynthesis = true;
    return payload;
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
      answerBox.textContent = job.result.synthesis.text;
      answerBox.classList.add("visible");
    } else if (job.result && job.result.mode === "retrieval-only") {
      const repos = (job.result.selectedRepos || []).map(r => r.name).join(", ");
      answerBox.textContent = "Retrieval only. Selected repos: " + (repos || "none");
      answerBox.classList.add("visible");
    }
    finish();
  }

  function appendStatus(msg) {
    statusLog.textContent += (statusLog.textContent ? "\\n" : "") + msg;
    statusLog.scrollTop = statusLog.scrollHeight;
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add("visible");
    finish();
  }

  function resetResult() {
    statusLog.textContent = "";
    answerBox.textContent = "";
    answerBox.classList.remove("visible");
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
