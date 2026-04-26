import { existsSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createApp, resolveAssetRoot } from "../src/server/app.ts";
import type { AskJobManager } from "../src/core/types.ts";

function createMinimalJobManager(): Pick<AskJobManager, "createJob" | "getJob" | "subscribe" | "getStats"> {
  return {
    createJob: vi.fn(),
    getJob: vi.fn(() => null),
    subscribe: vi.fn(() => null),
    getStats: vi.fn(() => ({ queued: 0, running: 0, completed: 0, failed: 0 }))
  };
}

describe("createApp", () => {
  it("resolves the asset root to a real directory", () => {
    const root = resolveAssetRoot();
    expect(existsSync(root)).toBe(true);
  });

  it("serves vendored marked.min.js under /ui/assets", async () => {
    const app = createApp({ jobManager: createMinimalJobManager() });
    const response = await app.fetch(new Request("http://localhost/ui/assets/vendor/marked.min.js"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toMatch(/javascript/);
  });

  it("serves vendored purify.min.js under /ui/assets", async () => {
    const app = createApp({ jobManager: createMinimalJobManager() });
    const response = await app.fetch(new Request("http://localhost/ui/assets/vendor/purify.min.js"));

    expect(response.status).toBe(200);
  });
});
