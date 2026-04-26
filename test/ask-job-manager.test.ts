import { afterEach, describe, expect, it, vi } from "vitest";

import { createAskJobManager } from "../src/core/jobs/ask-job-manager.ts";
import type { AnswerQuestionFn, AskJobEvent, AskResult } from "../src/core/types.ts";
import { createAnswerResult } from "./test-helpers.ts";

describe("ask-job-manager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues jobs, streams status updates, and respects the concurrency limit", async () => {
    let finishFirstJob: () => void = () => {
      throw new Error("First job release was not initialized.");
    };
    const firstJobDone = new Promise<void>(resolve => {
      finishFirstJob = () => resolve();
    });
    const answerQuestionFn = vi.fn(async (
      { question }: Parameters<AnswerQuestionFn>[0],
      execution: Parameters<AnswerQuestionFn>[1]
    ) => {
      const statusReporter = getRequiredStatusReporter(execution);
      statusReporter.info(`processing ${question}`);

      if (question === "first") {
        await firstJobDone;
      }

      statusReporter.info(`finished ${question}`);

      return createAnswerResult({
        question,
        synthesis: {
          text: `answer:${question}`
        }
      });
    });
    const manager = createAskJobManager({
      answerQuestionFn,
      generateJobId: createSequenceIdGenerator(),
      now: createSequenceClock(new Array(12).fill("2026-04-07T18:00:00.000Z")),
      maxConcurrentJobs: 1,
      jobRetentionMs: 60_000
    });
    const firstEvents: AskJobEvent[] = [];
    const secondEvents: AskJobEvent[] = [];

    const firstJob = manager.createJob({ question: "first" });
    const secondJob = manager.createJob({ question: "second" });
    manager.subscribe(firstJob.id, event => {
      firstEvents.push(event);
    });
    manager.subscribe(secondJob.id, event => {
      secondEvents.push(event);
    });

    expect(manager.getJob(firstJob.id)?.status).toBe("running");
    expect(manager.getJob(secondJob.id)?.status).toBe("queued");
    await Promise.resolve();
    expect(answerQuestionFn).toHaveBeenCalledTimes(1);
    expect(answerQuestionFn).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "first",
        audience: "general"
      }),
      expect.any(Object)
    );

    finishFirstJob();

    await waitFor(() => manager.getJob(firstJob.id)?.status === "completed");
    await waitFor(() => manager.getJob(secondJob.id)?.status === "completed");

    expect(answerQuestionFn).toHaveBeenCalledTimes(2);
    expect(firstEvents.map(event => event.type)).toContain("completed");
    expect(firstEvents.find(event => event.type === "completed")?.message).toBe("Job completed. (0s total)");
    expect(secondEvents.map(event => event.type)).toContain("started");
    expect(secondEvents.find(event => event.type === "status")?.message).toBe("processing second");
    expect(secondEvents.find(event => event.type === "completed")?.message).toBe("Job completed. (0s total)");
    expect(getAnswerText(manager.getJob(secondJob.id)?.result)).toBe("answer:second");

    manager.close();
  });

  it("includes total elapsed time from queue insertion in the completed event", async () => {
    let releaseJob: () => void = () => {
      throw new Error("Timed job release was not initialized.");
    };
    const jobReleased = new Promise<void>(resolve => {
      releaseJob = () => resolve();
    });
    const manager = createAskJobManager({
      answerQuestionFn: vi.fn(async () => {
        await jobReleased;

        return createAnswerResult({
          question: "timed",
          synthesis: {
            text: "answer:timed"
          }
        });
      }),
      generateJobId: createSequenceIdGenerator(),
      now: createSequenceClock([
        "2026-04-07T18:00:00.000Z",
        "2026-04-07T18:00:00.000Z",
        "2026-04-07T18:00:00.000Z",
        "2026-04-07T18:00:00.000Z",
        "2026-04-07T18:01:07.000Z",
        "2026-04-07T18:01:07.000Z"
      ]),
      jobRetentionMs: 60_000
    });
    const events: AskJobEvent[] = [];
    const job = manager.createJob({ question: "timed" });

    manager.subscribe(job.id, event => {
      events.push(event);
    });

    releaseJob();

    await waitFor(() => manager.getJob(job.id)?.status === "completed");

    expect(events.find(event => event.type === "completed")?.message).toBe("Job completed. (1m 7s total)");

    manager.close();
  });

  it("reuses the codex completion status instead of appending a generic completion line", async () => {
    const manager = createAskJobManager({
      answerQuestionFn: vi.fn(async (_request, { statusReporter }) => {
        statusReporter.info("Running Codex...");
        statusReporter.info("Running Codex... done in 34s");

        return createAnswerResult({
          question: "timed",
          selectedRepos: [],
          syncReport: [],
          synthesis: {
            text: "answer:timed"
          }
        });
      }),
      generateJobId: createSequenceIdGenerator(),
      now: createSequenceClock(new Array(8).fill("2026-04-07T18:00:00.000Z")),
      jobRetentionMs: 60_000
    });
    const events: AskJobEvent[] = [];
    const job = manager.createJob({ question: "timed" });

    manager.subscribe(job.id, event => {
      events.push(event);
    });

    await waitFor(() => manager.getJob(job.id)?.status === "completed");

    expect(events.find(event => event.type === "completed")?.message).toBe("Running Codex... done in 34s");

    manager.close();
  });

  it("runs up to three jobs concurrently by default", async () => {
    let releaseJobs: () => void = () => {
      throw new Error("Job release was not initialized.");
    };
    const jobsReleased = new Promise<void>(resolve => {
      releaseJobs = () => resolve();
    });
    const answerQuestionFn = vi.fn(async ({ question }) => {
      if (question !== "fourth") {
        await jobsReleased;
      }

      return createAnswerResult({
        question,
        synthesis: {
          text: `answer:${question}`
        }
      });
    });
    const manager = createAskJobManager({
      answerQuestionFn,
      generateJobId: createSequenceIdGenerator(),
      jobRetentionMs: 60_000
    });

    const firstJob = manager.createJob({ question: "first" });
    const secondJob = manager.createJob({ question: "second" });
    const thirdJob = manager.createJob({ question: "third" });
    const fourthJob = manager.createJob({ question: "fourth" });

    await Promise.resolve();

    expect(manager.getJob(firstJob.id)?.status).toBe("running");
    expect(manager.getJob(secondJob.id)?.status).toBe("running");
    expect(manager.getJob(thirdJob.id)?.status).toBe("running");
    expect(manager.getJob(fourthJob.id)?.status).toBe("queued");
    expect(answerQuestionFn).toHaveBeenCalledTimes(3);

    releaseJobs();

    await waitFor(() => manager.getJob(fourthJob.id)?.status === "completed");
    expect(answerQuestionFn).toHaveBeenCalledTimes(4);

    manager.close();
  });

  it("preserves an explicit request audience on the job snapshot", () => {
    const manager = createAskJobManager({
      answerQuestionFn: vi.fn(async () => createAnswerResult({
        question: "ignored",
        synthesis: {
          text: "ignored"
        }
      })),
      generateJobId: createSequenceIdGenerator(),
      jobRetentionMs: 60_000
    });

    const job = manager.createJob({
      question: "inspect implementation details",
      audience: "codebase"
    });

    expect(manager.getJob(job.id)?.request.audience).toBe("codebase");

    manager.close();
  });

  it("captures job failures as failed jobs", async () => {
    const manager = createAskJobManager({
      answerQuestionFn: vi.fn(async () => {
        throw new Error("boom");
      }),
      generateJobId: createSequenceIdGenerator(),
      jobRetentionMs: 60_000
    });

    const job = manager.createJob({ question: "explode" });

    await waitFor(() => manager.getJob(job.id)?.status === "failed");

    expect(manager.getJob(job.id)).toMatchObject({
      id: "job-1",
      status: "failed",
      error: "boom"
    });

    manager.close();
  });

  it("shutdown cancels queued jobs and waits for running jobs to finish", async () => {
    let finishFirstJob: () => void = () => {
      throw new Error("First job release was not initialized.");
    };
    const firstJobDone = new Promise<void>(resolve => {
      finishFirstJob = () => resolve();
    });
    const answerQuestionFn = vi.fn(async ({ question }) => {
      if (question === "first") {
        await firstJobDone;
      }

      return createAnswerResult({
        question,
        synthesis: {
          text: `answer:${question}`
        }
      });
    });
    const manager = createAskJobManager({
      answerQuestionFn,
      generateJobId: createSequenceIdGenerator(),
      maxConcurrentJobs: 1,
      jobRetentionMs: 60_000
    });

    const firstJob = manager.createJob({ question: "first" });
    const secondJob = manager.createJob({ question: "second" });

    await Promise.resolve();

    const shutdownPromise = manager.shutdown();

    expect(() => manager.createJob({ question: "after-shutdown" })).toThrow("Ask job manager is shutting down.");
    expect(manager.getJob(firstJob.id)?.status).toBe("running");
    expect(manager.getJob(secondJob.id)).toMatchObject({
      status: "failed",
      error: "Server shutting down."
    });

    finishFirstJob();

    await shutdownPromise;

    expect(manager.getJob(firstJob.id)?.status).toBe("completed");
    expect(answerQuestionFn).toHaveBeenCalledTimes(1);

    manager.close();
  });

  it("reports correct stats as jobs progress through states", async () => {
    let finishFirstJob: () => void = () => {
      throw new Error("First job release was not initialized.");
    };
    const firstJobDone = new Promise<void>(resolve => {
      finishFirstJob = () => resolve();
    });
    const answerQuestionFn = vi.fn(async ({ question }) => {
      if (question === "first") {
        await firstJobDone;
      }

      return createAnswerResult({
        question,
        synthesis: { text: `answer:${question}` }
      });
    });
    const manager = createAskJobManager({
      answerQuestionFn,
      generateJobId: createSequenceIdGenerator(),
      maxConcurrentJobs: 1,
      jobRetentionMs: 60_000
    });

    expect(manager.getStats()).toEqual({ queued: 0, running: 0, completed: 0, failed: 0 });

    manager.createJob({ question: "first" });
    manager.createJob({ question: "second" });

    await Promise.resolve();

    expect(manager.getStats()).toEqual({ queued: 1, running: 1, completed: 0, failed: 0 });

    finishFirstJob();

    await waitFor(() => manager.getStats().completed === 2);

    expect(manager.getStats()).toEqual({ queued: 0, running: 0, completed: 2, failed: 0 });

    manager.close();
  });

  it("reports failed jobs in stats", async () => {
    const manager = createAskJobManager({
      answerQuestionFn: vi.fn(async () => {
        throw new Error("boom");
      }),
      generateJobId: createSequenceIdGenerator(),
      jobRetentionMs: 60_000
    });

    manager.createJob({ question: "explode" });

    await waitFor(() => manager.getStats().failed === 1);

    expect(manager.getStats()).toEqual({ queued: 0, running: 0, completed: 0, failed: 1 });

    manager.close();
  });

  it("returns null when subscribing to an unknown job", () => {
    const manager = createAskJobManager({
      answerQuestionFn: vi.fn(async () => createAnswerResult({
        question: "ignored",
        synthesis: {
          text: "ignored"
        }
      }))
    });

    expect(manager.subscribe("missing", vi.fn())).toBeNull();

    manager.close();
  });

  it("expires completed jobs after the retention timeout", async () => {
    vi.useFakeTimers();
    const manager = createAskJobManager({
      answerQuestionFn: vi.fn(async () => createAnswerResult({
        question: "cleanup",
        synthesis: {
          text: "done"
        }
      })),
      generateJobId: createSequenceIdGenerator(),
      jobRetentionMs: 1_000
    });

    const job = manager.createJob({ question: "cleanup" });
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.getJob(job.id)?.status).toBe("completed");

    await vi.advanceTimersByTimeAsync(1_000);

    expect(manager.getJob(job.id)).toBeNull();
    expect(manager.subscribe(job.id, vi.fn())).toBeNull();

    manager.close();
  });

  it("rejects invalid numeric manager options", () => {
    expect(() => createAskJobManager({ jobRetentionMs: 0 })).toThrow(
      "Invalid jobRetentionMs: 0. Use a positive integer."
    );
    expect(() => createAskJobManager({ maxConcurrentJobs: -1 })).toThrow(
      "Invalid maxConcurrentJobs: -1. Use a positive integer."
    );
  });

  it("stops queued work and avoids cleanup timers after close", async () => {
    let finishFirstJob: () => void = () => {
      throw new Error("First job release was not initialized.");
    };
    const firstJobDone = new Promise<void>(resolve => {
      finishFirstJob = () => resolve();
    });
    const answerQuestionFn = vi.fn(async ({ question }) => {
      if (question === "first") {
        await firstJobDone;
      }

      return createAnswerResult({
        question,
        synthesis: {
          text: question
        }
      });
    });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const manager = createAskJobManager({
      answerQuestionFn,
      generateJobId: createSequenceIdGenerator(),
      maxConcurrentJobs: 1,
      jobRetentionMs: 60_000
    });

    const firstJob = manager.createJob({ question: "first" });
    const secondJob = manager.createJob({ question: "second" });

    await Promise.resolve();
    expect(answerQuestionFn).toHaveBeenCalledTimes(1);

    manager.close();

    finishFirstJob();
    await Promise.resolve();
    await Promise.resolve();

    expect(answerQuestionFn).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(manager.getJob(firstJob.id)).toBeNull();
    expect(manager.getJob(secondJob.id)).toBeNull();
    expect(manager.subscribe(firstJob.id, vi.fn())).toBeNull();
    expect(() => manager.createJob({ question: "after-close" })).toThrow("Ask job manager is closed.");

    setTimeoutSpy.mockRestore();
  });
});

function createSequenceIdGenerator() {
  let counter = 0;

  return () => {
    counter += 1;
    return `job-${counter}`;
  };
}

function createSequenceClock(values: string[]): () => Date {
  let index = 0;

  return () => {
    const resolvedValue = values[Math.min(index, values.length - 1)] ?? values[values.length - 1]!;
    index += 1;
    return new Date(resolvedValue);
  };
}

function getRequiredStatusReporter(execution: Parameters<AnswerQuestionFn>[1]) {
  if (
    !execution
    || typeof execution !== "object"
    || !("statusReporter" in execution)
    || !execution.statusReporter
    || typeof execution.statusReporter !== "object"
    || !("info" in execution.statusReporter)
  ) {
    throw new Error("Missing status reporter.");
  }

  return execution.statusReporter;
}

function getAnswerText(result: AskResult | null | undefined): string | null {
  return result?.mode === "answer" ? result.synthesis.text : null;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error("Condition not met in time.");
}
