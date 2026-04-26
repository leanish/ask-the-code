import { describe, expect, it } from "vitest";

import {
  createAskPayload,
  DEFAULT_EXPERT_VIEW,
  escapeHtml,
  EXPERT_VIEW_IDS,
  getProgressPanelSummary,
  getExpertViewFromHash,
  renderMarkdownHtml,
  renderRepositoryListHtml
} from "../src/server/ui/assets/client-helpers.js";
import { createInitialPipeline, reducePipelineEvent } from "../src/server/ui/assets/stage-mapping.js";

describe("client helpers", () => {
  it("returns the default expert view for empty and unknown hashes", () => {
    expect(getExpertViewFromHash("")).toBe(DEFAULT_EXPERT_VIEW);
    expect(getExpertViewFromHash("#")).toBe(DEFAULT_EXPERT_VIEW);
    expect(getExpertViewFromHash("#unknown")).toBe(DEFAULT_EXPERT_VIEW);
  });

  it("accepts every known expert view id", () => {
    for (const id of EXPERT_VIEW_IDS) {
      expect(getExpertViewFromHash(`#${id}`)).toBe(id);
      expect(getExpertViewFromHash(id)).toBe(id);
    }
  });

  it("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<script>alert("x'y")</script>&`)).toBe(
      "&lt;script&gt;alert(&quot;x&#39;y&quot;)&lt;/script&gt;&amp;"
    );
  });

  it("falls back to escaped markdown text when no runtime is available", () => {
    expect(renderMarkdownHtml("<b>x</b>", null)).toBe("&lt;b&gt;x&lt;/b&gt;");
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

  it("omits expert options from simple-mode ask payloads", () => {
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

  it("serializes non-default expert options into ask payloads", () => {
    expect(createAskPayload("What changed?", "expert", {
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

  it("omits expert options that match defaults", () => {
    expect(createAskPayload("What changed?", "expert", {
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

  it("renders repository list HTML for the expert repos view", () => {
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
