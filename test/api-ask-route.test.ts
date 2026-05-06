import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AskJobSnapshot } from "../src/core/types.ts";
import { createApp } from "../src/server/app.ts";
import type { ServerJobManager } from "../src/server/routes/api-helpers.ts";
import { createLoadedConfig } from "./test-helpers.ts";

type HttpJobManager = ServerJobManager;

const tempDirs: string[] = [];

describe("api ask route", () => {
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("rejects API ask requests without a bearer token", async () => {
    const jobManager = createHttpJobManager();
    const app = createTestApp({
      env: {
        ATC_API_TOKEN: "api-token",
        ATC_API_SIGNING_SECRET: "signing-secret"
      },
      jobManager
    });

    const response = await app.fetch(createApiAskRequest({
      token: null,
      signingSecret: "signing-secret",
      body: { question: "How does this work?" }
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "API ask requires a valid bearer token."
    });
    expect(jobManager.createJob).not.toHaveBeenCalled();
  });

  it("returns parent JSON errors for API ask sub-app validation failures", async () => {
    const jobManager = createHttpJobManager();
    const app = createTestApp({
      env: {
        ATC_API_TOKEN: "api-token",
        ATC_API_SIGNING_SECRET: "signing-secret"
      },
      jobManager
    });

    const response = await app.fetch(createApiAskRequest({
      body: {
        question: "Summarize this repo",
        attachments: "not-an-array"
      }
    }));

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: '"attachments" must be an array when provided.'
    });
    expect(jobManager.createJob).not.toHaveBeenCalled();
  });

  it("rejects API ask requests with an invalid interaction signature", async () => {
    const jobManager = createHttpJobManager();
    const app = createTestApp({
      env: {
        ATC_API_TOKEN: "api-token",
        ATC_API_SIGNING_SECRET: "signing-secret"
      },
      jobManager
    });

    const request = createApiAskRequest({
      token: "api-token",
      signingSecret: "wrong-secret",
      body: { question: "How does this work?" }
    });
    const response = await app.fetch(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid API interaction signature."
    });
    expect(jobManager.createJob).not.toHaveBeenCalled();
  });

  it("creates API ask jobs with simple-mode defaults and records question history", async () => {
    const historyPath = await createTempHistoryPath();
    const jobManager = createHttpJobManager({
      createJob: vi.fn(() => createJobSnapshot({ id: "api-job-1" }))
    });
    const app = createTestApp({
      env: createApiEnv({ ATC_HISTORY_PATH: historyPath }),
      jobManager
    });

    const response = await app.fetch(createApiAskRequest({
      body: {
        question: "Summarize this repo",
        attachments: [
          {
            name: "note.txt",
            mediaType: "text/plain",
            contentBase64: "aGVsbG8="
          }
        ]
      }
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      jobId: "api-job-1",
      status: "running",
      interactionUser: "slack:T123:U123",
      conversationKey: "slack:T123:C123:171234.000001"
    });
    expect(jobManager.createJob).toHaveBeenCalledWith({
      question: "Summarize this repo",
      attachments: [
        {
          name: "note.txt",
          mediaType: "text/plain",
          contentBase64: "aGVsbG8="
        }
      ]
    });
    await expect(readHistoryJson(historyPath)).resolves.toMatchObject({
      conversations: [
        {
          conversationKey: "slack:T123:C123:171234.000001",
          interactionUser: "slack:T123:U123",
          items: [
            {
              type: "question",
              jobId: "api-job-1",
              text: "Summarize this repo",
              attachments: [
                {
                  name: "note.txt",
                  mediaType: "text/plain",
                  bytes: 5
                }
              ]
            }
          ]
        }
      ]
    });
  });

  it("rejects API ask requests that include advanced-only fields", async () => {
    const jobManager = createHttpJobManager();
    const app = createTestApp({
      env: createApiEnv(),
      jobManager
    });

    const response = await app.fetch(createApiAskRequest({
      body: {
        question: "Summarize this repo",
        model: "gpt-5.4",
        noSync: true
      }
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'API ask only accepts "question" and "attachments". Remove: model, noSync.'
    });
    expect(jobManager.createJob).not.toHaveBeenCalled();
  });

  it("returns API conversation history for the signed caller", async () => {
    const historyPath = await createTempHistoryPath();
    const jobManager = createHttpJobManager({
      createJob: vi.fn(() => createJobSnapshot({ id: "api-job-history" }))
    });
    const app = createTestApp({
      env: createApiEnv({ ATC_HISTORY_PATH: historyPath }),
      jobManager
    });

    await app.fetch(createApiAskRequest({
      body: {
        question: "Keep this question"
      }
    }));
    const response = await app.fetch(createApiHistoryRequest({
      conversationKey: "slack:T123:C123:171234.000001"
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      conversation: {
        conversationKey: "slack:T123:C123:171234.000001",
        interactionUser: "slack:T123:U123",
        items: [
          {
            type: "question",
            jobId: "api-job-history",
            text: "Keep this question"
          }
        ]
      }
    });
  });

  it("records one terminal snapshot when a job finishes during history subscription", async () => {
    const historyPath = await createTempHistoryPath();
    const completedJob = createJobSnapshot({
      id: "api-job-completed",
      status: "completed",
      finishedAt: "2026-04-26T12:00:01.000Z",
      result: {
        mode: "answer",
        question: "Keep one answer",
        selectedRepos: [],
        syncReport: [],
        synthesis: {
          text: "one answer"
        }
      }
    });
    const jobManager = createHttpJobManager({
      createJob: vi.fn(() => completedJob),
      getJob: vi.fn(() => completedJob),
      subscribe: vi.fn((_jobId, listener) => {
        listener({
          type: "completed",
          job: completedJob
        });
        return vi.fn();
      })
    });
    const app = createTestApp({
      env: createApiEnv({ ATC_HISTORY_PATH: historyPath }),
      jobManager
    });

    const askResponse = await app.fetch(createApiAskRequest({
      body: {
        question: "Keep one answer"
      }
    }));
    expect(askResponse.status).toBe(202);
    const historyResponse = await app.fetch(createApiHistoryRequest({
      conversationKey: "slack:T123:C123:171234.000001"
    }));

    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json() as {
      conversation: {
        items: Array<{ type: string }>;
      };
    };
    expect(history.conversation.items.filter(item => item.type === "answer")).toHaveLength(1);
  });

  it("rejects API asks after the conversation history limit is reached", async () => {
    const historyPath = await createTempHistoryPath();
    let jobIndex = 0;
    const jobManager = createHttpJobManager({
      createJob: vi.fn(() => {
        jobIndex += 1;
        return createJobSnapshot({ id: `api-job-${jobIndex}` });
      })
    });
    const app = createTestApp({
      env: createApiEnv({ ATC_HISTORY_PATH: historyPath }),
      jobManager
    });

    for (let index = 1; index <= 24; index += 1) {
      const response = await app.fetch(createApiAskRequest({
        body: {
          question: `Question ${index}`
        }
      }));
      expect(response.status).toBe(202);
    }

    const limitResponse = await app.fetch(createApiAskRequest({
      body: {
        question: "Question 25"
      }
    }));

    expect(limitResponse.status).toBe(409);
    await expect(limitResponse.json()).resolves.toEqual({
      error: "Conversation history limit reached. Start a new conversation to keep asking questions."
    });
    expect(jobManager.createJob).toHaveBeenCalledTimes(24);
    await expect(readHistoryJson(historyPath)).resolves.toMatchObject({
      conversations: [
        {
          items: [
            ...Array.from({ length: 24 }, (_, index) => ({
              type: "question",
              text: `Question ${index + 1}`
            })),
            {
              type: "limit",
              message: "Conversation history limit reached. Start a new conversation to keep asking questions."
            }
          ]
        }
      ]
    });
  });
});

async function createTempHistoryPath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atc-api-history-"));
  tempDirs.push(dir);
  return path.join(dir, "history.json");
}

