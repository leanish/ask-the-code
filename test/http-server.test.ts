import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAskJobManager } from "../src/core/jobs/ask-job-manager.js";
import type { AnswerQuestionFn, AskJobEvent, AskJobSnapshot } from "../src/core/types.js";
import { createHttpHandler } from "../src/server/api/http-server.js";
import { createLoadedConfig, createManagedRepo } from "./test-helpers.js";

type HttpHandler = ReturnType<typeof createHttpHandler>;
type HttpJobManager = Parameters<typeof createHttpHandler>[0]["jobManager"];
type HandlerRequestOptions = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  skipAutoEndWrite?: boolean;
};
type MockRequest = PassThrough & {
  method: string;
  url: string;
  headers: Record<string, string>;
  destroyed: boolean;
};
type MockResponse = PassThrough & {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  destroyed: boolean;
  setHeader(name: string, value: string): void;
  writeHead(statusCode: number, headers?: Record<string, string>): MockResponse;
};
type ManualRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  destroyed: boolean;
  on(event: "data", handler: (chunk: Buffer) => void): ManualRequest;
  on(event: "end", handler: () => void): ManualRequest;
  on(event: "error", handler: (error: Error) => void): ManualRequest;
  destroy(): void;
  emit(event: "data" | "end" | "error", ...args: unknown[]): void;
};
type SseEvent = {
  type: string;
  data: Record<string, unknown>;
};

const managers: Array<ReturnType<typeof createAskJobManager>> = [];

