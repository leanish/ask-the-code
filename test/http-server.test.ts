import { EventEmitter } from "node:events";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAskJobManager } from "../src/core/jobs/ask-job-manager.ts";
import type { AnswerQuestionFn, AskJobEvent, AskJobSnapshot } from "../src/core/types.ts";
import { createApp } from "../src/server/app.ts";
import { readJsonBody, type ServerJobManager } from "../src/server/routes/api-helpers.ts";
import { createSessionCookieValue } from "../src/server/routes/auth.ts";
import { createLoadedConfig, createManagedRepo } from "./test-helpers.ts";

type HttpApp = ReturnType<typeof createHttpApp>;
type HttpJobManager = ServerJobManager;
type HandlerRequestOptions = {
  method: string;
  path: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  skipAutoEndWrite?: boolean;
};
type MockResponse = EventEmitter & {
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
  afterEach(async () => {
    vi.useRealTimers();
    while (managers.length > 0) {
      managers.pop()?.close();
    }
  });

  it("creates async ask jobs and exposes them over HTTP", async () => {
    const manager = createAskJobManager({
      answerQuestionFn: async ({ question, attachments }, execution) => {
        const statusReporter = getRequiredStatusReporter(execution);
        statusReporter.info("selected repos");
        expect(attachments).toEqual([
          {
            name: "requirements.txt",
            mediaType: "text/plain",
            contentBase64: "aGVsbG8="
          }
        ]);

        return {
          mode: "answer",
          question,
          selectedRepos: [{ name: "ask-the-code" }],
          syncReport: [{ name: "ask-the-code", action: "skipped" }],
          synthesis: {
            text: "Final answer"
          }
        };
      },
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const handler = createHttpApp({ jobManager: manager });

    const createResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "How does ask-the-code work?",
        repoNames: ["ask-the-code"],
        audience: "codebase",
        attachments: [
          {
            name: "requirements.txt",
            mediaType: "text/plain",
            contentBase64: "aGVsbG8="
          }
        ],
        noSync: true
      }
    });
    const createdJob = JSON.parse(createResponse.body);

    expect(createResponse.statusCode).toBe(202);
    expect(["queued", "running"]).toContain(createdJob.status);
    expect(createdJob.links.self).toBe(`/jobs/${createdJob.id}`);
    expect(createdJob.request.audience).toBe("codebase");
    expect(createdJob.request.attachments).toEqual([
      {
        name: "requirements.txt",
        mediaType: "text/plain",
        contentBase64: "aGVsbG8="
      }
    ]);

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

  it("stores multipart ask attachments as temporary files for the job", async () => {
    let attachmentPath = "";
    const manager = createAskJobManager({
      answerQuestionFn: async ({ attachments = [] }) => {
        expect(attachments).toHaveLength(1);
        const [attachment] = attachments;
        expect(attachment).toMatchObject({
          name: "requirements.txt",
          mediaType: "text/plain",
          size: 23
        });
        if (!attachment || !("path" in attachment)) {
          throw new Error("Expected multipart upload to create an attachment file reference.");
        }
        attachmentPath = attachment.path;
        expect(await readFile(attachment.path, "utf8")).toBe("Need temp file uploads.");

        return {
          mode: "answer",
          question: "Use the uploaded file.",
          selectedRepos: [{ name: "ask-the-code" }],
          syncReport: [{ name: "ask-the-code", action: "skipped" }],
          synthesis: {
            text: "Final answer"
          }
        };
      },
      jobRetentionMs: 60_000
    });
    managers.push(manager);
    const handler = createHttpApp({ jobManager: manager });
    const form = new FormData();
    form.set("payload", JSON.stringify({
      question: "Use the uploaded file.",
      repoNames: ["ask-the-code"],
      noSync: true
    }));
    form.set("file_0", new File(["Need temp file uploads."], "requirements.txt", { type: "text/plain" }));

    const createResponse = await handler.fetch(new Request("http://atc.local/ask", {
      body: form,
      method: "POST"
    }));
    const createdJob = await createResponse.json() as { links: { self: string } };

    expect(createResponse.status).toBe(202);
    await waitFor(async () => {
      const jobResponse = await handler.fetch(new Request(`http://atc.local${createdJob.links.self}`));
      const job = await jobResponse.json() as { status: string };
      return job.status === "completed";
    });
    await waitFor(async () => {
      try {
        await readFile(attachmentPath, "utf8");
        return false;
      } catch {
        return true;
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
    const handler = createHttpApp({ jobManager: manager });

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
      path: "/api/v1/ask"
    });
    const cookieAskOptionsResponse = await performRequest(handler, {
      method: "OPTIONS",
      path: "/ask"
    });

    expect(indexResponse.statusCode).toBe(200);
    expect(indexResponse.headers["content-type"]).toContain("text/html");
    expect(indexResponse.body).toContain("ask-the-code");
    expect(healthResponse.statusCode).toBe(200);
    expect(JSON.parse(healthResponse.body)).toEqual({
      status: "ok",
      jobs: { queued: 0, running: 0, completed: 0, failed: 0 }
    });
    expect(optionsResponse.statusCode).toBe(204);
    expect(optionsResponse.headers["access-control-allow-methods"]).toContain("POST");
    expect(cookieAskOptionsResponse.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects malformed ask attachments before creating a job", async () => {
    const handler = createValidationHandler(1_000_000);

    const response = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "Use this file",
        attachments: [
          {
            name: "empty.txt",
            mediaType: "text/plain",
            contentBase64: ""
          }
        ]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('"attachments[0].contentBase64" must be a non-empty base64 string.');
  });

  it("rejects ask jobs from unauthenticated users when GitHub SSO is configured", async () => {
    const jobManager = createHttpJobManager();
    const handler = createHttpApp({
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret"
      },
      jobManager
    });

    const response = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "How does auth work?"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: "Sign in with GitHub before asking a question."
    });
    expect(jobManager.createJob).not.toHaveBeenCalled();
  });

  it("accepts ask jobs from authenticated users when GitHub SSO is configured", async () => {
    const jobManager = createHttpJobManager({
      createJob: vi.fn(() => createJobSnapshot({
        id: "job-authenticated",
        request: {
          question: "How does auth work?",
          repoNames: null,
          model: null,
          reasoningEffort: null,
          noSync: false,
          noSynthesis: false
        }
      }))
    });
    const handler = createHttpApp({
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret"
      },
      jobManager
    });
    const sessionCookie = createSessionCookieValue({
      email: "user@example.com",
      name: "User Example",
      picture: null
    }, "test-secret");

    const response = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      headers: {
        cookie: `atc_session=${encodeURIComponent(sessionCookie)}`
      },
      body: {
        question: "How does auth work?"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(jobManager.createJob).toHaveBeenCalledWith(expect.objectContaining({
      question: "How does auth work?"
    }));
  });

  it("exposes GitHub SSO session and start endpoints", async () => {
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
    const handler = createHttpApp({
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret"
      },
      jobManager: manager
    });

    const sessionResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/session"
    });
    const startResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/github/start"
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(JSON.parse(sessionResponse.body)).toEqual({
      authenticated: false,
      githubConfigured: true,
      user: null
    });
    expect(startResponse.statusCode).toBe(302);
    expect(startResponse.headers.location).toContain("https://github.com/login/oauth/authorize");
    expect(startResponse.headers.location).toContain("client_id=client-id");
    expect(startResponse.headers["set-cookie"]).toContain("atc_oauth_state=");
  });

  it("moves GitHub SSO start to the configured redirect origin before setting state", async () => {
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
    const handler = createHttpApp({
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret",
        ATC_GITHUB_REDIRECT_URI: "http://localhost:8787/auth/github/callback"
      },
      jobManager: manager
    });

    const hostSwitchResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/github/start",
      url: "http://127.0.0.1:8787/auth/github/start"
    });
    const canonicalStartResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/github/start",
      url: "http://localhost:8787/auth/github/start"
    });

    expect(hostSwitchResponse.statusCode).toBe(302);
    expect(hostSwitchResponse.headers.location).toBe("http://localhost:8787/auth/github/start");
    expect(hostSwitchResponse.headers["set-cookie"]).toBeUndefined();
    expect(canonicalStartResponse.statusCode).toBe(302);
    expect(canonicalStartResponse.headers.location).toContain("https://github.com/login/oauth/authorize");
    expect(canonicalStartResponse.headers.location).toContain(
      `redirect_uri=${encodeURIComponent("http://localhost:8787/auth/github/callback")}`
    );
    expect(canonicalStartResponse.headers["set-cookie"]).toContain("atc_oauth_state=");
  });

  it("moves GitHub SSO start to HTTPS before setting state when the redirect URI is HTTPS", async () => {
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
    const handler = createHttpApp({
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret",
        ATC_GITHUB_REDIRECT_URI: "https://atc.example/auth/github/callback"
      },
      jobManager: manager
    });

    const startResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/github/start"
    });

    expect(startResponse.headers.location).toBe("https://atc.example/auth/github/start");
    expect(startResponse.headers["set-cookie"]).toBeUndefined();
  });

  it("marks GitHub SSO cookies secure when the current request is HTTPS", async () => {
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
    const handler = createHttpApp({
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret"
      },
      jobManager: manager
    });

    const startResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/github/start",
      url: "https://atc.example/auth/github/start"
    });

    expect(startResponse.headers["set-cookie"]).toContain("Secure");
  });

  it("returns the signed GitHub SSO session user", async () => {
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
    const handler = createHttpApp({
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret"
      },
      jobManager: manager
    });
    const sessionCookie = createSessionCookieValue({
      email: "user@example.com",
      name: "User Example",
      picture: "https://example.com/user.png"
    }, "test-secret");

    const sessionResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/session",
      headers: {
        cookie: `atc_session=${encodeURIComponent(sessionCookie)}`
      }
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(JSON.parse(sessionResponse.body)).toEqual({
      authenticated: true,
      githubConfigured: true,
      user: {
        email: "user@example.com",
        name: "User Example",
        picture: "https://example.com/user.png"
      }
    });
  });

  it("refreshes signed GitHub SSO sessions on session reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00.000Z"));
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
    const handler = createHttpApp({
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret"
      },
      jobManager: manager
    });
    const sessionCookie = createSessionCookieValue({
      email: "user@example.com",
      name: "User Example",
      picture: "https://example.com/user.png"
    }, "test-secret");
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));

    const sessionResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/session",
      headers: {
        cookie: `atc_session=${encodeURIComponent(sessionCookie)}`
      }
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.headers["set-cookie"]).toContain("atc_session=");
    const refreshedCookie = readSetCookieValue(sessionResponse.headers["set-cookie"], "atc_session");
    expect(readSessionExpiry(refreshedCookie)).toBe(Math.floor(new Date("2026-05-02T00:00:00.000Z").getTime() / 1000));
  });

  it("matches refreshed session cookie security to the request URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00.000Z"));
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
    const handler = createHttpApp({
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret"
      },
      jobManager: manager
    });
    const sessionCookie = createSessionCookieValue({
      email: "user@example.com",
      name: "User Example",
      picture: null
    }, "test-secret");

    const httpResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/session",
      headers: {
        cookie: `atc_session=${encodeURIComponent(sessionCookie)}`
      }
    });
    const httpsResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/session",
      headers: {
        cookie: `atc_session=${encodeURIComponent(sessionCookie)}`
      },
      url: "https://atc.example/auth/session"
    });

    expect(httpResponse.headers["set-cookie"]).not.toContain("Secure");
    expect(httpsResponse.headers["set-cookie"]).toContain("Secure");
  });

  it("refreshes signed GitHub SSO sessions when creating ask jobs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00.000Z"));
    const jobManager = createHttpJobManager({
      createJob: vi.fn(() => createJobSnapshot({
        id: "job-authenticated",
        request: {
          question: "How does auth work?",
          repoNames: null,
          model: null,
          reasoningEffort: null,
          noSync: false,
          noSynthesis: false
        }
      }))
    });
    const handler = createHttpApp({
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret"
      },
      jobManager
    });
    const sessionCookie = createSessionCookieValue({
      email: "user@example.com",
      name: "User Example",
      picture: null
    }, "test-secret");
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));

    const response = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      headers: {
        cookie: `atc_session=${encodeURIComponent(sessionCookie)}`
      },
      body: {
        question: "How does auth work?"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["set-cookie"]).toContain("atc_session=");
    const refreshedCookie = readSetCookieValue(response.headers["set-cookie"], "atc_session");
    expect(readSessionExpiry(refreshedCookie)).toBe(Math.floor(new Date("2026-05-02T00:00:00.000Z").getTime() / 1000));
  });

  it("rejects legacy signed GitHub SSO session cookies without an expiry", async () => {
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
    const handler = createHttpApp({
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret"
      },
      jobManager: manager
    });
    const payload = Buffer.from(JSON.stringify({
      email: "user@example.com",
      name: "User Example",
      picture: "https://example.com/user.png"
    }), "utf8").toString("base64url");
    const signature = createHmac("sha256", "test-secret").update(payload).digest("base64url");

    const sessionResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/session",
      headers: {
        cookie: `atc_session=${encodeURIComponent(`${payload}.${signature}`)}`
      }
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(JSON.parse(sessionResponse.body)).toEqual({
      authenticated: false,
      githubConfigured: true,
      user: null
    });
  });

  it("rejects a signed GitHub SSO callback state when the state cookie is missing", async () => {
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
    const authFetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "access-token" });
      }
      if (url === "https://api.github.com/user") {
        return Response.json({
          login: "octocat",
          name: "Octo Cat",
          avatar_url: "https://github.com/images/error/octocat_happy.gif"
        });
      }
      if (url === "https://api.github.com/user/emails") {
        return Response.json([
          {
            email: "octocat@example.com",
            primary: true,
            verified: true
          }
        ]);
      }
      return Response.json({ error: "unexpected URL" }, { status: 500 });
    });
    const handler = createHttpApp({
      authFetchFn,
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret"
      },
      jobManager: manager
    });
    const startResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/github/start"
    });
    const location = startResponse.headers.location;
    if (!location) {
      throw new Error("GitHub SSO start response did not include a redirect location.");
    }
    const state = new URL(location).searchParams.get("state");

    const callbackResponse = await performRequest(handler, {
      method: "GET",
      path: `/auth/github/callback?code=code-123&state=${encodeURIComponent(state ?? "")}`
    });

    expect(callbackResponse.statusCode).toBe(400);
    expect(JSON.parse(callbackResponse.body)).toEqual({
      error: "Invalid GitHub SSO state."
    });
    expect(authFetchFn).not.toHaveBeenCalled();
  });

  it("accepts a GitHub SSO callback state when it matches the state cookie", async () => {
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
    const authFetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "access-token" });
      }
      if (url === "https://api.github.com/user") {
        return Response.json({
          login: "octocat",
          name: "Octo Cat",
          avatar_url: "https://github.com/images/error/octocat_happy.gif"
        });
      }
      if (url === "https://api.github.com/user/emails") {
        return Response.json([
          {
            email: "octocat@example.com",
            primary: true,
            verified: true
          }
        ]);
      }
      return Response.json({ error: "unexpected URL" }, { status: 500 });
    });
    const handler = createHttpApp({
      authFetchFn,
      env: {
        ATC_AUTH_SECRET: "test-secret",
        ATC_GITHUB_CLIENT_ID: "client-id",
        ATC_GITHUB_CLIENT_SECRET: "client-secret"
      },
      jobManager: manager
    });
    const startResponse = await performRequest(handler, {
      method: "GET",
      path: "/auth/github/start"
    });
    const location = startResponse.headers.location;
    if (!location) {
      throw new Error("GitHub SSO start response did not include a redirect location.");
    }
    const state = new URL(location).searchParams.get("state");

    const callbackResponse = await performRequest(handler, {
      method: "GET",
      path: `/auth/github/callback?code=code-123&state=${encodeURIComponent(state ?? "")}`,
      headers: {
        cookie: String(startResponse.headers["set-cookie"]).split(";")[0] ?? ""
      }
    });

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toBe("/");
    expect(callbackResponse.headers["set-cookie"]).toContain("atc_session=");
    expect(authFetchFn).toHaveBeenCalledWith("https://github.com/login/oauth/access_token", expect.any(Object));
  });

  it("returns ok health even when a custom job manager does not expose stats", async () => {
    const handler = createHttpApp({
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
    const handler = createHttpApp({ jobManager: manager });

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
    const handler = createHttpApp({
      jobManager: manager,
      loadConfigFn: async () => createLoadedConfig({
        repos: [
          createManagedRepo({
            name: "ask-the-code",
            defaultBranch: "main",
            description: "Repo-aware CLI for engineering Q&A with local Codex",
            aliases: ["self"],
            directory: "/workspace/ask-the-code"
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
          name: "ask-the-code",
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
    const handler = createHttpApp({
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
      setupHint: 'No configured repos available. Try "atc config discover-github" to discover and add repos.'
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
    const handler = createHttpApp({ jobManager: manager });

    const htmlResponse = await performRequest(handler, {
      method: "GET",
      path: "/",
      headers: { accept: "text/html,application/xhtml+xml" }
    });

    expect(htmlResponse.statusCode).toBe(200);
    expect(htmlResponse.headers["content-type"]).toContain("text/html");
    expect(htmlResponse.body).toContain("<!DOCTYPE html>");
    expect(htmlResponse.body).toContain("ask-the-code");
    expect(htmlResponse.body).toContain("/ui/assets/app.js");
    expect(htmlResponse.body).toContain("Ask a question");
    expect(htmlResponse.body).toContain("Progress");
    expect(htmlResponse.body).toContain("Drop files here or browse.");
  });

  it("serves the web UI at / when the client does not accept text/html", async () => {
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
    const handler = createHttpApp({ jobManager: manager });

    const jsonResponse = await performRequest(handler, {
      method: "GET",
      path: "/",
      headers: { accept: "application/json" }
    });

    expect(jsonResponse.statusCode).toBe(200);
    expect(jsonResponse.headers["content-type"]).toContain("text/html");
    expect(jsonResponse.body).toContain("ask-the-code");
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
    const handler = createHttpApp({ jobManager: manager });

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

    await waitFor(() => sseRequest.response.body.includes("running stream this"));
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
    expect(events.find(event => event.type === "completed")?.data).toMatchObject({
      status: "completed",
      result: {
        synthesis: {
          text: "streamed answer"
        }
      }
    });
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
    const handler = createHttpApp({ jobManager: manager });

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
    const handler = createHttpApp({ jobManager: manager });

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

  it("decodes encoded job ids in job routes", async () => {
    const getJob = vi.fn((jobId: string) => jobId === "job/with space"
      ? createJobSnapshot({ id: jobId, status: "completed" })
      : null);
    const handler = createHttpApp({
      jobManager: createHttpJobManager({
        getJob
      })
    });

    const response = await performRequest(handler, {
      method: "GET",
      path: "/jobs/job%2Fwith%20space"
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).id).toBe("job/with space");
    expect(getJob).toHaveBeenCalledWith("job/with space");
  });

  it("returns bad request for malformed encoded job ids", async () => {
    const handler = createHttpApp({
      jobManager: createHttpJobManager()
    });

    const response = await performRequest(handler, {
      method: "GET",
      path: "/jobs/%E0%A4%A"
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("Invalid job id");
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
    const handler = createHttpApp({ jobManager: manager });

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
    const handler = createHttpApp({ jobManager: manager });

    const goodResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "repo parsing",
        repoNames: "ask-the-code, self",
        audience: "codebase"
      }
    });
    const duplicateFieldResponse = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      body: {
        question: "duplicate",
        repoNames: ["ask-the-code"],
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
    expect(JSON.parse(goodResponse.body).request.repoNames).toEqual(["ask-the-code", "self"]);
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

    const response = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      rawBody: JSON.stringify({
        question: "this body is too large"
      })
    });

    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body).error).toContain("exceeds 10 bytes");
  });

  it("stops reading the request stream once the body limit is exceeded", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode("1234"),
      encoder.encode("5678"),
      encoder.encode("9012")
    ];
    let pullCount = 0;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
      pull(controller) {
        const chunk = chunks[pullCount];
        pullCount += 1;
        if (chunk) {
          controller.enqueue(chunk);
          return;
        }

        controller.close();
      }
    });
    const request = new Request("http://atc.local/ask", {
      body,
      duplex: "half",
      method: "POST"
    } as RequestInit & { duplex: "half" });

    await expect(readJsonBody(request, 5)).rejects.toThrow("exceeds 5 bytes");

    expect(pullCount).toBe(2);
    expect(canceled).toBe(true);
  });

  it("returns a 500 response for unexpected errors", async () => {
    const handler = createHttpApp({
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

  it("cleans up the SSE subscription after a terminal event", async () => {
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
    const exchange = startRequest(createHttpApp({ jobManager }), {
      method: "GET",
      path: "/jobs/job-1/events"
    });
    await waitFor(() => listenerRef.current !== null);

    if (listenerRef.current) {
      listenerRef.current({
        sequence: 2,
        type: "completed",
        message: "done",
        timestamp: "2026-04-03T00:00:01.000Z"
      });
    }

    await exchange.completed;

    expect(unsubscribe).toHaveBeenCalled();
    expect(exchange.response.body).toContain("event: completed");
  });

  it("does not parse truncated bodies after the request was already rejected for size", async () => {
    const parseSpy = vi.spyOn(JSON, "parse");
    const jobManager = createHttpJobManager();
    const handler = createHttpApp({
      bodyLimitBytes: 5,
      jobManager
    });
    const response = await performRequest(handler, {
      method: "POST",
      path: "/ask",
      rawBody: "123456"
    });

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

async function performRequest(handler: HttpApp, options: HandlerRequestOptions): Promise<MockResponse> {
  const exchange = startRequest(handler, options);
  await exchange.completed;
  return exchange.response;
}

function startRequest(
  handler: HttpApp,
  { method, path, url, headers = {}, body, rawBody, skipAutoEndWrite = false }: HandlerRequestOptions
): {
  response: MockResponse;
  completed: Promise<void>;
} {
  const response = createMockResponse();
  const requestBody = rawBody ?? (body == null ? (skipAutoEndWrite ? "" : undefined) : JSON.stringify(body));
  const requestInit: RequestInit = {
    headers,
    method
  };
  if (method !== "GET" && method !== "HEAD" && requestBody !== undefined) {
    requestInit.body = requestBody;
  }

  const completed = pumpFetchResponse(handler, new Request(url ?? `http://atc.local${path}`, requestInit), response);

  return {
    response,
    completed
  };
}

function createMockResponse(): MockResponse {
  const response = new EventEmitter() as MockResponse;
  response.statusCode = 200;
  response.headers = {};
  response.body = "";

  return response;
}

function createValidationHandler(bodyLimitBytes: number): HttpApp {
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

  return createHttpApp({
    bodyLimitBytes,
    jobManager: manager
  });
}

function createHttpApp({
  authFetchFn,
  bodyLimitBytes = 65_536,
  env = {},
  jobManager,
  loadConfigFn = async () => createLoadedConfig({ repos: [] })
}: {
  authFetchFn?: Parameters<typeof createApp>[0]["authFetchFn"];
  bodyLimitBytes?: number;
  env?: Record<string, string | undefined>;
  jobManager: HttpJobManager;
  loadConfigFn?: Parameters<typeof createApp>[0]["loadConfigFn"];
}): ReturnType<typeof createApp> {
  return createApp({
    bodyLimitBytes,
    env,
    jobManager,
    loadConfigFn,
    ...(authFetchFn === undefined ? {} : { authFetchFn })
  });
}

async function pumpFetchResponse(handler: HttpApp, request: Request, target: MockResponse): Promise<void> {
  const response = await handler.fetch(request);
  target.statusCode = response.status;
  response.headers.forEach((value, name) => {
    target.headers[name.toLowerCase()] = value;
  });
  const setCookies = getSetCookies(response.headers);
  if (setCookies.length > 0) {
    target.headers["set-cookie"] = setCookies.join("\n");
  }

  if (!response.body) {
    target.emit("finish");
    target.emit("end");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        target.emit("finish");
        target.emit("end");
        return;
      }

      const chunk = Buffer.from(value);
      target.body += decoder.decode(value, { stream: true });
      target.emit("data", chunk);
    }
  } catch (error) {
    target.emit("error", error);
    throw error;
  }
}

function getSetCookies(headers: Headers): string[] {
  const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] };
  return extendedHeaders.getSetCookie?.() ?? [];
}

function readSetCookieValue(setCookieHeader: string | undefined, name: string): string {
  const prefix = `${name}=`;
  const encodedValue = setCookieHeader
    ?.split("\n")
    .map(cookie => cookie.split(";")[0] ?? "")
    .find(cookie => cookie.startsWith(prefix))
    ?.slice(prefix.length);
  if (!encodedValue) {
    throw new Error(`Missing ${name} Set-Cookie value.`);
  }

  return decodeURIComponent(encodedValue);
}

function readSessionExpiry(sessionCookie: string): number {
  const [payload] = sessionCookie.split(".");
  if (!payload) {
    throw new Error("Missing session payload.");
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
  if (typeof parsed.exp !== "number") {
    throw new Error("Missing session expiry.");
  }

  return parsed.exp;
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
