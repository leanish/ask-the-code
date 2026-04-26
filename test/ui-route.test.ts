import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/server/app.ts";

describe("UI route", () => {
  it("serves the new simple-mode app at the root HTML route", async () => {
    const app = createTestApp();

    const response = await app.fetch(new Request("http://atc.local/", {
      headers: {
        Accept: "text/html"
      }
    }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("ask-the-code (ATC)");
    expect(html).toContain("data-mode=\"simple\"");
    expect(html).toContain("/ui/assets/logo.svg");
    expect(html).toContain("/ui/assets/styles.css");
    expect(html).toContain("/ui/assets/app.js");
    expect(html).toContain("/ui/assets/vendor/marked.min.js");
    expect(html).toContain("/ui/assets/vendor/purify.min.js");
  });

  it("serves expert mode from the query string and stores it in a cookie", async () => {
    const app = createTestApp();

    const response = await app.fetch(new Request("http://atc.local/?mode=expert", {
      headers: {
        Accept: "text/html"
      }
    }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("atc_mode=expert");
    expect(html).toContain("data-mode=\"expert\"");
    expect(html).toContain("ATC v0.1.0");
    expect(html).toContain("Simple");
    expect(html).toContain("Expert");
    expect(html).toContain("All Repositories");
    expect(html).toContain("Options");
    expect(html).toContain("Reasoning effort");
    expect(html).toContain("<input type=\"radio\" name=\"audience\" value=\"general\" checked");
    expect(html).not.toContain("<option value=\"\">Default</option>");
    expect(html).toContain("<option value=\"gpt-5.4-mini\" selected");
    expect(html).toContain("<option value=\"low\" selected");
    expect(html).toContain("Run summary");
    expect(html).toContain("data-collapsible-panel=\"options\"");
    expect(html).toContain("data-collapsible-panel=\"progress\"");
    expect(html).toContain("data-collapsible-panel=\"run-summary\"");
    expect(html).toContain("data-collapsible-summary=\"progress\"");
    expect(html).toContain("data-collapsible-summary=\"run-summary\"");
    expect(html).toContain("data-collapsible-body=\"options\" hidden");
    expect(html).toContain("No previous questions yet.");
    expect(html).toContain("Sync status view is coming soon.");
    expect(html).toContain("data-view-panel=\"repos\"");
  });

  it("serves expert mode from the mode cookie when no query mode is present", async () => {
    const app = createTestApp();

    const response = await app.fetch(new Request("http://atc.local/", {
      headers: {
        Accept: "text/html",
        Cookie: "atc_mode=expert"
      }
    }));
    const html = await response.text();

    expect(html).toContain("data-mode=\"expert\"");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

function createTestApp(): ReturnType<typeof createApp> {
  return createApp({
    bodyLimitBytes: 65_536,
    env: {},
    jobManager: {
      createJob: vi.fn(),
      getJob: vi.fn(() => null),
      subscribe: vi.fn(() => null)
    },
    loadConfigFn: async () => ({ repos: [] })
  });
}