describe("http-server", () => {
  afterEach(async () => {
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
          selectedRepos: [{ name: "archa" }],
          syncReport: [{ name: "archa", action: "skipped" }],
          synthesis: {
            text: "Final answer"
          }
        };
      },
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const handler = createHttpHandler({ jobManager: manager });

    const createResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "How does archa work?",
        repoNames: ["archa"],
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
      const jobResponse = await performRequest(handler, {
        method: "GET",
        path: createdJob.links.self
      });
      const job = JSON.parse(jobResponse.body);
      return job.status === "completed";
    });

    const finalResponse = await performRequest(handler, {
      method: "GET",
      path: createdJob.links.self
    });
    const finalJob = JSON.parse(finalResponse.body);

    expect(finalResponse.statusCode).toBe(200);
    expect(finalJob).toMatchObject({
      id: createdJob.id,
      status: "completed",
      result: {
        synthesis: {
          text: "Final answer"
        }
      }
    });
  });

  it("serves the index, health, and options endpoints", async () => {
    const manager = createAskJobManager({
      answerQuestionFn: async () => ({
        mode: "answer",
        question: "ignored",
        selectedRepos: [],
        syncReport: [],
        synthesis: {
          text: "ignored"
        }
      }),
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const handler = createHttpHandler({ jobManager: manager });

    const indexResponse = await performRequest(handler, {
      method: "GET",
      path: "/"
    });
    const healthResponse = await performRequest(handler, {
      method: "GET",
      path: "/health"
    });
    const optionsResponse = await performRequest(handler, {
      method: "OPTIONS",
      path: "/ask"
    });

    expect(indexResponse.statusCode).toBe(200);
    expect(JSON.parse(indexResponse.body)).toMatchObject({
      service: "archa-server",
      endpoints: {
        createJob: "POST /ask",
        listRepos: "GET /repos"
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
    const handler = createHttpHandler({
      jobManager: createHttpJobManager()
    });

    const healthResponse = await performRequest(handler, {
      method: "GET",
      path: "/health"
    });

    expect(healthResponse.statusCode).toBe(200);
    expect(JSON.parse(healthResponse.body)).toEqual({
      status: "ok",
      jobs: null
    });
  });

  it("includes job stats in the health endpoint after creating jobs", async () => {
    let releaseJob: () => void = () => {
      throw new Error("Job release was not initialized.");
    };
    const jobReleased = new Promise<void>(resolve => {
      releaseJob = resolve;
    });
    const manager = createAskJobManager({
      answerQuestionFn: async () => {
        await jobReleased;

        return {
          mode: "answer",
          question: "ignored",
          selectedRepos: [],
          syncReport: [],
          synthesis: { text: "ignored" }
        };
      },
      maxConcurrentJobs: 1,
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const handler = createHttpHandler({ jobManager: manager });

    await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: { question: "first" }
    });
    await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: { question: "second" }
    });

    await Promise.resolve();

    const healthResponse = await performRequest(handler, {
      method: "GET",
      path: "/health"
    });
    const health = JSON.parse(healthResponse.body);

    expect(health.status).toBe("ok");
    expect(health.jobs.running).toBe(1);
    expect(health.jobs.queued).toBe(1);

    releaseJob();

    await waitFor(async () => {
      const response = await performRequest(handler, {
        method: "GET",
        path: "/health"
      });

      return JSON.parse(response.body).jobs.completed === 2;
    });

    const finalHealth = JSON.parse((await performRequest(handler, {
      method: "GET",
      path: "/health"
    })).body);

    expect(finalHealth.jobs).toEqual({ queued: 0, running: 0, completed: 2, failed: 0 });
  });

  it("lists configured repos for the web picker", async () => {
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
    const handler = createHttpHandler({
      jobManager: manager,
      loadConfigFn: async () => createLoadedConfig({
        repos: [
          createManagedRepo({
            name: "archa",
            defaultBranch: "main",
            description: "Repo-aware CLI for engineering Q&A with local Codex",
            aliases: ["self"],
            directory: "/workspace/archa"
          }),
          createManagedRepo({
            name: "demo-repo",
            defaultBranch: "master",
            description: "Demo repo",
            aliases: []
          })
        ]
      })
    });

    const response = await performRequest(handler, {
      method: "GET",
      path: "/repos"
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      repos: [
        {
          name: "archa",
          defaultBranch: "main",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          aliases: ["self"]
        },
        {
          name: "demo-repo",
          defaultBranch: "master",
          description: "Demo repo",
          aliases: []
        }
      ],
      setupHint: null
    });
  });

  it("includes a setup hint when the configured repo list is empty", async () => {
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
    const handler = createHttpHandler({
      jobManager: manager,
      loadConfigFn: async () => createLoadedConfig({
        repos: []
      })
    });

    const response = await performRequest(handler, {
      method: "GET",
      path: "/repos"
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      repos: [],
      setupHint: 'No configured repos available. Try "archa config discover-github" to discover and add repos.'
    });
  });

  it("serves the web UI when the client accepts text/html", async () => {
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
    const handler = createHttpHandler({ jobManager: manager });

    const htmlResponse = await performRequest(handler, {
      method: "GET",
      path: "/",
      headers: { accept: "text/html,application/xhtml+xml" }
    });

    expect(htmlResponse.statusCode).toBe(200);
    expect(htmlResponse.headers["content-type"]).toContain("text/html");
    expect(htmlResponse.body).toContain("<!DOCTYPE html>");
    expect(htmlResponse.body).toContain("archa");
    expect(htmlResponse.body).toContain("EventSource");
    expect(htmlResponse.body).toContain("/ask");
    expect(htmlResponse.body).toContain("/repos");
    expect(htmlResponse.body).toContain("Search configured repos");
    expect(htmlResponse.body).toContain('id="setup-hint"');
    expect(htmlResponse.body).toContain('archa config discover-github');
    expect(htmlResponse.body).toContain("automatic");
    expect(htmlResponse.body).toContain('id="advanced-options" hidden');
    expect(htmlResponse.body).toContain('params.get("admin")');
    expect(htmlResponse.body).toContain("if (!advancedOptions.hidden)");
    expect(htmlResponse.body).toContain('<option value="general" selected>general</option>');
    expect(htmlResponse.body).toContain('<option value="codebase">codebase</option>');
    expect(htmlResponse.body).toContain('<option value="gpt-5.4-mini" selected>gpt-5.4-mini</option>');
    expect(htmlResponse.body).toContain('<option value="gpt-5.4">gpt-5.4</option>');
    expect(htmlResponse.body).toContain('<option value="low" selected>low</option>');
    expect(htmlResponse.body).not.toContain("repo-picker-toggle");
    expect(htmlResponse.body).not.toContain('id="no-synthesis"');
  });

  it("serves JSON at / when the client does not accept text/html", async () => {
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
    const handler = createHttpHandler({ jobManager: manager });

    const jsonResponse = await performRequest(handler, {
      method: "GET",
      path: "/",
      headers: { accept: "application/json" }
    });

    expect(jsonResponse.statusCode).toBe(200);
    expect(JSON.parse(jsonResponse.body)).toMatchObject({ service: "archa-server" });
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
          synthesis: {
            text: "streamed answer"
          }
        };
      },
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const handler = createHttpHandler({ jobManager: manager });

    const createResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "stream this"
      }
    });
    const createdJob = JSON.parse(createResponse.body);
    const sseRequest = startRequest(handler, {
      method: "GET",
      path: createdJob.links.events,
      headers: {
        Accept: "text/event-stream"
      }
    });
    const eventsPromise = collectSseEvents(sseRequest.response, "completed");

    releaseJob();

    const events = await eventsPromise;

    expect(sseRequest.response.statusCode).toBe(200);
    expect(events.map(event => event.type)).toContain("snapshot");
    expect(events.map(event => event.type)).toContain("status");
    expect(events.map(event => event.type)).toContain("completed");
    expect(events.find(event => event.type === "snapshot")?.data.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          message: "running stream this"
        })
      ])
    );
    expect(events.filter(event => event.type === "status").map(event => event.data.message)).toContain("done stream this");
  });

  it("rejects invalid ask payloads", async () => {
    const manager = createAskJobManager({
      answerQuestionFn: async () => ({
        mode: "answer",
        question: "ignored",
        selectedRepos: [],
        syncReport: [],
        synthesis: {
          text: "ignored"
        }
      })
    });
    managers.push(manager);
    const handler = createHttpHandler({ jobManager: manager });

    const response = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: ""
      }
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.error).toContain("non-empty \"question\"");
  });

  it("returns not found for unknown routes and unknown jobs", async () => {
    const manager = createAskJobManager({
      answerQuestionFn: async () => ({
        mode: "answer",
        question: "ignored",
        selectedRepos: [],
        syncReport: [],
        synthesis: {
          text: "ignored"
        }
      }),
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const handler = createHttpHandler({ jobManager: manager });

    const routeResponse = await performRequest(handler, {
      method: "GET",
      path: "/missing"
    });
    const removedCreateAliasResponse = await performRequest(handler, {
      method: "POST",
      path: "/jobs",
      body: {
        question: "removed alias"
      }
    });
    const jobResponse = await performRequest(handler, {
      method: "GET",
      path: "/jobs/missing"
    });
    const eventsResponse = await performRequest(handler, {
      method: "GET",
      path: "/jobs/missing/events"
    });

    expect(routeResponse.statusCode).toBe(404);
    expect(JSON.parse(routeResponse.body).error).toContain("No route");
    expect(removedCreateAliasResponse.statusCode).toBe(410);
    expect(JSON.parse(removedCreateAliasResponse.body).error).toContain("POST /jobs was removed. Use POST /ask.");
    expect(jobResponse.statusCode).toBe(404);
    expect(JSON.parse(jobResponse.body).error).toContain("Unknown job");
    expect(eventsResponse.statusCode).toBe(404);
    expect(JSON.parse(eventsResponse.body).error).toContain("Unknown job");
  });

  it("streams an immediate terminal snapshot for completed jobs", async () => {
    const manager = createAskJobManager({
      answerQuestionFn: async ({ question }) => ({
        mode: "answer",
        question,
        selectedRepos: [],
        syncReport: [],
        synthesis: {
          text: "terminal"
        }
      }),
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const handler = createHttpHandler({ jobManager: manager });

    const createResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "terminal"
      }
    });
    const createdJob = JSON.parse(createResponse.body);

    await waitFor(async () => {
      const response = await performRequest(handler, {
        method: "GET",
        path: createdJob.links.self
      });

      return JSON.parse(response.body).status === "completed";
    });

    const response = await performRequest(handler, {
      method: "GET",
      path: createdJob.links.events
    });
    const events = parseSseStreamBody(response.body);

    expect(events.map(event => event.type)).toEqual(expect.arrayContaining(["snapshot", "completed"]));
  });

  it("accepts comma-separated repo names and rejects invalid request shapes", async () => {
    const manager = createAskJobManager({
      answerQuestionFn: async ({ question, repoNames }) => ({
        mode: "answer",
        question,
        selectedRepos: repoNames?.map(name => ({ name })) || [],
        syncReport: [],
        synthesis: {
          text: "ok"
        }
      }),
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const handler = createHttpHandler({ jobManager: manager });

    const goodResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "repo parsing",
        repoNames: "archa, self",
        audience: "codebase"
      }
    });
    const duplicateFieldResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "duplicate",
        repoNames: ["archa"],
        repos: ["self"]
      }
    });
    const duplicateFieldWithEmptyStringResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "duplicate with empty repoNames",
        repoNames: "",
        repos: ["self"]
      }
    });
    const invalidRepoNamesResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "bad repoNames",
        repoNames: 42
      }
    });
    const invalidModelResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "bad model",
        model: ""
      }
    });
    const invalidAudienceResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "bad audience",
        audience: "internal"
      }
    });
    const invalidBooleanResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "bad bool",
        noSync: "true"
      }
    });
    const invalidBodyResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      rawBody: "[]"
    });

    expect(goodResponse.statusCode).toBe(202);
    expect(JSON.parse(goodResponse.body).request.repoNames).toEqual(["archa", "self"]);
    expect(JSON.parse(goodResponse.body).request.audience).toBe("codebase");
    expect(duplicateFieldResponse.statusCode).toBe(400);
    expect(JSON.parse(duplicateFieldResponse.body).error).toContain("either \"repoNames\" or \"repos\"");
    expect(duplicateFieldWithEmptyStringResponse.statusCode).toBe(400);
    expect(JSON.parse(duplicateFieldWithEmptyStringResponse.body).error).toContain("either \"repoNames\" or \"repos\"");
    expect(invalidRepoNamesResponse.statusCode).toBe(400);
    expect(JSON.parse(invalidRepoNamesResponse.body).error).toContain("comma-separated string");
    expect(invalidModelResponse.statusCode).toBe(400);
    expect(JSON.parse(invalidModelResponse.body).error).toContain("\"model\"");
    expect(invalidAudienceResponse.statusCode).toBe(400);
    expect(JSON.parse(invalidAudienceResponse.body).error).toContain("\"audience\"");
    expect(invalidBooleanResponse.statusCode).toBe(400);
    expect(JSON.parse(invalidBooleanResponse.body).error).toContain("\"noSync\"");
    expect(invalidBodyResponse.statusCode).toBe(400);
    expect(JSON.parse(invalidBodyResponse.body).error).toContain("JSON object");
  });

  it("rejects an empty request body", async () => {
    const handler = createValidationHandler(10);

    const response = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      skipAutoEndWrite: true
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("valid JSON");
  });

  it("rejects malformed json request bodies", async () => {
    const handler = createValidationHandler(10);

    const response = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      rawBody: "{bad"
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("valid JSON");
  });

  it("rejects oversized request bodies", async () => {
    const handler = createValidationHandler(10);

    const response = await performManualRequest(handler, request => {
      request.emit("data", Buffer.from(JSON.stringify({
        question: "this body is too large"
      })));
    });

    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body).error).toContain("exceeds 10 bytes");
  });

  it("returns a 500 response for unexpected errors", async () => {
    const handler = createHttpHandler({
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

    const response = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "explode"
      }
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: "boom"
    });
  });

  it("rejects malformed request urls without crashing the handler", async () => {
    const handler = createValidationHandler(10);

    const response = await performRequest(handler, {
      method: "GET",
      path: "http://%"
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("Invalid request URL");
  });

  it("does not write SSE events after the response is already destroyed", async () => {
    const listenerRef: { current: ((event: AskJobEvent) => void) | null } = { current: null };
    const unsubscribe = vi.fn();
    const jobManager = createHttpJobManager({
      getJob: vi.fn(() => createJobSnapshot({
        status: "running"
      })),
      subscribe: vi.fn((_jobId, callback) => {
        listenerRef.current = callback;
        return unsubscribe;
      })
    });
    const handler = createHttpHandler({ jobManager });
    const exchange = startRequest(handler, {
      method: "GET",
      path: "/jobs/job-1/events"
    });

    await Promise.resolve();
    const initialBody = exchange.response.body;
    exchange.response.destroyed = true;

    if (listenerRef.current) {
      listenerRef.current({
        sequence: 1,
        type: "status",
        message: "after close",
        timestamp: "2026-04-03T00:00:01.000Z"
      });
    }

    expect(exchange.response.body).toBe(initialBody);

    exchange.response.emit("close");
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("cleans up the SSE subscription when the terminal snapshot cannot be written", async () => {
    const listenerRef: { current: ((event: AskJobEvent) => void) | null } = { current: null };
    const unsubscribe = vi.fn();
    const jobManager = createHttpJobManager({
      getJob: vi.fn(() => createJobSnapshot({
        status: "running",
        finishedAt: "2026-04-03T00:00:01.000Z",
        result: {
          mode: "answer",
          question: "ignored",
          selectedRepos: [],
          syncReport: [],
          synthesis: {
            text: "done"
          }
        }
      })),
      subscribe: vi.fn((_jobId, callback) => {
        listenerRef.current = callback;
        return unsubscribe;
      })
    });
    const request = createManualRequest({
      method: "GET",
      path: "/jobs/job-1/events"
    });
    const response = createMockResponse();
    const originalWrite = response.write.bind(response);
    response.write = vi.fn(chunk => {
      const text = chunk.toString("utf8");
      const result = originalWrite(chunk);

      if (text.startsWith("event: completed")) {
        response.destroyed = true;
      }

      return result;
    });
    void createHttpHandler({ jobManager })(request, response);

    if (listenerRef.current) {
      listenerRef.current({
        sequence: 2,
        type: "completed",
        message: "done",
        timestamp: "2026-04-03T00:00:01.000Z"
      });
    }

    expect(unsubscribe).toHaveBeenCalled();
    expect(response.body).toContain("event: completed");
  });

  it("does not parse truncated bodies after the request was already rejected for size", async () => {
    const parseSpy = vi.spyOn(JSON, "parse");
    const jobManager = createHttpJobManager();
    const handler = createHttpHandler({
      bodyLimitBytes: 5,
      jobManager
    });
    const request = createManualRequest({
      method: "POST",
      path: "/ask"
    });
    const response = createMockResponse();
    const completed = new Promise((resolve, reject) => {
      response.on("finish", resolve);
      response.on("error", reject);
    });

    void handler(request, response);
    request.emit("data", Buffer.from("123456"));
    request.emit("end");

    await completed;

    expect(response.statusCode).toBe(413);
    expect(jobManager.createJob).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();

    parseSpy.mockRestore();
  });
});

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) {
      return;
    }

    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error("Condition not met in time.");
}

