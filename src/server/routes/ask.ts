import type { Env, Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";

import type { AskJobEvent, AskJobSnapshot, AskRequest } from "../../core/types.ts";
import { saveAttachments, type IncomingAttachment, type SavedAttachments } from "../attachments.ts";
import {
  HttpError,
  isTerminalStatus,
  normalizeAskRequest,
  readJsonBody,
  type ApiRouteDeps,
  withJobLinks
} from "./api-helpers.ts";
import { getAuthSessionResult, serializeRefreshedSessionCookie } from "./auth.ts";

const KEEP_ALIVE_INTERVAL_MS = 15_000;
const SSE_RETRY_MS = 1000;

export function registerAskRoutes<E extends Env>(app: Hono<E>, deps: Pick<ApiRouteDeps, "bodyLimitBytes" | "env" | "jobManager">): void {
  app.post("/ask", async c => {
    const refreshedSessionCookie = requireAuthenticatedAsk(c.req.header("cookie"), deps.env);
    const contentType = c.req.header("content-type") ?? "";
    const multipartRequest = contentType.toLowerCase().startsWith("multipart/form-data")
      ? await readMultipartAskRequest(c.req.raw)
      : null;
    const payload = multipartRequest?.request
      ?? normalizeAskRequest(await readJsonBody(c.req.raw, deps.bodyLimitBytes));
    let job: AskJobSnapshot;
    try {
      job = deps.jobManager.createJob(payload);
    } catch (error) {
      if (multipartRequest) {
        await multipartRequest.saved.cleanup();
      }
      throw error;
    }
    if (multipartRequest) {
      scheduleAttachmentCleanup(deps.jobManager, job.id, multipartRequest.saved);
    }
    const response = c.json(withJobLinks(job), 202);
    if (refreshedSessionCookie) {
      response.headers.append("Set-Cookie", serializeRefreshedSessionCookie(refreshedSessionCookie, c.req.url));
    }
    return response;
  });

  app.post("/jobs", () => {
    throw new HttpError(410, "POST /jobs was removed. Use POST /ask.");
  });

  app.get("/jobs/:id", c => {
    const jobId = decodeJobId(c.req.param("id"));
    const job = getJobOrThrow(deps.jobManager, jobId);

    return c.json(withJobLinks(job));
  });

  app.get("/jobs/:id/events", c => {
    const jobId = decodeJobId(c.req.param("id"));
    const job = getJobOrThrow(deps.jobManager, jobId);

    return streamSSE(c, stream => streamJobEvents(stream, deps.jobManager, job));
  });
}

function requireAuthenticatedAsk(cookieHeader: string | undefined, env: ApiRouteDeps["env"]): string | null {
  const { session, refreshedCookie } = getAuthSessionResult(cookieHeader, env);
  if (session.githubConfigured && !session.authenticated) {
    throw new HttpError(401, "Sign in with GitHub before asking a question.");
  }
  return refreshedCookie;
}

type MultipartAskRequest = {
  request: AskRequest;
  saved: SavedAttachments;
};

async function readMultipartAskRequest(request: Request): Promise<MultipartAskRequest> {
  const formData = await request.formData();
  const payload = formData.get("payload");
  if (typeof payload !== "string") {
    throw new HttpError(400, 'Multipart request must include a "payload" string field with the ask request JSON.');
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, `Multipart "payload" is not valid JSON: ${message}`);
  }

  const incoming: IncomingAttachment[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("file_") || !(value instanceof File)) {
      continue;
    }

    incoming.push({
      name: value.name || key,
      mediaType: value.type || "application/octet-stream",
      bytes: new Uint8Array(await value.arrayBuffer())
    });
  }

  const normalized = normalizeAskRequest(parsedPayload);
  const saved = await saveAttachments(incoming).catch(error => {
    const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 400;
    throw new HttpError(statusCode, error instanceof Error ? error.message : String(error));
  });

  return {
    request: {
      ...normalized,
      ...(saved.refs.length > 0 ? { attachments: saved.refs } : {})
    },
    saved
  };
}

