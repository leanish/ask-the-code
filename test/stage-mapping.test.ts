import { describe, expect, it } from "vitest";

import {
  createInitialPipeline,
  mapStatusMessageToStage,
  mapStatusToStage,
  reducePipelineEvent
} from "../src/server/ui/assets/stage-mapping.js";

describe("stage mapping", () => {
  it("maps status messages to the matching pipeline stage", () => {
    expect(mapStatusMessageToStage("Selecting repos...")).toBe("repo-selection");
    expect(mapStatusMessageToStage("Selected 2 repositories in 0s: app, api")).toBe("repo-selection");
    expect(mapStatusMessageToStage("Updating ask-the-code (main)...")).toBe("repository-sync");
    expect(mapStatusMessageToStage("Skip repo sync: yes")).toBe("repository-sync");
    expect(mapStatusMessageToStage("Running Codex... 3s elapsed")).toBe("codex-execution");
    expect(mapStatusMessageToStage("Generating answer...")).toBe("synthesis");
  });

  it("falls back to the most recent active stage for unknown messages", () => {
    expect(mapStatusMessageToStage("still working", "repository-sync")).toBe("repository-sync");
    expect(mapStatusToStage("still working")).toBeNull();
  });

  it("shows a pending job before the create request resolves", () => {
    const pipeline = reducePipelineEvent(createInitialPipeline(), {
      timestamp: "2026-04-25T05:00:00.000Z",
      type: "job-creating"
    });

    expect(pipeline.activeStage).toBe("job-created");
    expect(pipeline.stages["job-created"]).toMatchObject({
      detail: "Submitting job...",
      state: "running"
    });
  });

  it("records the job id after creation", () => {
    const pipeline = reducePipelineEvent(createInitialPipeline(), {
      jobId: "8f3c2d1a",
      timestamp: "2026-04-25T05:00:00.000Z",
      type: "job-created"
    });

    expect(pipeline.stages["job-created"]).toMatchObject({
      detail: "Job ID: 8f3c2d1a",
      state: "ok"
    });
  });

  it("advances previous stages when a later stage starts", () => {
    const pipeline = createInitialPipeline();
    const afterCreated = reducePipelineEvent(pipeline, {
      type: "job-created",
      timestamp: "2026-04-25T05:00:00.000Z"
    });
    const afterCodex = reducePipelineEvent(afterCreated, {
      message: "Running Codex...",
      timestamp: "2026-04-25T05:00:01.000Z",
      type: "status"
    });

    expect(afterCodex.stages["job-created"].state).toBe("ok");
    expect(afterCodex.stages["repo-selection"].state).toBe("ok");
    expect(afterCodex.stages["repository-sync"].state).toBe("ok");
    expect(afterCodex.stages["codex-execution"].state).toBe("running");
  });

  it("completes all waiting stages when the answer is ready", () => {
    const pipeline = reducePipelineEvent(createInitialPipeline(), {
      timestamp: "2026-04-25T05:00:00.000Z",
      type: "completed"
    });

    expect(Object.values(pipeline.stages).map(stage => stage.state)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "ok"
    ]);
    expect(pipeline.stages.synthesis.detail).toBe("Answer ready.");
    expect(pipeline.activeStage).toBeNull();
  });

  it("marks job creation failures before a job exists", () => {
    const pipeline = reducePipelineEvent(createInitialPipeline(), {
      message: "Network error",
      timestamp: "2026-04-25T05:00:00.000Z",
      type: "job-create-failed"
    });

    expect(pipeline.activeStage).toBe("job-created");
    expect(pipeline.stages["job-created"]).toMatchObject({
      detail: "Network error",
      state: "failed"
    });
    expect(pipeline.log.at(-1)?.message).toBe("ERROR: Network error");
  });

  it("marks the active stage as failed when a run fails", () => {
    const running = reducePipelineEvent(createInitialPipeline(), {
      message: "Running Codex...",
      timestamp: "2026-04-25T05:00:00.000Z",
      type: "status"
    });
    const failed = reducePipelineEvent(running, {
      message: "Codex exited with code 1",
      timestamp: "2026-04-25T05:00:01.000Z",
      type: "failed"
    });

    expect(failed.activeStage).toBe("codex-execution");
    expect(failed.stages["codex-execution"]).toMatchObject({
      detail: "Codex exited with code 1",
      state: "failed"
    });
    expect(failed.log.at(-1)?.message).toBe("ERROR: Codex exited with code 1");
  });

  it("uses fallback messages for empty status and failed events", () => {
    const running = reducePipelineEvent(createInitialPipeline(), {
      timestamp: "2026-04-25T05:00:00.000Z",
      type: "status"
    });
    const failed = reducePipelineEvent(createInitialPipeline(), {
      timestamp: "2026-04-25T05:00:01.000Z",
      type: "failed"
    });

    expect(running.stages.synthesis.detail).toBe("Running");
    expect(failed.stages["job-created"].detail).toBe("Failed");
  });

  it("ignores unknown pipeline events", () => {
    const pipeline = createInitialPipeline();

    expect(reducePipelineEvent(pipeline, { type: "custom-event" } as never)).toEqual(pipeline);
  });
});