async function collectSseEvents(response: MockResponse, untilType: string): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  let buffer = "";

  return await new Promise<SseEvent[]>((resolve, reject) => {
    response.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");

      let delimiterIndex = buffer.indexOf("\n\n");
      while (delimiterIndex >= 0) {
        const rawEvent = buffer.slice(0, delimiterIndex);
        buffer = buffer.slice(delimiterIndex + 2);

        const event = parseSseEvent(rawEvent);
        if (event) {
          events.push(event);
          if (event.type === untilType) {
            resolve(events);
            return;
          }
        }

        delimiterIndex = buffer.indexOf("\n\n");
      }
    });

    response.on("end", () => {
      resolve(events);
    });
    response.on("error", reject);
  });
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

  if (!data) {
    return null;
  }

  return {
    type,
    data: JSON.parse(data) as Record<string, unknown>
  };
}

function parseSseStreamBody(body: string): SseEvent[] {
  return body
    .split("\n\n")
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(parseSseEvent)
    .filter((event): event is SseEvent => event !== null);
}

async function performRequest(handler: HttpHandler, options: HandlerRequestOptions): Promise<MockResponse> {
  const exchange = startRequest(handler, options);
  await exchange.completed;
  return exchange.response;
}

function startRequest(
  handler: HttpHandler,
  { method, path, headers = {}, body, rawBody, skipAutoEndWrite = false }: HandlerRequestOptions
): {
  request: MockRequest;
  response: MockResponse;
  completed: Promise<void>;
} {
  const request = new PassThrough() as MockRequest;
  request.method = method;
  request.url = path;
  request.headers = headers;
  request.destroyed = false;

  const response = createMockResponse();
  const completed = new Promise<void>((resolve, reject) => {
    response.on("finish", () => {
      resolve();
    });
    response.on("error", reject);
  });

  void handler(request, response);

  queueMicrotask(() => {
    if (rawBody != null) {
      request.write(rawBody);
    } else if (body != null) {
      request.write(JSON.stringify(body));
    }

    if (!skipAutoEndWrite) {
      request.end();
      return;
    }

    request.end("");
  });

  return {
    request,
    response,
    completed
  };
}

