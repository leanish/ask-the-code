import http from "node:http";

import {
  DEFAULT_ANSWER_AUDIENCE,
  isSupportedAnswerAudience,
  SUPPORTED_ANSWER_AUDIENCES
} from "./answer-audience.js";
import { loadConfig } from "./config.js";
import { createAskJobManager } from "./ask-job-manager.js";
import { HTML_UI } from "./ui.html.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_BODY_LIMIT_BYTES = 65_536;

export async function startHttpServer({
  env = process.env,
  host = null,
  port = null,
  bodyLimitBytes = null,
  jobManager = null,
  answerQuestionFn = null,
  loadConfigFn = loadConfig,
  maxConcurrentJobs = null,
  jobRetentionMs = null
} = {}) {
  const resolvedHost = host || env.ARCHA_SERVER_HOST || DEFAULT_HOST;
  const resolvedPort = port ?? getOptionalPort(env.ARCHA_SERVER_PORT, "ARCHA_SERVER_PORT") ?? DEFAULT_PORT;
  const resolvedBodyLimitBytes = bodyLimitBytes
    ?? getOptionalPositiveInteger(env.ARCHA_SERVER_BODY_LIMIT_BYTES, "ARCHA_SERVER_BODY_LIMIT_BYTES")
    ?? DEFAULT_BODY_LIMIT_BYTES;
  const resolvedMaxConcurrentJobs = maxConcurrentJobs
    ?? getOptionalPositiveInteger(env.ARCHA_SERVER_MAX_CONCURRENT_JOBS, "ARCHA_SERVER_MAX_CONCURRENT_JOBS")
    ?? undefined;
  const resolvedJobRetentionMs = jobRetentionMs
    ?? getOptionalPositiveInteger(env.ARCHA_SERVER_JOB_RETENTION_MS, "ARCHA_SERVER_JOB_RETENTION_MS")
    ?? undefined;
  await loadConfigFn(env);
  const resolvedJobManager = jobManager || createAskJobManager({
    env,
    answerQuestionFn: answerQuestionFn || undefined,
    maxConcurrentJobs: resolvedMaxConcurrentJobs,
    jobRetentionMs: resolvedJobRetentionMs
  });
  const handler = createHttpHandler({
    bodyLimitBytes: resolvedBodyLimitBytes,
    env,
    jobManager: resolvedJobManager,
    loadConfigFn
  });
  const server = http.createServer((request, response) => {
    void handler(request, response);
  });

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(resolvedPort, resolvedHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    jobManager: resolvedJobManager,
    server,
    url: formatServerUrl(server),
    async close() {
      const shutdownPromise = typeof resolvedJobManager.shutdown === "function"
        ? resolvedJobManager.shutdown()
        : Promise.resolve();

      await Promise.all([
        shutdownPromise,
        new Promise(resolve => {
          server.close(() => {
            resolve();
          });
          server.closeIdleConnections?.();
        })
      ]);

      resolvedJobManager.close();
    }
  };
}

export function createHttpHandler({
  jobManager,
  bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
  env = process.env,
  loadConfigFn = loadConfig
}) {
  return async function handleHttpRequest(request, response) {
    await handleRequest({
      request,
      response,
      jobManager,
      bodyLimitBytes,
      env,
      loadConfigFn
    });
  };
}

