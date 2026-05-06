import { Buffer } from "node:buffer";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { AskAttachment, AskJobSnapshot } from "../core/types.ts";

const HISTORY_VERSION = 1;
const DEFAULT_MAX_CONVERSATIONS = 500;
const DEFAULT_MAX_ITEMS_PER_CONVERSATION = 24;
export const API_HISTORY_LIMIT_REACHED_MESSAGE = "Conversation history limit reached. Start a new conversation to keep asking questions.";

export type ApiHistoryAttachment = {
  name: string;
  mediaType: string;
  bytes: number;
};

export type ApiHistoryItem =
  | {
      type: "question";
      id: string;
      jobId: string;
      text: string;
      attachments: ApiHistoryAttachment[];
      createdAt: string;
    }
  | {
      type: "answer";
      id: string;
      jobId: string;
      text: string;
      createdAt: string;
    }
  | {
      type: "status";
      id: string;
      jobId: string;
      message: string;
      createdAt: string;
    }
  | {
      type: "limit";
      id: string;
      message: string;
      createdAt: string;
    };

export type ApiHistoryConversation = {
  conversationKey: string;
  interactionUser: string;
  createdAt: string;
  updatedAt: string;
  items: ApiHistoryItem[];
};

export type ApiHistoryDocument = {
  version: 1;
  conversations: ApiHistoryConversation[];
};

export type ApiHistoryStore = {
  getConversation(conversationKey: string): Promise<ApiHistoryConversation | null>;
  reserveQuestionSlot(entry: ApiHistoryCapacityEntry): Promise<ApiHistoryCapacityResult>;
  recordQuestion(entry: ApiHistoryQuestionEntry): Promise<void>;
  recordJobSnapshot(entry: ApiHistoryJobSnapshotEntry): Promise<void>;
};

export type ApiHistoryCapacityResult =
  | { accepted: true }
  | { accepted: false; message: string };

export type ApiHistoryCapacityEntry = {
  conversationKey: string;
  interactionUser: string;
};

export type ApiHistoryQuestionEntry = {
  conversationKey: string;
  interactionUser: string;
  jobId: string;
  question: string;
  attachments: AskAttachment[];
};

export type ApiHistoryJobSnapshotEntry = {
  conversationKey: string;
  interactionUser: string;
  job: AskJobSnapshot;
};

export type ApiHistoryStoreOptions = {
  historyPath?: string | null;
  now?: () => Date;
  maxConversations?: number;
  maxItemsPerConversation?: number;
};

export function createApiHistoryStore({
  historyPath = null,
  now = () => new Date(),
  maxConversations = DEFAULT_MAX_CONVERSATIONS,
  maxItemsPerConversation = DEFAULT_MAX_ITEMS_PER_CONVERSATION
}: ApiHistoryStoreOptions = {}): ApiHistoryStore {
  validatePositiveInteger(maxConversations, "maxConversations");
  validatePositiveInteger(maxItemsPerConversation, "maxItemsPerConversation");

  const resolvedHistoryPath = resolveHistoryPath(historyPath);
  let writeQueue: Promise<unknown> = Promise.resolve();

  return {
    async getConversation(conversationKey) {
      await writeQueue;
      const document = await readHistoryDocument(resolvedHistoryPath);
      const conversation = document.conversations.find(item => item.conversationKey === conversationKey);
      return conversation ? structuredClone(conversation) : null;
    },
    reserveQuestionSlot(entry) {
      return enqueueMutation(document => {
        const conversation = getOrCreateConversation(document, {
          conversationKey: entry.conversationKey,
          interactionUser: entry.interactionUser,
          now
        });
        const timestamp = toTimestamp(now());
        if (hasLimitReached(conversation)) {
          conversation.updatedAt = timestamp;
          return {
            accepted: false,
            message: API_HISTORY_LIMIT_REACHED_MESSAGE
          };
        }
        if (conversation.items.length >= maxItemsPerConversation) {
          conversation.items.push({
            type: "limit",
            id: randomUUID(),
            message: API_HISTORY_LIMIT_REACHED_MESSAGE,
            createdAt: timestamp
          });
          conversation.updatedAt = timestamp;
          return {
            accepted: false,
            message: API_HISTORY_LIMIT_REACHED_MESSAGE
          };
        }

        return {
          accepted: true
        };
      });
    },
    recordQuestion(entry) {
      return enqueueMutation(document => {
        appendHistoryItem(document, {
          conversationKey: entry.conversationKey,
          interactionUser: entry.interactionUser,
          item: {
            type: "question",
            id: randomUUID(),
            jobId: entry.jobId,
            text: entry.question,
            attachments: entry.attachments.map(toHistoryAttachment),
            createdAt: toTimestamp(now())
          }
        });
      });
    },
    recordJobSnapshot(entry) {
      return enqueueMutation(document => {
        const item = toJobHistoryItem(entry.job, now);
        if (!item) {
          return;
        }

        appendHistoryItem(document, {
          conversationKey: entry.conversationKey,
          interactionUser: entry.interactionUser,
          item
        });
      });
    }
  };

  function enqueueMutation<Result>(mutate: (document: ApiHistoryDocument) => Result): Promise<Result> {
    const nextWrite = writeQueue.then(async () => {
      const document = await readHistoryDocument(resolvedHistoryPath);
      const result = mutate(document);
      pruneConversations(document, maxConversations);
      await writeHistoryDocument(resolvedHistoryPath, document);
      return result;
    });

    writeQueue = nextWrite.catch(() => {});
    return nextWrite;
  }

  function appendHistoryItem(
    document: ApiHistoryDocument,
    {
      conversationKey,
      interactionUser,
      item
    }: {
      conversationKey: string;
      interactionUser: string;
      item: ApiHistoryItem;
    }
  ): void {
    const conversation = getOrCreateConversation(document, {
      conversationKey,
      interactionUser,
      now
    });

    if (hasLimitReached(conversation)) {
      conversation.updatedAt = item.createdAt;
      return;
    }

    if (conversation.items.length >= maxItemsPerConversation) {
      conversation.items.push({
        type: "limit",
        id: randomUUID(),
        message: API_HISTORY_LIMIT_REACHED_MESSAGE,
        createdAt: item.createdAt
      });
      conversation.updatedAt = item.createdAt;
      return;
    }

    conversation.items.push(item);
    conversation.updatedAt = item.createdAt;
  }
}

