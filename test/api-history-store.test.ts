import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createApiHistoryStore } from "../src/server/api-history-store.ts";

const tempDirs: string[] = [];

describe("api history store", () => {
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("caps a conversation at 24 interaction items plus one limit status", async () => {
    const historyPath = await createTempHistoryPath();
    const store = createApiHistoryStore({ historyPath, now: createClock() });

    for (let index = 1; index <= 30; index += 1) {
      await store.recordQuestion({
        conversationKey: "thread-1",
        interactionUser: "slack:T123:U123",
        jobId: `job-${index}`,
        question: `question-${index}`,
        attachments: []
      });
    }

    const history = await readHistory(historyPath);
    expect(history.conversations).toHaveLength(1);
    expect(history.conversations[0]?.items).toHaveLength(25);
    expect(history.conversations[0]?.items.at(23)).toMatchObject({
      type: "question",
      text: "question-24"
    });
    expect(history.conversations[0]?.items.at(24)).toMatchObject({
      type: "limit",
      message: "Conversation history limit reached. Start a new conversation to keep asking questions."
    });
  });

  it("keeps only the newest 500 conversations", async () => {
    const historyPath = await createTempHistoryPath();
    const store = createApiHistoryStore({ historyPath, now: createClock() });

    for (let index = 1; index <= 505; index += 1) {
      await store.recordQuestion({
        conversationKey: `thread-${index}`,
        interactionUser: "slack:T123:U123",
        jobId: `job-${index}`,
        question: `question-${index}`,
        attachments: []
      });
    }

    const history = await readHistory(historyPath);
    expect(history.conversations).toHaveLength(500);
    expect(history.conversations[0]?.conversationKey).toBe("thread-6");
    expect(history.conversations.at(-1)?.conversationKey).toBe("thread-505");
  });

  it("records completed answer snapshots without attachment contents", async () => {
    const historyPath = await createTempHistoryPath();
    const store = createApiHistoryStore({ historyPath, now: createClock() });

    await store.recordQuestion({
      conversationKey: "thread-answer",
      interactionUser: "slack:T123:U123",
      jobId: "job-answer",
      question: "question",
      attachments: [
        {
          name: "requirements.txt",
          mediaType: "text/plain",
          contentBase64: "aGVsbG8="
        }
      ]
    });
    await store.recordJobSnapshot({
      conversationKey: "thread-answer",
      interactionUser: "slack:T123:U123",
      job: {
        id: "job-answer",
        status: "completed",
        request: {
          question: "question",
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
        startedAt: "2026-04-26T12:00:01.000Z",
        finishedAt: "2026-04-26T12:00:02.000Z",
        error: null,
        result: {
          mode: "answer",
          question: "question",
          selectedRepos: [],
          syncReport: [],
          synthesis: {
            text: "answer text"
          }
        },
        events: []
      }
    });

    const history = await readHistory(historyPath);
    expect(history.conversations[0]?.items).toMatchObject([
      {
        type: "question",
        attachments: [
          {
            name: "requirements.txt",
            mediaType: "text/plain",
            bytes: 5
          }
        ]
      },
      {
        type: "answer",
        jobId: "job-answer",
        text: "answer text"
      }
    ]);
    expect(JSON.stringify(history)).not.toContain("aGVsbG8=");
  });
});

async function createTempHistoryPath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atc-history-store-"));
  tempDirs.push(dir);
  return path.join(dir, "history.json");
}

async function readHistory(historyPath: string): Promise<{
  conversations: Array<{
    conversationKey: string;
    items: Array<Record<string, unknown>>;
  }>;
}> {
  const content = await readFile(historyPath, "utf8");
  return JSON.parse(content) as {
    conversations: Array<{
      conversationKey: string;
      items: Array<Record<string, unknown>>;
    }>;
  };
}

function createClock(): () => Date {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 3, 26, 12, 0, tick));
  };
}
