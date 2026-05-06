import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createApp, resolveUiAssetRoot } from "../src/server/app.ts";

describe("server app", () => {
  it("resolves UI asset roots next to source and build server modules", () => {
    const repoRoot = process.cwd();

    expect(resolveUiAssetRoot(pathToFileURL(path.join(repoRoot, "src/server/app.ts")).href))
      .toBe(path.join(repoRoot, "src/server/ui/assets"));
    expect(resolveUiAssetRoot(pathToFileURL(path.join(repoRoot, "dist/server/app.js")).href))
      .toBe(path.join(repoRoot, "dist/server/ui/assets"));
  });

  it("falls back to the parent server UI asset root for nested modules", () => {
    const repoRoot = process.cwd();

    expect(resolveUiAssetRoot(pathToFileURL(path.join(repoRoot, "src/server/routes/ask.ts")).href))
      .toBe(path.join(repoRoot, "src/server/ui/assets"));
  });

  it("serves static UI assets", async () => {
    const app = createTestApp({
      assetRoot: path.join(process.cwd(), "src/server/ui/assets")
    });

    const scriptResponse = await app.fetch(new Request("http://atc.local/ui/assets/vendor/marked.min.js"));
    const logoResponse = await app.fetch(new Request("http://atc.local/ui/assets/logo.svg"));

    expect(scriptResponse.status).toBe(200);
    expect(scriptResponse.headers.get("content-type")).toContain("text/javascript");
    expect(await scriptResponse.text()).toContain("marked");
    expect(logoResponse.status).toBe(200);
    expect(logoResponse.headers.get("content-type")).toContain("image/svg+xml");
    expect(await logoResponse.text()).toContain("aria-label=\"ATC\"");
  });

  it("returns JSON for unknown API paths without a catch-all fallback", async () => {
    const app = createTestApp();

    const response = await app.fetch(new Request("http://atc.local/legacy"));
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toBe("{\"error\":\"No route for GET /legacy\"}");
  });

  it("returns compact JSON for unhandled route errors", async () => {
    const app = createTestApp({
      loadConfigFn: async () => {
        throw new Error("config exploded");
      }
    });

    const response = await app.fetch(new Request("http://atc.local/repos"));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toBe("{\"error\":\"config exploded\"}");
  });

  it("normalizes explicit HTTP errors through the same error response path", async () => {
    const app = createTestApp();

    const response = await app.fetch(new Request("http://atc.local/ask", {
      method: "POST",
      body: "not json"
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining("Request body must be valid JSON")
    });
  });

  it("fails fast when GitHub SSO configuration is partial", () => {
    expect(() => createTestApp({
      env: {
        ATC_AUTH_SECRET: "test-secret"
      }
    })).toThrow(/Set all GitHub SSO env vars or none of them/u);
  });
});

function createTestApp(
  overrides: Partial<Parameters<typeof createApp>[0]> = {}
): ReturnType<typeof createApp> {
  return createApp({
    bodyLimitBytes: 65_536,
    env: {},
    jobManager: {
      createJob: vi.fn(),
      getJob: vi.fn(() => null),
      subscribe: vi.fn(() => null)
    },
    loadConfigFn: async () => ({ repos: [] }),
    ...overrides
  });
}
