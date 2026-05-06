import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";

import {
  createAskFormData,
  createAskPayload,
  DEFAULT_ADVANCED_VIEW,
  escapeHtml,
  ADVANCED_VIEW_IDS,
  formatModeCookie,
  getProgressPanelSummary,
  getAdvancedViewFromHash,
  renderMarkdownHtml,
  renderRepositoryListHtml,
  summarizeRun
} from "../src/server/ui/assets/client-helpers.js";
import { createInitialPipeline, reducePipelineEvent } from "../src/server/ui/assets/stage-mapping.js";

describe("client helpers", () => {
  it("loads the browser app module without parse errors", async () => {
    const appUrl = pathToFileURL("src/server/ui/assets/app.js");

    await expect(import(`${appUrl.href}?load-test=${Date.now()}`)).resolves.toBeDefined();
  });

  it("binds every theme toggle so the visible Simple-mode header button works", async () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const originalDocument = globals.document;
    const originalLocalStorage = globals.localStorage;
    const originalWindow = globals.window;
    const advancedToggle = createFakeElement();
    const simpleToggle = createFakeElement();
    const advancedIcon = createFakeElement();
    const simpleIcon = createFakeElement();
    const documentElement = { dataset: { theme: "dark" } };
    const body = { dataset: { mode: "simple" } };
    const storage = new Map<string, string>();
    const fakeDocument = {
      body,
      documentElement,
      createElement: () => createFakeElement(),
      querySelector: () => null,
      querySelectorAll(selector: string) {
        if (selector === "[data-theme-toggle]") {
          return [advancedToggle, simpleToggle];
        }
        if (selector === "[data-theme-icon]") {
          return [advancedIcon, simpleIcon];
        }
        return [];
      }
    };

    try {
      Object.assign(globals, {
        document: fakeDocument,
        localStorage: {
          getItem(key: string) {
            return storage.get(key) ?? null;
          },
          setItem(key: string, value: string) {
            storage.set(key, value);
          }
        },
        window: {
          addEventListener() {},
          location: { hash: "", href: "http://atc.local/?mode=simple" },
          matchMedia: () => ({ matches: true })
        }
      });

      const appUrl = pathToFileURL("src/server/ui/assets/app.js");
      await import(`${appUrl.href}?theme-test=${Date.now()}`);
      simpleToggle.click();

      expect(documentElement.dataset.theme).toBe("light");
      expect(storage.get("atc:theme")).toBe("light");
      expect(advancedIcon.textContent).toBe("☀");
      expect(simpleIcon.textContent).toBe("☀");
    } finally {
      Object.assign(globals, {
        document: originalDocument,
        localStorage: originalLocalStorage,
        window: originalWindow
      });
    }
  });

  it("returns the default advanced view for empty and unknown hashes", () => {
    expect(getAdvancedViewFromHash("")).toBe(DEFAULT_ADVANCED_VIEW);
    expect(getAdvancedViewFromHash("#")).toBe(DEFAULT_ADVANCED_VIEW);
    expect(getAdvancedViewFromHash("#unknown")).toBe(DEFAULT_ADVANCED_VIEW);
  });

  it("accepts every known advanced view id", () => {
    for (const id of ADVANCED_VIEW_IDS) {
      expect(getAdvancedViewFromHash(`#${id}`)).toBe(id);
      expect(getAdvancedViewFromHash(id)).toBe(id);
    }
  });

  it("formats the sticky mode cookie", () => {
    expect(formatModeCookie("advanced")).toBe("atc_mode=advanced; Path=/; Max-Age=31536000; SameSite=Lax");
  });

  it("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<script>alert("x'y")</script>&`)).toBe(
      "&lt;script&gt;alert(&quot;x&#39;y&quot;)&lt;/script&gt;&amp;"
    );
  });

  it("falls back to escaped markdown text when no runtime is available", () => {
    expect(renderMarkdownHtml("<b>x</b>", null)).toBe("&lt;b&gt;x&lt;/b&gt;");
  });

  it("detects the markdown runtime from browser globals", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const originalWindow = globals.window;

    try {
      globals.window = {
        DOMPurify: {
          sanitize(value: string) {
            return value.replace("<script>bad()</script>", "");
          }
        },
        marked: {
          parse(value: string) {
            return `<strong>${value}</strong><script>bad()</script>`;
          }
        }
      };

      expect(renderMarkdownHtml("**safe**")).toBe("<strong>**safe**</strong>");
    } finally {
      globals.window = originalWindow;
    }
  });

  it("falls back to escaping when browser markdown globals are incomplete", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const originalWindow = globals.window;

    try {
      globals.window = {
        marked: {
          parse(value: string) {
            return value;
          }
        }
      };

      expect(renderMarkdownHtml("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;");
    } finally {
      globals.window = originalWindow;
    }
  });

  it("renders markdown through marked and DOMPurify when available", () => {
    const calls: string[] = [];
    const html = renderMarkdownHtml("**safe**", {
      DOMPurify: {
        sanitize(value: string, options?: unknown) {
          calls.push(`sanitize:${JSON.stringify(options)}`);
          return value.replace("<script>bad()</script>", "");
        }
      },
      marked: {
        parse(value: string) {
          calls.push(`parse:${value}`);
          return `<strong>${value}</strong><script>bad()</script>`;
        }
      }
    });

    expect(html).toBe("<strong>**safe**</strong>");
    expect(calls).toEqual([
      "parse:**safe**",
      "sanitize:{\"USE_PROFILES\":{\"html\":true}}"
    ]);
  });

  it("omits advanced options from simple-mode ask payloads", () => {
    expect(createAskPayload("What changed?", "simple", {
      audience: "codebase",
      model: "gpt-5.4",
      noSync: true
    })).toEqual({
      question: "What changed?"
    });
  });

  it("includes attachments in ask payloads", () => {
    const attachments = [
      {
        name: "notes.txt",
        mediaType: "text/plain",
        contentBase64: "aGVsbG8="
      }
    ];

    expect(createAskPayload("What changed?", "simple", {}, attachments)).toEqual({
      question: "What changed?",
      attachments
    });
  });

  it("builds multipart ask data with payload JSON and file fields", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const formData = createAskFormData({ question: "What changed?" }, [file]);
    const fileField = formData.get("file_0");

    expect(formData.get("payload")).toBe(JSON.stringify({ question: "What changed?" }));
    expect(fileField).toBeInstanceOf(File);
    expect((fileField as File).name).toBe("notes.txt");
    expect(await (fileField as File).text()).toBe("hello");
  });

  it("serializes non-default advanced options into ask payloads", () => {
    expect(createAskPayload("What changed?", "advanced", {
      audience: "codebase",
      model: "gpt-5.4",
      noSynthesis: true,
      noSync: true,
      reasoningEffort: "high",
      selectionMode: "all",
      selectionShadowCompare: true
    })).toEqual({
      audience: "codebase",
      model: "gpt-5.4",
      noSynthesis: true,
      noSync: true,
      question: "What changed?",
      reasoningEffort: "high",
      selectionMode: "all",
      selectionShadowCompare: true
    });
  });

  it("omits advanced options that match defaults", () => {
    expect(createAskPayload("What changed?", "advanced", {
      audience: "general",
      model: "gpt-5.4-mini",
      noSynthesis: false,
      noSync: false,
      reasoningEffort: "low",
      selectionMode: "single",
      selectionShadowCompare: false
    })).toEqual({
      question: "What changed?"
    });
  });

  it("summarizes the latest progress state for collapsed progress panels", () => {
    let pipeline = createInitialPipeline();

    expect(getProgressPanelSummary(pipeline)).toBe("Waiting for a question.");

    pipeline = reducePipelineEvent(pipeline, {
      type: "status",
      message: "Running Codex... 1m elapsed",
      timestamp: "2026-04-26T12:00:00.000Z"
    });
    expect(getProgressPanelSummary(pipeline)).toBe("Running Codex... 1m elapsed");

    pipeline = reducePipelineEvent(pipeline, {
      type: "completed",
      timestamp: "2026-04-26T12:01:00.000Z"
    });
    expect(getProgressPanelSummary(pipeline)).toBe("Answer ready.");
  });

  it("summarizes failed and touched progress stages", () => {
    const failedPipeline = reducePipelineEvent(createInitialPipeline(), {
      message: "Repository sync failed",
      timestamp: "2026-04-26T12:00:00.000Z",
      type: "failed"
    });
    const touchedPipeline = reducePipelineEvent(createInitialPipeline(), {
      jobId: "job-123",
      timestamp: "2026-04-26T12:00:00.000Z",
      type: "job-created"
    });

    expect(getProgressPanelSummary(failedPipeline)).toBe("Repository sync failed");
    expect(getProgressPanelSummary(touchedPipeline)).toBe("Job ID: job-123");
  });

  it("renders repository list HTML for the advanced repos view", () => {
    const html = renderRepositoryListHtml([
      {
        aliases: ["atc"],
        defaultBranch: "main",
        description: "Repo-aware Q&A",
        name: "ask-the-code"
      }
    ]);

    expect(html).toContain("ask-the-code");
    expect(html).toContain("Repo-aware Q&amp;A");
    expect(renderRepositoryListHtml([], "No repos configured.")).toContain("No repos configured.");
  });

  it("summarizes completed runs with repo count, duration, completed steps, and success badge", () => {
    let pipeline = createInitialPipeline();
    pipeline = reducePipelineEvent(pipeline, {
      jobId: "job-123",
      timestamp: "2026-04-26T12:00:00.000Z",
      type: "job-created"
    });
    pipeline = reducePipelineEvent(pipeline, {
      message: "Running Codex...",
      timestamp: "2026-04-26T12:00:05.000Z",
      type: "status"
    });
    pipeline = reducePipelineEvent(pipeline, {
      timestamp: "2026-04-26T12:01:05.000Z",
      type: "completed"
    });

    expect(summarizeRun({
      pipeline,
      repos: [{ name: "api" }, { name: "web" }],
      status: "completed"
    })).toEqual({
      badge: "Completed successfully",
      summary: "2 repositories used. Total duration: 1m 5s. Steps completed: 5/5."
    });
  });

  it("escapes repository list fields", () => {
    const html = renderRepositoryListHtml([
      {
        aliases: ["<alias>"],
        defaultBranch: "<main>",
        description: "<script>alert(1)</script>",
        name: "<repo>"
      }
    ]);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;repo&gt;");
    expect(html).toContain("&lt;alias&gt;");
  });
});

function createFakeElement() {
  const listeners = new Map<string, Array<() => void>>();
  return {
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    dataset: {},
    hidden: false,
    textContent: "",
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    append() {},
    click() {
      for (const listener of listeners.get("click") ?? []) {
        listener();
      }
    },
    cloneNode() {
      return createFakeElement();
    },
    getAttribute() {
      return null;
    },
    hasAttribute() {
      return false;
    },
    matches() {
      return false;
    },
    querySelector() {
      return null;
    },
    removeAttribute() {},
    replaceChildren() {},
    replaceWith() {},
    setAttribute() {},
    toggleAttribute() {}
  };
}
