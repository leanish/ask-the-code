import { describe, expect, it } from "vitest";

import {
  createAskPayload,
  DEFAULT_EXPERT_VIEW,
  EXPERT_VIEW_IDS,
  escapeHtml,
  getExpertViewFromHash,
  renderMarkdownHtml,
  renderRepositoryListHtml
} from "../src/server/ui/assets/client-helpers.js";

describe("getExpertViewFromHash", () => {
  it("returns the default view for empty input", () => {
    expect(getExpertViewFromHash("")).toBe(DEFAULT_EXPERT_VIEW);
    expect(getExpertViewFromHash("#")).toBe(DEFAULT_EXPERT_VIEW);
  });

  it("returns the default view for unknown ids", () => {
    expect(getExpertViewFromHash("#nope")).toBe(DEFAULT_EXPERT_VIEW);
  });

  it("accepts every known view id", () => {
    for (const id of EXPERT_VIEW_IDS) {
      expect(getExpertViewFromHash(`#${id}`)).toBe(id);
    }
  });

  it("strips the leading #", () => {
    expect(getExpertViewFromHash("#repos")).toBe("repos");
    expect(getExpertViewFromHash("repos")).toBe("repos");
  });
});

describe("createAskPayload", () => {
  it("returns only the question in Simple mode", () => {
    expect(createAskPayload("hello", "simple")).toEqual({ question: "hello" });
  });

  it("ignores Expert options in Simple mode", () => {
    expect(
      createAskPayload("hello", "simple", { audience: "codebase", noSync: true })
    ).toEqual({ question: "hello" });
  });

  it("omits Expert options that match defaults", () => {
    expect(
      createAskPayload("hello", "expert", {
        audience: "general",
        model: "",
        reasoningEffort: "",
        selectionMode: "single",
        noSync: false,
        noSynthesis: false,
        selectionShadowCompare: false
      })
    ).toEqual({ question: "hello" });
  });

  it("includes Expert options when they differ from defaults", () => {
    expect(
      createAskPayload("hello", "expert", {
        audience: "codebase",
        model: "gpt-5.4",
        reasoningEffort: "high",
        selectionMode: "cascade",
        noSync: true,
        noSynthesis: true,
        selectionShadowCompare: true
      })
    ).toEqual({
      question: "hello",
      audience: "codebase",
      model: "gpt-5.4",
      reasoningEffort: "high",
      selectionMode: "cascade",
      noSync: true,
      noSynthesis: true,
      selectionShadowCompare: true
    });
  });

  it("does not include false booleans", () => {
    const payload = createAskPayload("hello", "expert", { noSync: false });
    expect(payload.noSync).toBeUndefined();
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<script>alert("x'y")</script>&`)).toBe(
      "&lt;script&gt;alert(&quot;x&#39;y&quot;)&lt;/script&gt;&amp;"
    );
  });
});

describe("renderMarkdownHtml", () => {
  it("falls back to escaped text when no runtime is available", () => {
    expect(renderMarkdownHtml("<b>x</b>", null)).toBe("&lt;b&gt;x&lt;/b&gt;");
  });

  it("uses the runtime's marked + DOMPurify pipeline", () => {
    const calls: string[] = [];
    const html = renderMarkdownHtml("input", {
      marked: {
        parse(input) {
          calls.push(`parse:${input}`);
          return `<p>${input}</p>`;
        }
      },
      DOMPurify: {
        sanitize(input) {
          calls.push(`sanitize:${input}`);
          return `[clean]${input}`;
        }
      }
    });

    expect(html).toBe("[clean]<p>input</p>");
    expect(calls).toEqual(["parse:input", "sanitize:<p>input</p>"]);
  });
});

describe("renderRepositoryListHtml", () => {
  it("renders an empty state when the list is empty", () => {
    expect(renderRepositoryListHtml([])).toContain("No configured repos.");
  });

  it("uses a custom setup hint when provided", () => {
    expect(renderRepositoryListHtml([], "Try discover-github.")).toContain("Try discover-github.");
  });

  it("renders one row per repo with name and description fallback", () => {
    const html = renderRepositoryListHtml([
      { name: "alpha", description: "alpha desc" },
      { name: "beta", description: null, defaultBranch: "main" }
    ]);
    expect(html).toContain("alpha");
    expect(html).toContain("alpha desc");
    expect(html).toContain("beta");
    expect(html).toContain("main");
  });

  it("escapes html in repo fields", () => {
    const html = renderRepositoryListHtml([
      { name: "<x>", description: "<script>alert(1)</script>" }
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;x&gt;");
  });
});