function scheduleAttachmentCleanup(
  jobManager: Pick<ApiRouteDeps["jobManager"], "getJob" | "subscribe">,
  jobId: string,
  saved: SavedAttachments
): void {
  if (saved.refs.length === 0) {
    return;
  }

  let cleaned = false;
  let fallbackCleanupTimer: NodeJS.Timeout | null = null;
  const cleanup = (): void => {
    if (cleaned) {
      return;
    }

    cleaned = true;
    if (fallbackCleanupTimer) {
      clearTimeout(fallbackCleanupTimer);
    }
    void saved.cleanup().catch(() => {});
  };
  fallbackCleanupTimer = setTimeout(cleanup, 10 * 60 * 1000);
  fallbackCleanupTimer.unref?.();
  const unsubscribe = jobManager.subscribe(jobId, event => {
    if (!isTerminalStatus(event.type)) {
      return;
    }

    cleanup();
    unsubscribe?.();
  });
  const currentJob = jobManager.getJob(jobId);
  if (!unsubscribe || (currentJob && isTerminalStatus(currentJob.status))) {
    cleanup();
    unsubscribe?.();
  }
}

function decodeJobId(jobId: string): string {
  try {
    return decodeURIComponent(jobId);
  } catch {
    throw new HttpError(400, `Invalid job id: ${jobId}`);
  }
}

function getJobOrThrow(
  jobManager: Pick<ApiRouteDeps["jobManager"], "getJob">,
  jobId: string
) {
  const job = jobManager.getJob(jobId);
  if (!job) {
    throw new HttpError(404, `Unknown job: ${jobId}`);
  }

  return job;
}

async function streamJobEvents(
  output: SSEStreamingApi,
  jobManager: Pick<ApiRouteDeps["jobManager"], "getJob" | "subscribe">,
  job: AskJobSnapshot
): Promise<void> {
  const jobId = job.id;
  let streamClosed = false;
  let unsubscribe: (() => void) | null = null;
  let keepAliveTimer: NodeJS.Timeout | undefined;
  let writeChain = Promise.resolve();

  const cleanup = () => {
    if (streamClosed) {
      return;
    }

    streamClosed = true;
    clearInterval(keepAliveTimer);
    unsubscribe?.();
  };
  output.onAbort(cleanup);

  await output.write(`retry: ${SSE_RETRY_MS}\n\n`);
  await writeSseEvent(output, "snapshot", withJobLinks(job));

  if (isTerminalStatus(job.status)) {
    await writeSseEvent(output, job.status, withJobLinks(job));
    cleanup();
    return;
  }

  keepAliveTimer = setInterval(() => {
    if (!streamClosed) {
      void output.write(": keep-alive\n\n").catch(cleanup);
    }
  }, KEEP_ALIVE_INTERVAL_MS);
  keepAliveTimer.unref?.();

  await new Promise<void>(resolve => {
    unsubscribe = jobManager.subscribe(jobId, event => {
      writeChain = writeChain.then(async () => {
        if (streamClosed) {
          return;
        }

        if (!isTerminalStatus(event.type)) {
          await writeSseEvent(output, event.type, event);
          return;
        }

        const currentJob = jobManager.getJob(jobId);
        if (currentJob) {
          const currentJobWithLinks = withJobLinks(currentJob);
          await writeSseEvent(output, event.type, currentJobWithLinks);
          await writeSseEvent(output, "snapshot", currentJobWithLinks);
        } else {
          await writeSseEvent(output, event.type, event);
        }
        cleanup();
        resolve();
      }).catch(() => {
        cleanup();
        resolve();
      });
    });

    if (!unsubscribe) {
      cleanup();
      resolve();
      return;
    }

    const currentJob = jobManager.getJob(jobId);
    if (currentJob && isTerminalStatus(currentJob.status)) {
      writeChain = writeChain.then(async () => {
        await writeSseEvent(output, currentJob.status, withJobLinks(currentJob));
        await writeSseEvent(output, "snapshot", withJobLinks(currentJob));
        cleanup();
        resolve();
      }).catch(() => {
        cleanup();
        resolve();
      });
    }
  });

  await writeChain;
}

async function writeSseEvent(output: SSEStreamingApi, type: string, payload: AskJobEvent | unknown): Promise<void> {
  await output.writeSSE({
    data: JSON.stringify(payload),
    event: type
  });
}
