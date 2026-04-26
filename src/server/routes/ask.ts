import type { Env, Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";

import type { AskJobEvent, AskJobSnapshot } from "../../core/types.ts";
import {
  HttpError,
  isTerminalStatus,
  normalizeAskRequest,
  readJsonBody,
  type ApiRouteDeps,
  withJobLinks
} from "./api-helpers.ts";
import { getAuthSession } from "./auth.ts";

const KEEP_ALIVE_INTERVAL_MS = 15_000;
const SSE_RETRY_MS = 1000;

export function registerAskRoutes<E extends Env>(app: Hono<E>, deps: Pick<ApiRouteDeps, "bodyLimitBytes" | "env" | "jobManager">): void {
  app.post("/ask", async c => {
    requireAuthenticatedAsk(c.req.header("cookie"), deps.env);
    const payload = normalizeAskRequest(await readJsonBody(c.req.raw, deps.bodyLimitBytes));
    return c.json(withJobLinks(deps.jobManager.createJob(payload)), 202);
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

function requireAuthenticatedAsk(cookieHeader: string | undefined, env: ApiRouteDeps["env"]): void {
  const session = getAuthSession(cookieHeader, env);
  if (session.githubConfigured && !session.authenticated) {
    throw new HttpError(401, "Sign in with GitHub before asking a question.");
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
