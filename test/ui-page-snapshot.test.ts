import { describe, expect, it } from "vitest";

import { AppPage } from "../src/server/ui/pages/app-page.tsx";

async function renderToString(node: unknown): Promise<string> {
  if (node && typeof (node as { toString: () => string }).toString === "function") {
    const value = (node as { toString: () => unknown }).toString();
    if (value && typeof (value as Promise<string>).then === "function") {
      return String(await value);
    }
    return String(value);
  }
  return String(node);
}

describe("AppPage", () => {
  it("renders Simple mode shell with the required UI hooks", async () => {
    const html = await renderToString(AppPage({ mode: "simple" }));
    expect(html).toContain('data-mode="simple"');
    expect(html).toContain('class="app-shell"');
    expect(html).toContain("/ui/assets/styles.css");
    expect(html).toContain("/ui/assets/vendor/marked.min.js");
    expect(html).toContain("/ui/assets/vendor/purify.min.js");
    expect(html).toContain("/ui/assets/app.js");
    expect(html).toContain('id="question"');
    expect(html).toContain('id="ask-button"');
    expect(html).toContain('data-stage="job-created"');
    expect(html).toContain('data-stage="synthesis"');
    expect(html).toContain('id="answer-card"');
  });

  it("server-renders the Expert sidebar and view-panel stubs in both modes", async () => {
    for (const mode of ["simple", "expert"] as const) {
      const html = await renderToString(AppPage({ mode }));
      expect(html).toContain('class="sidebar"');
      expect(html).toContain('data-view-panel="repos"');
      expect(html).toContain('data-view-panel="history"');
      expect(html).toContain('data-view-panel="sync-status"');
    }
  });
});