export function resolveHistoryPath(historyPath: string | null | undefined = null): string {
  return historyPath
    ?? process.env.ATC_HISTORY_PATH
    ?? path.join(os.homedir(), ".local/share/atc/history.json");
}

async function readHistoryDocument(historyPath: string): Promise<ApiHistoryDocument> {
  try {
    const content = await readFile(historyPath, "utf8");
    return normalizeHistoryDocument(JSON.parse(content) as unknown);
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        version: HISTORY_VERSION,
        conversations: []
      };
    }

    throw error;
  }
}

function normalizeHistoryDocument(value: unknown): ApiHistoryDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      version: HISTORY_VERSION,
      conversations: []
    };
  }

  const document = value as Partial<ApiHistoryDocument>;
  if (!Array.isArray(document.conversations)) {
    return {
      version: HISTORY_VERSION,
      conversations: []
    };
  }

  return {
    version: HISTORY_VERSION,
    conversations: document.conversations.filter(isHistoryConversation)
  };
}

function isHistoryConversation(value: unknown): value is ApiHistoryConversation {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as ApiHistoryConversation).conversationKey === "string"
    && typeof (value as ApiHistoryConversation).interactionUser === "string"
    && typeof (value as ApiHistoryConversation).createdAt === "string"
    && typeof (value as ApiHistoryConversation).updatedAt === "string"
    && Array.isArray((value as ApiHistoryConversation).items)
  );
}

async function writeHistoryDocument(historyPath: string, document: ApiHistoryDocument): Promise<void> {
  const dir = path.dirname(historyPath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(historyPath)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(tempPath, historyPath);
}

function getOrCreateConversation(
  document: ApiHistoryDocument,
  {
    conversationKey,
    interactionUser,
    now
  }: {
    conversationKey: string;
    interactionUser: string;
    now: () => Date;
  }
): ApiHistoryConversation {
  const existing = document.conversations.find(conversation => conversation.conversationKey === conversationKey);
  if (existing) {
    return existing;
  }

  const timestamp = toTimestamp(now());
  const conversation: ApiHistoryConversation = {
    conversationKey,
    interactionUser,
    createdAt: timestamp,
    updatedAt: timestamp,
    items: []
  };
  document.conversations.push(conversation);
  return conversation;
}

function pruneConversations(document: ApiHistoryDocument, maxConversations: number): void {
  if (document.conversations.length <= maxConversations) {
    return;
  }

  document.conversations.sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
  document.conversations.splice(0, document.conversations.length - maxConversations);
}

function toJobHistoryItem(job: AskJobSnapshot, now: () => Date): ApiHistoryItem | null {
  if (job.status === "completed" && job.result?.mode === "answer") {
    return {
      type: "answer",
      id: randomUUID(),
      jobId: job.id,
      text: job.result.synthesis.text,
      createdAt: job.finishedAt ?? toTimestamp(now())
    };
  }

  if (job.status === "failed") {
    return {
      type: "status",
      id: randomUUID(),
      jobId: job.id,
      message: job.error ?? "Job failed.",
      createdAt: job.finishedAt ?? toTimestamp(now())
    };
  }

  return null;
}

function toHistoryAttachment(attachment: AskAttachment): ApiHistoryAttachment {
  return {
    name: attachment.name,
    mediaType: attachment.mediaType,
    bytes: "contentBase64" in attachment
      ? Buffer.from(attachment.contentBase64, "base64").byteLength
      : attachment.size
  };
}

function hasLimitReached(conversation: ApiHistoryConversation): boolean {
  return conversation.items.some(item => item.type === "limit");
}

function toTimestamp(value: Date): string {
  return value.toISOString();
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${value}. Use a positive integer.`);
  }
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