async function handleRequest({ request, response, jobManager, bodyLimitBytes, env, loadConfigFn }) {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    const url = parseRequestUrl(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      if (prefersHtml(request)) {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache"
        });
        response.end(HTML_UI);
        return;
      }

      writeJson(response, 200, {
        service: "archa-server",
        endpoints: {
          createJob: "POST /ask",
          getJob: "GET /jobs/:id",
          listRepos: "GET /repos",
          streamJob: "GET /jobs/:id/events",
          health: "GET /health"
        }
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/repos") {
      const config = await loadConfigFn(env);
      writeJson(response, 200, {
        repos: config.repos.map(serializeRepoSummary)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/ask") {
      const payload = normalizeAskRequest(await readJsonBody(request, bodyLimitBytes));
      const job = jobManager.createJob(payload);
      writeJson(response, 202, withJobLinks(job));
      return;
    }

    if (request.method === "POST" && url.pathname === "/jobs") {
      throw new HttpError(410, "POST /jobs was removed. Use POST /ask.");
    }

    const jobId = matchJobPath(url.pathname, "/events");
    if (request.method === "GET" && jobId) {
      await streamJobEvents(response, jobManager, jobId);
      return;
    }

    const plainJobId = matchJobPath(url.pathname);
    if (request.method === "GET" && plainJobId) {
      const job = jobManager.getJob(plainJobId);
      if (!job) {
        throw new HttpError(404, `Unknown job: ${plainJobId}`);
      }

      writeJson(response, 200, withJobLinks(job));
      return;
    }

    throw new HttpError(404, `No route for ${request.method} ${url.pathname}`);
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : String(error);
    writeJson(response, statusCode, { error: message });
  }
}

async function streamJobEvents(response, jobManager, jobId) {
  const job = jobManager.getJob(jobId);
  if (!job) {
    throw new HttpError(404, `Unknown job: ${jobId}`);
  }

  let streamClosed = false;
  let keepAliveTimer = null;
  let unsubscribe = null;

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });

  if (!writeResponseChunk(response, "retry: 1000\n\n", () => streamClosed)) {
    return;
  }

  if (!writeSseEvent(response, "snapshot", withJobLinks(job), () => streamClosed)) {
    return;
  }

  if (isTerminalStatus(job.status)) {
    writeSseEvent(response, job.status, withJobLinks(job), () => streamClosed);
    endSseStream(response, cleanupStream, () => streamClosed);
    return;
  }

  keepAliveTimer = setInterval(() => {
    if (!writeResponseChunk(response, ": keep-alive\n\n", () => streamClosed)) {
      cleanupStream();
    }
  }, 15_000);
  keepAliveTimer.unref?.();

  unsubscribe = jobManager.subscribe(jobId, event => {
    if (!writeSseEvent(response, event.type, event, () => streamClosed)) {
      cleanupStream();
      return;
    }

    if (!isTerminalStatus(event.type)) {
      return;
    }

    const currentJob = jobManager.getJob(jobId);
    if (currentJob && !writeSseEvent(response, "snapshot", withJobLinks(currentJob), () => streamClosed)) {
      endSseStream(response, cleanupStream, () => streamClosed);
      return;
    }

    endSseStream(response, cleanupStream, () => streamClosed);
  });
  if (!unsubscribe) {
    endSseStream(response, cleanupStream, () => streamClosed);
    return;
  }

  response.on("close", cleanupStream);
  response.on("error", cleanupStream);

  function cleanupStream() {
    if (streamClosed) {
      return;
    }

    streamClosed = true;
    clearInterval(keepAliveTimer);
    unsubscribe?.();
  }
}

async function readJsonBody(request, bodyLimitBytes) {
  const chunks = [];
  let totalBytes = 0;

  return new Promise((resolve, reject) => {
    let settled = false;

    request.on("data", chunk => {
      if (settled) {
        return;
      }

      totalBytes += chunk.length;
      if (totalBytes > bodyLimitBytes) {
        settleReject(new HttpError(413, `Request body exceeds ${bodyLimitBytes} bytes.`));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      if (settled) {
        return;
      }

      if (chunks.length === 0) {
        settleReject(new HttpError(400, "Request body must be valid JSON."));
        return;
      }

      try {
        const parsedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        settled = true;
        resolve(parsedBody);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        settleReject(new HttpError(400, `Request body must be valid JSON: ${message}`));
      }
    });

    request.on("error", error => {
      settleReject(error);
    });

    function settleReject(error) {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    }
  });
}

function normalizeAskRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  if (hasOwn(body, "repoNames") && hasOwn(body, "repos")) {
    throw new HttpError(400, 'Use either "repoNames" or "repos", not both.');
  }

  if (typeof body.question !== "string" || body.question.trim() === "") {
    throw new HttpError(400, 'Request body must include a non-empty "question" string.');
  }

  return {
    question: body.question,
    repoNames: normalizeRepoNames(body.repoNames ?? body.repos),
    audience: normalizeAudience(body.audience),
    model: normalizeOptionalString(body.model, "model"),
    reasoningEffort: normalizeOptionalString(body.reasoningEffort, "reasoningEffort"),
    noSync: normalizeOptionalBoolean(body.noSync, "noSync"),
    noSynthesis: normalizeOptionalBoolean(body.noSynthesis, "noSynthesis")
  };
}

