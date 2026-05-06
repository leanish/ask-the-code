import { Hono } from "hono";
import type { Env, Hono as HonoApp } from "hono";

import { createApiHistoryStore, type ApiHistoryStore } from "../api-history-store.ts";
import {
  HttpError,
  isTerminalStatus,
  normalizeApiAskRequest,
  readLimitedRequestBodyText,
  type ApiRouteDeps
} from "./api-helpers.ts";
import { authenticateApiInteraction } from "./api-auth.ts";

export type ApiAskRouteDeps = Pick<ApiRouteDeps, "bodyLimitBytes" | "env" | "jobManager"> & {
  historyStore?: ApiHistoryStore;
};

export function registerApiAskRoutes<E extends Env>(app: HonoApp<E>, deps: ApiAskRouteDeps): void {
  app.route("/api/v1", createApiAskRoutes<E>(deps));
}

export function createApiAskRoutes<E extends Env>(deps: ApiAskRouteDeps): HonoApp<E> {
  const app = new Hono<E>();
  const historyStore = deps.historyStore ?? createApiHistoryStore({
    historyPath: deps.env.ATC_HISTORY_PATH ?? null
  });

  app.post("/ask", async c => {
    const bodyText = await readLimitedRequestBodyText(c.req.raw, deps.bodyLimitBytes);
    const interaction = authenticateApiInteraction({
      bodyText,
      env: deps.env,
      headers: c.req.raw.headers
    });
    const payload = normalizeApiAskRequest(parseJsonBody(bodyText));
    const capacity = await historyStore.reserveQuestionSlot({
      conversationKey: interaction.conversationKey,
      interactionUser: interaction.interactionUser
    });
    if (!capacity.accepted) {
      throw new HttpError(409, capacity.message);
    }

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

  app.get("/history", async c => {
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

  return app;
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
  let recorded = false;
  let unsubscribe: (() => void) | null = null;
  const recordCurrentSnapshot = (): void => {
    if (recorded) {
      return;
    }
    recorded = true;
    const job = jobManager.getJob(jobId);
    if (job) {
      void historyStore.recordJobSnapshot({
        conversationKey,
        interactionUser,
        job
      });
    }
  };
  unsubscribe = jobManager.subscribe(jobId, event => {
    if (!isTerminalStatus(event.type)) {
      return;
    }

    recordCurrentSnapshot();
    unsubscribe?.();
  });

  const currentJob = jobManager.getJob(jobId);
  if (currentJob && isTerminalStatus(currentJob.status)) {
    recordCurrentSnapshot();
    unsubscribe?.();
  }
}
