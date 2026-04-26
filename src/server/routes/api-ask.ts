import type { Env, Hono } from "hono";

import { createApiHistoryStore, type ApiHistoryStore } from "../api-history-store.ts";
import {
  HttpError,
  normalizeApiAskRequest,
  readLimitedRequestBodyText,
  type ApiRouteDeps
} from "./api-helpers.ts";
import { authenticateApiInteraction } from "./api-auth.ts";

export type ApiAskRouteDeps = Pick<ApiRouteDeps, "bodyLimitBytes" | "env" | "jobManager"> & {
  historyStore?: ApiHistoryStore;
};

export function registerApiAskRoutes<E extends Env>(app: Hono<E>, deps: ApiAskRouteDeps): void {
  const historyStore = deps.historyStore ?? createApiHistoryStore({
    historyPath: deps.env.ATC_HISTORY_PATH ?? null
  });

  app.post("/api/v1/ask", async c => {
    const bodyText = await readLimitedRequestBodyText(c.req.raw, deps.bodyLimitBytes);
    const interaction = authenticateApiInteraction({
      bodyText,
      env: deps.env,
      headers: c.req.raw.headers
    });
    const payload = normalizeApiAskRequest(parseJsonBody(bodyText));
    const job = deps.jobManager.createJob(payload);

    await historyStore.recordQuestion({
      conversationKey: interaction.conversationKey,
      interactionUser: interaction.interactionUser,
      jobId: job.id,
      question: payload.question,
      attachments: payload.attachments ?? []
    });
    subscribeHistorySnapshot(deps.jobManager, historyStore, {
      conversationKey: interaction.conversationKey,
      interactionUser: interaction.interactionUser,
      jobId: job.id
    });

    return c.json({
      jobId: job.id,
      status: job.status,
      interactionUser: interaction.interactionUser,
      conversationKey: interaction.conversationKey
    }, 202);
  });

  app.get("/api/v1/history", async c => {
    const conversationKey = c.req.query("conversationKey");
    if (!conversationKey) {
      throw new HttpError(400, 'Query parameter "conversationKey" is required.');
    }

    const interaction = authenticateApiInteraction({
      bodyText: "",
      env: deps.env,
      headers: c.req.raw.headers
    });
    if (interaction.conversationKey !== conversationKey) {
      throw new HttpError(403, "Signed conversation key does not match the requested history.");
    }

    return c.json({
      conversation: await historyStore.getConversation(conversationKey)
    });
  });
}

function parseJsonBody(bodyText: string): unknown {
  if (bodyText === "") {
    throw new HttpError(400, "Request body must be valid JSON.");
  }

  try {
    return JSON.parse(bodyText) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, `Request body must be valid JSON: ${message}`);
  }
}

function subscribeHistorySnapshot(
  jobManager: ApiAskRouteDeps["jobManager"],
  historyStore: ApiHistoryStore,
  {
    conversationKey,
    interactionUser,
    jobId
  }: {
    conversationKey: string;
    interactionUser: string;
    jobId: string;
  }
): void {
  const recordCurrentSnapshot = (): void => {
    const job = jobManager.getJob(jobId);
    if (job) {
      void historyStore.recordJobSnapshot({
        conversationKey,
        interactionUser,
        job
      });
    }
  };
  const unsubscribe = jobManager.subscribe(jobId, event => {
    if (event.type !== "completed" && event.type !== "failed") {
      return;
    }

    recordCurrentSnapshot();
    unsubscribe?.();
  });

  const currentJob = jobManager.getJob(jobId);
  if (currentJob?.status === "completed" || currentJob?.status === "failed") {
    recordCurrentSnapshot();
    unsubscribe?.();
  }
}