function createMockResponse(): MockResponse {
  const response = new PassThrough() as MockResponse;

  response.statusCode = 200;
  response.headers = {};
  response.body = "";
  response.setHeader = (name: string, value: string) => {
    response.headers[name.toLowerCase()] = value;
  };
  response.writeHead = (statusCode: number, headers: Record<string, string> = {}) => {
    response.statusCode = statusCode;

    for (const [name, value] of Object.entries(headers)) {
      response.setHeader(name, value);
    }

    return response;
  };

  response.on("data", (chunk: Buffer) => {
    response.body += chunk.toString("utf8");
  });
  response.on("finish", () => {
    response.emit("close");
  });
  response.destroyed = false;

  return response;
}

function createManualRequest({
  method,
  path,
  headers = {}
}: Pick<HandlerRequestOptions, "method" | "path" | "headers">): ManualRequest {
  const handlers = {
    data: [] as Array<(chunk: Buffer) => void>,
    end: [] as Array<() => void>,
    error: [] as Array<(error: Error) => void>
  };

  return {
    method,
    url: path,
    headers,
    destroyed: false,
    on(event, handler) {
      handlers[event].push(handler as never);
      return this;
    },
    destroy() {
      this.destroyed = true;
    },
    emit(event, ...args) {
      if (event === "data") {
        for (const handler of handlers.data) {
          handler(args[0] as Buffer);
        }
        return;
      }

      if (event === "error") {
        for (const handler of handlers.error) {
          handler(args[0] as Error);
        }
        return;
      }

      for (const handler of handlers.end) {
        handler();
      }
    }
  };
}

