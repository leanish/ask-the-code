import { afterEach, describe, expect, it, vi } from "vitest";

import { createAskJobManager } from "../src/core/jobs/ask-job-manager.ts";
import { createApp, type CreateAppOptions } from "../src/server/app.ts";
import type {
  AskJobEvent,
  AskJobSnapshot,
  Environment,
  QuestionExecutionOverrides,
  StatusReporter
} from "../src/core/types.ts";
import { createLoadedConfig, createManagedRepo } from "./test-helpers.ts";

type HttpJobManager = CreateAppOptions["jobManager"];

type RequestOptions = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  rawBodyBytes?: Uint8Array;
};

type ResponseShape = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

type SseEvent = {
  type: string;
  data: Record<string, unknown>;
};

const managers: Array<ReturnType<typeof createAskJobManager>> = [];

describe("http-server", () => {
  afterEach(() => {
    while (managers.length > 0) {
      managers.pop()?.close();
    }
  });

  it("creates async ask jobs and exposes them over HTTP", async () => {
    const manager = createAskJobManager({
      answerQuestionFn: async ({ question }, execution) => {
        const statusReporter = getRequiredStatusReporter(execution);
        statusReporter.info("selected repos");

        return {
          mode: "answer",
          question,
          selectedRepos: [{ name: "ask-the-code" }],
          syncReport: [{ name: "ask-the-code", action: "skipped" }],
          synthesis: { text: "Final answer" }
        };
      },
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const app = buildApp({ jobManager: manager });

    const createResponse = await performRequest(app, {
      method: "POST",
      path: "/ask",
      body: {
        question: "How does ask-the-code work?",
        repoNames: ["ask-the-code"],
        audience: "codebase",
        noSync: true
      }
    });
    const createdJob = JSON.parse(createResponse.body);

    expect(createResponse.statusCode).toBe(202);
    expect(["queued", "running"]).toContain(createdJob.status);
    expect(createdJob.links.self).toBe(`/jobs/${createdJob.id}`);
    expect(createdJob.request.audience).toBe("codebase");

    await waitFor(async () => {
      const jobResponse = await performRequest(app, { method: "GET", path: createdJob.links.self });
      return JSON.parse(jobResponse.body).status === "completed";
    });

    const finalResponse = await performRequest(app, {
      method: "GET",
      path: createdJob.links.self
    });
    const finalJob = JSON.parse(finalResponse.body);

    expect(finalResponse.statusCode).toBe(200);
    expect(finalJob).toMatchObject({
      id: createdJob.id,
      status: "completed",
      result: { synthesis: { text: "Final answer" } }
    });
  });

  it("serves the health and options endpoints", async () => {
    const manager = createAskJobManager({
      answerQuestionFn: async () => ({
        mode: "answer",
        question: "ignored",
        selectedRepos: [],
        syncReport: [],
        synthesis: { text: "ignored" }
      }),
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const app = buildApp({ jobManager: manager });

    const healthResponse = await performRequest(app, { method: "GET", path: "/health" });
    const optionsResponse = await performRequest(app, {
      method: "OPTIONS",
      path: "/ask",
      headers: {
        origin: "http://localhost",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });

    expect(healthResponse.statusCode).toBe(200);
    expect(JSON.parse(healthResponse.body)).toEqual({
      status: "ok",
      jobs: { queued: 0, running: 0, completed: 0, failed: 0 }
    });
    expect(optionsResponse.statusCode).toBe(204);
    expect(optionsResponse.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("returns ok health even when a custom job manager does not expose stats", async () => {
    const app = buildApp({ jobManager: createMinimalJobManager() });

    const healthResponse = await performRequest(app, { method: "GET", path: "/health" });

    expect(healthResponse.statusCode).toBe(200);
    expect(JSON.parse(healthResponse.body)).toEqual({ status: "ok", jobs: null });
  });

  it("includes job stats in the health endpoint after creating jobs", async () => {
    let releaseJob: () => void = () => {
      throw new Error("Job release was not initialized.");
    };
    const released = new Promise<void>(resolve => {
      releaseJob = resolve;
    });
    const manager = createAskJobManager({
      answerQuestionFn: async () => {
        await released;
        return {
          mode: "answer",
          question: "ignored",
          selectedRepos: [],
          syncReport: [],
          synthesis: { text: "ignored" }
        };
      },
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const app = buildApp({ jobManager: manager });

    await performRequest(app, {
      method: "POST",
      path: "/ask",
      body: { question: "stat me" }
    });

    const inflight = await performRequest(app, { method: "GET", path: "/health" });
    expect(JSON.parse(inflight.body).jobs.running + JSON.parse(inflight.body).jobs.queued).toBeGreaterThan(0);

    releaseJob();
    await waitFor(() => manager.getStats().completed === 1);

    const after = await performRequest(app, { method: "GET", path: "/health" });
    expect(JSON.parse(after.body).jobs.completed).toBe(1);
  });

  it("lists configured repos for the web picker", async () => {
    const repos = [
      createManagedRepo({ name: "alpha", description: "alpha repo", aliases: ["a"] }),
      createManagedRepo({ name: "beta", description: "beta repo" })
    ];
    const app = buildApp({
      jobManager: createMinimalJobManager(),
      loadConfigFn: async () => createLoadedConfig({ repos })
    });

    const response = await performRequest(app, { method: "GET", path: "/repos" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      repos: [
        { name: "alpha", description: "alpha repo", aliases: ["a"] },
        { name: "beta", description: "beta repo" }
      ],
      setupHint: null
    });
  });

  it("includes a setup hint when the configured repo list is empty", async () => {
    const app = buildApp({
      jobManager: createMinimalJobManager(),
      loadConfigFn: async () => createLoadedConfig({ repos: [] })
    });

    const response = await performRequest(app, { method: "GET", path: "/repos" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      repos: [],
      setupHint: 'No configured repos available. Try "atc config discover-github" to discover and add repos.'
    });
  });

  it("streams job events over server-sent events", async () => {
    let releaseJob: () => void = () => {
      throw new Error("Job release was not initialized.");
    };
    const jobReleased = new Promise<void>(resolve => {
      releaseJob = resolve;
    });
    const manager = createAskJobManager({
      answerQuestionFn: async ({ question }, execution) => {
        const statusReporter = getRequiredStatusReporter(execution);
        statusReporter.info(`running ${question}`);
        await jobReleased;
        statusReporter.info(`done ${question}`);
        return {
          mode: "answer",
          question,
          selectedRepos: [],
          syncReport: [],
          synthesis: { text: "Final answer" }
        };
      },
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const app = buildApp({ jobManager: manager });

    const created = await performRequest(app, {
      method: "POST",
      path: "/ask",
      body: { question: "how do you stream events?" }
    });
    const job = JSON.parse(created.body);

    const streamResponse = await app.fetch(new Request(`http://localhost${job.links.events}`));
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type") ?? "").toContain("text/event-stream");

    const reader = streamResponse.body!.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    const eventsByType: Record<string, SseEvent[]> = {};
    let sawSnapshot = false;

    setTimeout(() => releaseJob(), 0);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let delim = buffer.indexOf("\n\n");
      while (delim >= 0) {
        const raw = buffer.slice(0, delim);
        buffer = buffer.slice(delim + 2);
        const event = parseSseEvent(raw);
        if (event) {
          (eventsByType[event.type] ??= []).push(event);
          if (event.type === "snapshot") sawSnapshot = true;
        }
        delim = buffer.indexOf("\n\n");
      }
      if (eventsByType.completed) break;
    }

    expect(sawSnapshot).toBe(true);
    expect(eventsByType.status?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(eventsByType.completed?.[0]?.data.type).toBe("completed");
  });

  it("rejects invalid ask payloads", async () => {
    const app = buildApp({ jobManager: createMinimalJobManager() });

    const noBody = await performRequest(app, { method: "POST", path: "/ask", rawBody: "" });
    expect(noBody.statusCode).toBe(400);

    const noQuestion = await performRequest(app, {
      method: "POST",
      path: "/ask",
      body: { repoNames: ["x"] }
    });
    expect(noQuestion.statusCode).toBe(400);

    const bothLists = await performRequest(app, {
      method: "POST",
      path: "/ask",
      body: { question: "hi", repoNames: ["x"], repos: ["y"] }
    });
    expect(bothLists.statusCode).toBe(400);
    expect(JSON.parse(bothLists.body).error).toContain('Use either "repoNames" or "repos"');

    const badAudience = await performRequest(app, {
      method: "POST",
      path: "/ask",
      body: { question: "hi", audience: "wrong" }
    });
    expect(badAudience.statusCode).toBe(400);

    const badSelection = await performRequest(app, {
      method: "POST",
      path: "/ask",
      body: { question: "hi", selectionMode: "wrong" }
    });
    expect(badSelection.statusCode).toBe(400);
  });

  it("returns not found for unknown routes and unknown jobs", async () => {
    const app = buildApp({ jobManager: createMinimalJobManager() });

    const unknownRoute = await performRequest(app, { method: "GET", path: "/nope" });
    expect(unknownRoute.statusCode).toBe(404);

    const unknownJob = await performRequest(app, { method: "GET", path: "/jobs/missing" });
    expect(unknownJob.statusCode).toBe(404);
    expect(JSON.parse(unknownJob.body).error).toContain("Unknown job");
  });

  it("returns 410 for the removed POST /jobs route", async () => {
    const app = buildApp({ jobManager: createMinimalJobManager() });

    const response = await performRequest(app, { method: "POST", path: "/jobs", body: {} });

    expect(response.statusCode).toBe(410);
    expect(JSON.parse(response.body).error).toContain("POST /jobs was removed");
  });

  it("streams an immediate terminal snapshot for completed jobs", async () => {
    const completedJob: AskJobSnapshot = {
      id: "complete-1",
      status: "completed",
      createdAt: "2026-04-03T00:00:00.000Z",
      startedAt: "2026-04-03T00:00:00.500Z",
      finishedAt: "2026-04-03T00:00:01.000Z",
      error: null,
      request: {
        question: "irrelevant",
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
        question: "irrelevant",
        selectedRepos: [],
        syncReport: [],
        synthesis: { text: "done" }
      }
    };
    const jobManager = createMinimalJobManager({
      getJob: vi.fn(() => completedJob)
    });
    const app = buildApp({ jobManager });

    const response = await app.fetch(new Request("http://localhost/jobs/complete-1/events"));
    expect(response.status).toBe(200);

    const text = await response.text();
    const events = parseSseStream(text);

    expect(events.find(e => e.type === "snapshot")).toBeTruthy();
    expect(events.find(e => e.type === "completed")).toBeTruthy();
  });

  it("accepts comma-separated repo names and rejects invalid request shapes", async () => {
    const manager = createAskJobManager({
      answerQuestionFn: async () => ({
        mode: "answer",
        question: "ignored",
        selectedRepos: [],
        syncReport: [],
        synthesis: { text: "ignored" }
      })
    });
    managers.push(manager);
    const app = buildApp({ jobManager: manager });

    const response = await performRequest(app, {
      method: "POST",
      path: "/ask",
      body: { question: "?", repos: " a , b " }
    });
    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body).request.repoNames).toEqual(["a", "b"]);

    const badShape = await performRequest(app, {
      method: "POST",
      path: "/ask",
      body: { question: "?", repoNames: [123] }
    });
    expect(badShape.statusCode).toBe(400);
  });

  it("rejects malformed json request bodies", async () => {
    const app = buildApp({ jobManager: createMinimalJobManager() });

    const response = await performRequest(app, {
      method: "POST",
      path: "/ask",
      rawBody: "{not json"
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("Request body must be valid JSON");
  });

  it("rejects oversized request bodies", async () => {
    const app = buildApp({ jobManager: createMinimalJobManager(), bodyLimitBytes: 16 });

    const response = await performRequest(app, {
      method: "POST",
      path: "/ask",
      rawBody: "x".repeat(64)
    });

    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body).error).toContain("exceeds 16 bytes");
  });

  it("returns a 500 response for unexpected errors", async () => {
    const app = buildApp({
      jobManager: {
        createJob() {
          throw new Error("boom");
        },
        getJob() {
          return null;
        },
        subscribe() {
          return null;
        }
      }
    });

    const response = await performRequest(app, {
      method: "POST",
      path: "/ask",
      body: { question: "explode" }
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: "boom" });
  });
});

function buildApp(opts: {
  jobManager: HttpJobManager;
  bodyLimitBytes?: number;
  loadConfigFn?: CreateAppOptions["loadConfigFn"];
}) {
  return createApp({
    jobManager: opts.jobManager,
    ...(opts.bodyLimitBytes !== undefined ? { bodyLimitBytes: opts.bodyLimitBytes } : {}),
    ...(opts.loadConfigFn ? { loadConfigFn: opts.loadConfigFn } : {})
  });
}

function createMinimalJobManager(
  overrides: Partial<HttpJobManager> = {}
): HttpJobManager {
  const base: HttpJobManager = {
    createJob: vi.fn(),
    getJob: vi.fn(() => null),
    subscribe: vi.fn(() => null)
  };
  return { ...base, ...overrides };
}

async function performRequest(
  app: ReturnType<typeof createApp>,
  opts: RequestOptions
): Promise<ResponseShape> {
  const url = `http://localhost${opts.path.startsWith("/") ? opts.path : `/${opts.path}`}`;
  const init: RequestInit = {
    method: opts.method,
    headers: opts.headers ?? {}
  };

  if (opts.method !== "GET" && opts.method !== "HEAD" && opts.method !== "OPTIONS") {
    if (opts.rawBodyBytes !== undefined) {
      init.body = opts.rawBodyBytes;
    } else if (opts.rawBody !== undefined) {
      init.body = opts.rawBody;
    } else if (opts.body !== undefined) {
      init.body = JSON.stringify(opts.body);
      init.headers = { "content-type": "application/json", ...(init.headers as Record<string, string>) };
    }
  }

  const response = await app.fetch(new Request(url, init));
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const body = await response.text();
  return { statusCode: response.status, headers, body };
}

function parseSseEvent(rawEvent: string): SseEvent | null {
  const lines = rawEvent.split("\n");
  let type = "message";
  let data = "";

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      type = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      data += line.slice("data:".length).trim();
    }
  }

  if (!data) return null;
  return { type, data: JSON.parse(data) as Record<string, unknown> };
}

function parseSseStream(body: string): SseEvent[] {
  return body
    .split("\n\n")
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(parseSseEvent)
    .filter((event): event is SseEvent => event !== null);
}

async function waitFor(predicate: () => boolean | Promise<boolean>, attempts = 100): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (await predicate()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  throw new Error("Condition not met in time.");
}

function getRequiredStatusReporter(
  envOrExecution: Environment | QuestionExecutionOverrides | undefined
): StatusReporter {
  if (envOrExecution && typeof envOrExecution === "object" && "statusReporter" in envOrExecution) {
    const reporter = (envOrExecution as QuestionExecutionOverrides).statusReporter;
    if (reporter) return reporter;
  }
  throw new Error("Expected status reporter on the execution context.");
}

// Re-export AskJobEvent for any external test helpers that might import it.
export type { AskJobEvent };