function normalizeRepoNames(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const repoNames = value
      .split(",")
      .map(name => name.trim())
      .filter(Boolean);

    return repoNames.length > 0 ? repoNames : null;
  }

  if (Array.isArray(value) && value.every(item => typeof item === "string" && item.trim() !== "")) {
    return value.map(item => item.trim());
  }

  throw new HttpError(400, '"repoNames" must be a comma-separated string or an array of non-empty strings.');
}

function normalizeAudience(value) {
  if (value == null) {
    return DEFAULT_ANSWER_AUDIENCE;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `"audience" must be one of: ${SUPPORTED_ANSWER_AUDIENCES.join(", ")}.`);
  }

  const audience = value.trim();
  if (!isSupportedAnswerAudience(audience)) {
    throw new HttpError(400, `"audience" must be one of: ${SUPPORTED_ANSWER_AUDIENCES.join(", ")}.`);
  }

  return audience;
}

function normalizeOptionalString(value, label) {
  if (value == null) {
    return null;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `"${label}" must be a non-empty string when provided.`);
  }

  return value;
}

function normalizeOptionalBoolean(value, label) {
  if (value == null) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new HttpError(400, `"${label}" must be a boolean when provided.`);
  }

  return value;
}

function matchJobPath(pathname, suffix = "") {
  const pattern = suffix
    ? new RegExp(`^/jobs/([^/]+)${escapeRegExp(suffix)}$`, "u")
    : /^\/jobs\/([^/]+)$/u;
  const match = pathname.match(pattern);

  return match ? decodeURIComponent(match[1]) : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function withJobLinks(job) {
  return {
    ...job,
    links: {
      self: `/jobs/${encodeURIComponent(job.id)}`,
      events: `/jobs/${encodeURIComponent(job.id)}/events`
    }
  };
}

function serializeRepoSummary(repo) {
  return {
    name: repo.name,
    defaultBranch: repo.defaultBranch,
    description: repo.description,
    aliases: repo.aliases
  };
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,Accept");
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeSseEvent(response, type, payload, isClosed = () => false) {
  return writeResponseChunk(
    response,
    `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`,
    isClosed
  );
}

function formatServerUrl(server) {
  const address = server.address();
  if (!address || typeof address === "string") {
    return null;
  }

  const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return `http://${host}:${address.port}`;
}

function parseRequestUrl(value) {
  try {
    return new URL(value || "/", "http://archa.local");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, `Invalid request URL: ${message}`);
  }
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function getOptionalPort(value, label) {
  if (value == null || value === "") {
    return null;
  }

  if (!/^\d+$/u.test(String(value))) {
    throw new Error(`Invalid ${label}: ${value}. Use a TCP port between 0 and 65535.`);
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`Invalid ${label}: ${value}. Use a TCP port between 0 and 65535.`);
  }

  return parsed;
}

function getOptionalPositiveInteger(value, label) {
  if (value == null || value === "") {
    return null;
  }

  if (!/^\d+$/u.test(String(value))) {
    throw new Error(`Invalid ${label}: ${value}. Use a positive integer.`);
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}. Use a positive integer.`);
  }

  return parsed;
}

function isTerminalStatus(status) {
  return status === "completed" || status === "failed";
}

function writeResponseChunk(response, chunk, isClosed) {
  if (isResponseClosed(response, isClosed)) {
    return false;
  }

  response.write(chunk);
  return !isResponseClosed(response, isClosed);
}

function endSseStream(response, cleanup, isClosed) {
  if (isResponseClosed(response, isClosed)) {
    cleanup();
    return;
  }

  cleanup();
  response.end();
}

function isResponseClosed(response, isClosed) {
  return isClosed() || response.destroyed || response.writableEnded;
}

function prefersHtml(request) {
  const accept = request.headers?.accept || "";
  return accept.includes("text/html");
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
