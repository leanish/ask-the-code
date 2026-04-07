import { randomUUID } from "node:crypto";

import { resolveAnswerAudience } from "../answer/answer-audience.js";
import { answerQuestion } from "../answer/question-answering.js";
import { createRepoSyncCoordinator } from "../repos/repo-sync-coordinator.js";
import { createCallbackStatusReporter } from "../status/status-reporter.js";
import { formatDuration } from "../time/duration-format.js";

const DEFAULT_JOB_RETENTION_MS = 3_600_000;
const DEFAULT_MAX_CONCURRENT_JOBS = 3;

export function createAskJobManager({
  env = process.env,
  answerQuestionFn = answerQuestion,
  syncCoordinator = createRepoSyncCoordinator(),
  generateJobId = randomUUID,
  now = () => new Date(),
  jobRetentionMs = DEFAULT_JOB_RETENTION_MS,
  maxConcurrentJobs = DEFAULT_MAX_CONCURRENT_JOBS
} = {}) {
  validatePositiveInteger(jobRetentionMs, "jobRetentionMs");
  validatePositiveInteger(maxConcurrentJobs, "maxConcurrentJobs");

  const jobs = new Map();
  const subscribers = new Map();
  const cleanupTimers = new Map();
  const pendingJobIds = [];
  let runningJobs = 0;
  let closed = false;
  let shuttingDown = false;
  let shutdownPromise = null;
  let resolveShutdown = null;

  return {
    createJob,
    getJob,
    shutdown,
    getStats,
    subscribe,
    close
  };

  function createJob(request) {
    if (closed) {
      throw new Error("Ask job manager is closed.");
    }
    if (shuttingDown) {
      throw new Error("Ask job manager is shutting down.");
    }

    const job = {
      id: generateJobId(),
      status: "queued",
      request: normalizeRequest(request),
      createdAt: toTimestamp(now()),
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
      events: [],
      nextEventSequence: 1
    };

    jobs.set(job.id, job);
    subscribers.set(job.id, new Set());
    appendEvent(job, "queued", "Job queued.");
    pendingJobIds.push(job.id);
    drainQueue();

    return snapshotJob(job);
  }

  function getJob(jobId) {
    const job = jobs.get(jobId);
    return job ? snapshotJob(job) : null;
  }

  function getStats() {
    let queued = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const job of jobs.values()) {
      switch (job.status) {
        case "queued": queued += 1; break;
        case "running": running += 1; break;
        case "completed": completed += 1; break;
        case "failed": failed += 1; break;
      }
    }

    return { queued, running, completed, failed };
  }

  function subscribe(jobId, listener) {
    if (closed) {
      return null;
    }

    const listeners = subscribers.get(jobId);
    if (!listeners) {
      return null;
    }

    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  function shutdown() {
    if (closed) {
      return Promise.resolve();
    }

    if (shuttingDown) {
      return shutdownPromise;
    }

    shuttingDown = true;
    shutdownPromise = new Promise(resolve => {
      resolveShutdown = resolve;
    });

    cancelPendingJobs();
    resolveShutdownIfDrained();

    return shutdownPromise;
  }

  function close() {
    closed = true;
    shuttingDown = true;
    pendingJobIds.length = 0;

    for (const timer of cleanupTimers.values()) {
      clearTimeout(timer);
    }

    cleanupTimers.clear();
    subscribers.clear();
    jobs.clear();
    resolveShutdownIfDrained();
  }

  function drainQueue() {
    if (closed || shuttingDown) {
      return;
    }

    while (runningJobs < maxConcurrentJobs && pendingJobIds.length > 0) {
      const nextJobId = pendingJobIds.shift();
      if (!nextJobId) {
        continue;
      }

      const job = jobs.get(nextJobId);
      if (!job || job.status !== "queued") {
        continue;
      }

      runJob(job);
    }
  }

  function runJob(job) {
    runningJobs += 1;
    job.status = "running";
    job.startedAt = toTimestamp(now());
    appendEvent(job, "started", "Job started.");

    Promise.resolve().then(async () => {
      const result = await answerQuestionFn(job.request, {
        env,
        statusReporter: createCallbackStatusReporter(message => {
          appendEvent(job, "status", message);
        }),
        syncReposFn: syncCoordinator.syncRepos
      });

      job.status = "completed";
      job.finishedAt = toTimestamp(now());
      job.result = result;
      appendEvent(job, "completed", `Job completed. (${formatElapsedSinceCreation(job)} total)`);
    }).catch(error => {
      job.status = "failed";
      job.finishedAt = toTimestamp(now());
      job.error = error instanceof Error ? error.message : String(error);
      appendEvent(job, "failed", job.error);
    }).finally(() => {
      runningJobs -= 1;

      if (closed) {
        resolveShutdownIfDrained();
        return;
      }

      if (shuttingDown) {
        resolveShutdownIfDrained();
        return;
      }

      scheduleCleanup(job.id);
      drainQueue();
    });
  }

  function appendEvent(job, type, message) {
    const event = {
      sequence: job.nextEventSequence,
      type,
      message,
      timestamp: toTimestamp(now())
    };

    job.nextEventSequence += 1;
    job.events.push(event);
    publishEvent(job.id, event);
  }

  function publishEvent(jobId, event) {
    const listeners = subscribers.get(jobId);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(structuredClone(event));
    }
  }

  function scheduleCleanup(jobId) {
    const existingTimer = cleanupTimers.get(jobId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      cleanupTimers.delete(jobId);
      jobs.delete(jobId);
      subscribers.delete(jobId);
    }, jobRetentionMs);

    timer.unref?.();
    cleanupTimers.set(jobId, timer);
  }

  function cancelPendingJobs() {
    while (pendingJobIds.length > 0) {
      const nextJobId = pendingJobIds.shift();
      if (!nextJobId) {
        continue;
      }

      const job = jobs.get(nextJobId);
      if (!job || job.status !== "queued") {
        continue;
      }

      job.status = "failed";
      job.finishedAt = toTimestamp(now());
      job.error = "Server shutting down.";
      appendEvent(job, "failed", job.error);
    }
  }

  function resolveShutdownIfDrained() {
    if (!shuttingDown || runningJobs > 0 || !resolveShutdown) {
      return;
    }

    resolveShutdown();
    resolveShutdown = null;
  }
}

function normalizeRequest(request) {
  return {
    question: request.question,
    repoNames: request.repoNames ? [...request.repoNames] : null,
    audience: resolveAnswerAudience(request.audience),
    model: request.model || null,
    reasoningEffort: request.reasoningEffort || null,
    noSync: Boolean(request.noSync),
    noSynthesis: Boolean(request.noSynthesis)
  };
}

function snapshotJob(job) {
  return structuredClone({
    id: job.id,
    status: job.status,
    request: job.request,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    result: job.result,
    events: job.events
  });
}

function toTimestamp(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function formatElapsedSinceCreation(job) {
  const createdAt = Date.parse(job.createdAt);
  const finishedAt = Date.parse(job.finishedAt);

  if (!Number.isFinite(createdAt) || !Number.isFinite(finishedAt) || finishedAt < createdAt) {
    return "0s";
  }

  return formatDuration(finishedAt - createdAt);
}

function validatePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${value}. Use a positive integer.`);
  }
}
