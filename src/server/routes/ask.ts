import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { AppEnv } from "../app.ts";
import { saveAttachments, type IncomingAttachment } from "../attachments.ts";
import type { HistoryStore } from "../history-store.ts";
import type {
  AskJobEvent,
  AskJobManager,
  AskJobSnapshot,
  AskRequest
} from "../../core/types.ts";
import {
  DEFAULT_BODY_LIMIT_BYTES,
  HttpError,
  isTerminalStatus,
  normalizeAskRequest,
  readJsonBody,
  withJobLinks
} from "./api-helpers.ts";

type HttpJobManager = Pick<AskJobManager, "createJob" | "getJob" | "subscribe"> &
  Partial<Pick<AskJobManager, "getStats">>;

export interface AskDeps {
  jobManager: HttpJobManager;
  bodyLimitBytes?: number;
  historyStore?: HistoryStore;
}

const KEEP_ALIVE_INTERVAL_MS = 15_000;
const SSE_RETRY_MS = 1000;

export function registerAskRoutes(app: Hono<AppEnv>, deps: AskDeps): void {
  const bodyLimitBytes = deps.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;

  app.post("/ask", async c => {
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      return handleMultipartAsk(c, deps.jobManager, deps.historyStore);
    }
    const raw = await readJsonBody(c.req.raw, bodyLimitBytes);
    const payload = normalizeAskRequest(raw);
    const job = deps.jobManager.createJob(payload);
    deps.historyStore?.record(job.id);
    return c.json(withJobLinks(job), 202);
  });

  app.post("/jobs", () => {
    throw new HttpError(410, "POST /jobs was removed. Use POST /ask.");
  });

  app.get("/jobs/:id", c => {
    const id = decodeURIComponent(c.req.param("id") ?? "");
    const job = deps.jobManager.getJob(id);
    if (!job) {
      throw new HttpError(404, `Unknown job: ${id}`);
    }
    return c.json(withJobLinks(job));
  });

  app.get("/jobs/:id/events", c => streamJobEvents(c, deps.jobManager));
}

async function handleMultipartAsk(
  c: Context<AppEnv>,
  jobManager: HttpJobManager,
  historyStore: HistoryStore | undefined
): Promise<Response> {
  const formData = await c.req.raw.formData();
  const payloadField = formData.get("payload");
  if (typeof payloadField !== "string") {
    throw new HttpError(400, 'Multipart request must include a "payload" string field with the ask request JSON.');
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadField);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, `Multipart "payload" is not valid JSON: ${message}`);
  }
  const askRequest = normalizeAskRequest(parsedPayload);

  const incoming: IncomingAttachment[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("file_") || !(value instanceof File)) continue;
    const buffer = new Uint8Array(await value.arrayBuffer());
    incoming.push({ name: value.name || key, type: value.type, bytes: buffer });
  }

  const saved = await saveAttachments(incoming).catch(error => {
    const status = (error as { statusCode?: number }).statusCode ?? 400;
    throw new HttpError(status, error instanceof Error ? error.message : String(error));
  });

  const requestWithAttachments: AskRequest =
    saved.refs.length > 0 ? { ...askRequest, attachments: saved.refs } : askRequest;
  const job = jobManager.createJob(requestWithAttachments);
  historyStore?.record(job.id);

  if (saved.refs.length > 0 && typeof jobManager.subscribe === "function") {
    const unsubscribe = jobManager.subscribe(job.id, event => {
      if (isTerminalStatus(event.type)) {
        void saved.cleanup();
        unsubscribe?.();
      }
    });
    if (!unsubscribe) {
      // fallback: clean up after a generous delay if no subscription was returned
      setTimeout(() => void saved.cleanup(), 10 * 60 * 1000).unref?.();
    }
  }

  return c.json(withJobLinks(job), 202);
}

function streamJobEvents(c: Context<AppEnv>, jobManager: HttpJobManager): Response {
  const id = decodeURIComponent(c.req.param("id") ?? "");
  const job = jobManager.getJob(id);
  if (!job) {
    throw new HttpError(404, `Unknown job: ${id}`);
  }

  return streamSSE(c, async stream => {
    await stream.write(`retry: ${SSE_RETRY_MS}\n\n`);
    await stream.writeSSE({
      event: "snapshot",
      data: JSON.stringify(withJobLinks(job))
    });

    if (isTerminalStatus(job.status)) {
      await stream.writeSSE({
        event: job.status,
        data: JSON.stringify(withJobLinks(job))
      });
      return;
    }

    const keepAlive = setInterval(() => {
      void stream.write(`: keep-alive\n\n`).catch(() => {
        /* ignore stream-closed errors */
      });
    }, KEEP_ALIVE_INTERVAL_MS);
    if (typeof keepAlive.unref === "function") keepAlive.unref();

    let unsubscribe: (() => void) | null = null;

    const finished = new Promise<void>(resolve => {
      stream.onAbort(() => {
        if (unsubscribe) unsubscribe();
        clearInterval(keepAlive);
        resolve();
      });

      unsubscribe = jobManager.subscribe(id, async (event: AskJobEvent) => {
        try {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });

          if (!isTerminalStatus(event.type)) {
            return;
          }

          const current = jobManager.getJob(id);
          if (current) {
            await stream.writeSSE({
              event: "snapshot",
              data: JSON.stringify(withJobLinks(current))
            });
          }
        } catch {
          /* ignore stream errors; cleanup happens via onAbort or finally */
        } finally {
          if (isTerminalStatus(event.type)) {
            if (unsubscribe) unsubscribe();
            clearInterval(keepAlive);
            resolve();
          }
        }
      });

      if (!unsubscribe) {
        clearInterval(keepAlive);
        resolve();
      }
    });

    await finished;
  });
}

export type { AskJobSnapshot };