async function performManualRequest(
  handler: HttpHandler,
  emitEvents: (request: ManualRequest) => void
): Promise<MockResponse> {
  const request = createManualRequest({
    method: "POST",
    path: "/ask"
  });
  const response = createMockResponse();
  const completed = new Promise<void>((resolve, reject) => {
    response.on("finish", resolve);
    response.on("error", reject);
  });

  void handler(request, response);
  emitEvents(request);
  await completed;

  return response;
}

function createValidationHandler(bodyLimitBytes: number): HttpHandler {
  const manager = createAskJobManager({
    answerQuestionFn: async () => ({
      mode: "answer",
      question: "ignored",
      selectedRepos: [],
      syncReport: [],
      synthesis: {
        text: "ignored"
      }
    }),
    jobRetentionMs: 60_000
  });
  managers.push(manager);

  return createHttpHandler({
    bodyLimitBytes,
    jobManager: manager
  });
}

function createHttpJobManager(overrides: Partial<HttpJobManager> = {}): HttpJobManager {
  return {
    createJob: vi.fn(() => {
      throw new Error("createJob was not configured.");
    }),
    getJob: vi.fn(() => null),
    subscribe: vi.fn(() => null),
    ...overrides
  };
}

function createJobSnapshot(overrides: Partial<AskJobSnapshot> = {}): AskJobSnapshot {
  return {
    id: "job-1",
    status: "running",
    request: {
      question: "ignored",
      repoNames: null,
      audience: "general",
      model: null,
      reasoningEffort: null,
      noSync: false,
      noSynthesis: false
    },
    createdAt: "2026-04-03T00:00:00.000Z",
    startedAt: "2026-04-03T00:00:00.000Z",
    finishedAt: null,
    error: null,
    result: null,
    events: [],
    ...overrides
  };
}

function getRequiredStatusReporter(execution: Parameters<AnswerQuestionFn>[1]): { info(message: string): void } {
  const reporter = (
    execution
    && typeof execution === "object"
    && "statusReporter" in execution
    && execution.statusReporter
    && typeof execution.statusReporter === "object"
    && "info" in execution.statusReporter
  )
    ? execution.statusReporter
    : null;
  if (!reporter) {
    throw new Error("Expected a status reporter in test execution context.");
  }

  return reporter as { info(message: string): void };
}
