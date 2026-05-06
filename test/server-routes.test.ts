import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/server/app.ts";
import { createHistoryStore } from "../src/server/history-store.ts";
import type { AskJobManager, AskJobSnapshot } from "../src/core/types.ts";

describe("server routes", () => {
  it("renders the UI in default, query-selected, and cookie-selected modes", async () => {
    const app = createApp({ jobManager: createMinimalJobManager() });

    const defaultMode = await app.request("/");
    const queryMode = await app.request("/?mode=expert");
    const cookieMode = await app.request("/", { headers: { cookie: "atc_mode=expert" } });

    expect(await defaultMode.text()).toContain('data-mode="simple"');
    expect(await queryMode.text()).toContain('data-mode="expert"');
    expect(queryMode.headers.get("set-cookie")).toContain("atc_mode=expert");
    expect(await cookieMode.text()).toContain('data-mode="expert"');
  });

  it("lists recorded history for jobs that are still available", async () => {
    const historyStore = createHistoryStore();
    historyStore.record("missing");
    historyStore.record("done");
    const jobManager = createMinimalJobManager({
      getJob: vi.fn(id => id === "done" ? createCompletedJob() : null)
    });
    const app = createApp({ jobManager, historyStore });

    const response = await app.request("/history");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id: "done",
          question: "What changed?",
          status: "completed",
          createdAt: "2026-04-27T00:00:00.000Z",
          finishedAt: "2026-04-27T00:00:01.000Z",
          repos: ["ask-the-code"]
        }
      ],
      total: 1
    });
  });
});

function createMinimalJobManager(
  overrides: Partial<Pick<AskJobManager, "createJob" | "getJob" | "subscribe" | "getStats">> = {}
): Pick<AskJobManager, "createJob" | "getJob" | "subscribe"> & Partial<Pick<AskJobManager, "getStats">> {
  return {
    createJob: vi.fn(),
    getJob: vi.fn(() => null),
    subscribe: vi.fn(() => null),
    getStats: vi.fn(() => ({ queued: 0, running: 0, completed: 0, failed: 0 })),
    ...overrides
  };
}

function createCompletedJob(): AskJobSnapshot {
  return {
    id: "done",
    status: "completed",
    createdAt: "2026-04-27T00:00:00.000Z",
    startedAt: "2026-04-27T00:00:00.500Z",
    finishedAt: "2026-04-27T00:00:01.000Z",
    error: null,
    request: {
      question: "What changed?",
      repoNames: null,
      audience: "general",
      model: null,
      reasoningEffort: null,
      selectionMode: "single",
      selectionShadowCompare: false,
      noSync: false,
      noSynthesis: false
    },
    events: [],
    result: {
      mode: "answer",
      question: "What changed?",
      selectedRepos: [{ name: "ask-the-code" }],
      syncReport: [],
      synthesis: { text: "It changed." }
    }
  };
}