async function readHistoryJson(historyPath: string): Promise<unknown> {
  const content = await readFile(historyPath, "utf8");
  return JSON.parse(content) as unknown;
}

function createTestApp({
  env,
  jobManager
}: {
  env: Record<string, string | undefined>;
  jobManager: HttpJobManager;
}): ReturnType<typeof createApp> {
  return createApp({
    bodyLimitBytes: 65_536,
    env,
    jobManager,
    loadConfigFn: async () => createLoadedConfig({ repos: [] })
  });
}

function createApiAskRequest({
  body,
  token = "api-token",
  signingSecret = "signing-secret",
  interactionUser = "slack:T123:U123",
  conversationKey = "slack:T123:C123:171234.000001",
  timestamp = new Date().toISOString()
}: {
  body: unknown;
  token?: string | null;
  signingSecret?: string;
  interactionUser?: string;
  conversationKey?: string;
  timestamp?: string;
}): Request {
  const bodyText = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-atc-interaction-user": interactionUser,
    "x-atc-conversation-key": conversationKey,
    "x-atc-interaction-timestamp": timestamp,
    "x-atc-interaction-signature": signInteraction({
      body: bodyText,
      conversationKey,
      interactionUser,
      signingSecret,
      timestamp
    })
  };
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }

  return new Request("http://localhost/api/v1/ask", {
    method: "POST",
    headers,
    body: bodyText
  });
}

function createApiHistoryRequest({
  token = "api-token",
  signingSecret = "signing-secret",
  interactionUser = "slack:T123:U123",
  conversationKey,
  timestamp = new Date().toISOString()
}: {
  token?: string | null;
  signingSecret?: string;
  interactionUser?: string;
  conversationKey: string;
  timestamp?: string;
}): Request {
  const bodyText = "";
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "x-atc-interaction-user": interactionUser,
    "x-atc-conversation-key": conversationKey,
    "x-atc-interaction-timestamp": timestamp,
    "x-atc-interaction-signature": signInteraction({
      body: bodyText,
      conversationKey,
      interactionUser,
      signingSecret,
      timestamp
    })
  };

  return new Request(`http://localhost/api/v1/history?conversationKey=${encodeURIComponent(conversationKey)}`, {
    method: "GET",
    headers
  });
}

function signInteraction({
  body,
  conversationKey,
  interactionUser,
  signingSecret,
  timestamp
}: {
  body: string;
  conversationKey: string;
  interactionUser: string;
  signingSecret: string;
  timestamp: string;
}): string {
  return createHmac("sha256", signingSecret)
    .update(`${timestamp}\n${interactionUser}\n${conversationKey}\n${body}`)
    .digest("hex");
}

function createApiEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ATC_API_TOKEN: "api-token",
    ATC_API_SIGNING_SECRET: "signing-secret",
    ...overrides
  };
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
    id: "api-job",
    status: "running",
    request: {
      question: "ignored",
      attachments: [],
      repoNames: null,
      audience: "general",
      model: null,
      reasoningEffort: null,
      selectionMode: null,
      selectionShadowCompare: false,
      noSync: false,
      noSynthesis: false
    },
    createdAt: "2026-04-26T12:00:00.000Z",
    startedAt: "2026-04-26T12:00:00.000Z",
    finishedAt: null,
    error: null,
    result: null,
    events: [],
    ...overrides
  };
}
