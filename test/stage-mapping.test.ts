import { describe, expect, it } from "vitest";

import {
  createInitialPipeline,
  mapStatusToStage,
  reducePipelineEvent,
  STAGE_ORDER
} from "../src/server/ui/assets/stage-mapping.js";

describe("STAGE_ORDER", () => {
  it("orders the five stages", () => {
    expect(STAGE_ORDER).toEqual([
      "job-created",
      "repo-selection",
      "repository-sync",
      "codex-execution",
      "synthesis"
    ]);
  });
});

describe("mapStatusToStage", () => {
  it("maps repo selection messages", () => {
    expect(mapStatusToStage("Selecting repos via cascade...")).toBe("repo-selection");
    expect(mapStatusToStage("Selected 3 repositories.")).toBe("repo-selection");
  });

  it("maps repository sync messages", () => {
    expect(mapStatusToStage("Syncing repos...")).toBe("repository-sync");
    expect(mapStatusToStage("Up to date.")).toBe("repository-sync");
    expect(mapStatusToStage("Cloning repository...")).toBe("repository-sync");
  });

  it("maps codex execution including the codex status prefix", () => {
    expect(mapStatusToStage("[codex] tokens used: 1234")).toBe("codex-execution");
    expect(mapStatusToStage("Analyzing the repository...")).toBe("codex-execution");
  });

  it("maps synthesis messages", () => {
    expect(mapStatusToStage("Synthesis complete")).toBe("synthesis");
    expect(mapStatusToStage("Answer ready.")).toBe("synthesis");
    expect(mapStatusToStage("Generating answer...")).toBe("synthesis");
  });

  it("returns null for unknown text", () => {
    expect(mapStatusToStage("Unrecognized status line")).toBeNull();
  });
});

describe("reducePipelineEvent", () => {
  it("starts with all stages waiting and no active stage", () => {
    const pipeline = createInitialPipeline();
    expect(pipeline.activeStage).toBeNull();
    expect(pipeline.log).toEqual([]);
    for (const id of STAGE_ORDER) {
      expect(pipeline.stages[id].state).toBe("waiting");
      expect(pipeline.stages[id].timestamp).toBeNull();
    }
  });

  it("marks job-created running on job-creating", () => {
    const pipeline = reducePipelineEvent(createInitialPipeline(), { type: "job-creating" });
    expect(pipeline.stages["job-created"].state).toBe("running");
  });

  it("marks job-created ok and stamps a timestamp on job-created", () => {
    const pipeline = reducePipelineEvent(createInitialPipeline(), {
      type: "job-created",
      jobId: "abc",
      timestamp: "12:00:00"
    });
    expect(pipeline.stages["job-created"].state).toBe("ok");
    expect(pipeline.stages["job-created"].timestamp).toBe("12:00:00");
    expect(pipeline.stages["job-created"].detail).toContain("abc");
    expect(pipeline.activeStage).toBe("job-created");
  });

  it("marks job-created failed on job-create-failed", () => {
    const pipeline = reducePipelineEvent(createInitialPipeline(), {
      type: "job-create-failed",
      message: "boom"
    });
    expect(pipeline.stages["job-created"].state).toBe("failed");
    expect(pipeline.stages["job-created"].detail).toBe("boom");
  });

  it("transitions stages forward through status events", () => {
    let pipeline = reducePipelineEvent(createInitialPipeline(), {
      type: "job-created",
      jobId: "j1",
      timestamp: "12:00:00"
    });
    pipeline = reducePipelineEvent(pipeline, {
      type: "status",
      message: "Selected 2 repositories.",
      timestamp: "12:00:01"
    });
    expect(pipeline.stages["repo-selection"].state).toBe("running");
    expect(pipeline.activeStage).toBe("repo-selection");

    pipeline = reducePipelineEvent(pipeline, {
      type: "status",
      message: "Syncing repos...",
      timestamp: "12:00:02"
    });
    expect(pipeline.stages["repo-selection"].state).toBe("ok");
    expect(pipeline.stages["repository-sync"].state).toBe("running");

    pipeline = reducePipelineEvent(pipeline, {
      type: "status",
      message: "[codex] tokens used: 100",
      timestamp: "12:00:03"
    });
    expect(pipeline.stages["repository-sync"].state).toBe("ok");
    expect(pipeline.stages["codex-execution"].state).toBe("running");
  });

  it("appends every status message to the log even when stage is unknown", () => {
    let pipeline = createInitialPipeline();
    pipeline = reducePipelineEvent(pipeline, {
      type: "status",
      message: "noise that maps to no stage",
      timestamp: "12:00:00"
    });
    expect(pipeline.log).toEqual([{ message: "noise that maps to no stage", timestamp: "12:00:00" }]);
    expect(pipeline.activeStage).toBeNull();
  });

  it("marks all earlier stages ok and synthesis ok on completed", () => {
    let pipeline = createInitialPipeline();
    pipeline = reducePipelineEvent(pipeline, { type: "job-creating" });
    pipeline = reducePipelineEvent(pipeline, {
      type: "status",
      message: "Selected 1 repositories.",
      timestamp: "12:00:01"
    });
    pipeline = reducePipelineEvent(pipeline, { type: "completed", timestamp: "12:00:05" });

    for (const id of STAGE_ORDER) {
      expect(pipeline.stages[id].state).toBe("ok");
    }
    expect(pipeline.stages.synthesis.detail).toBe("Answer ready.");
    expect(pipeline.activeStage).toBe("synthesis");
  });

  it("marks the active stage failed on a failed event", () => {
    let pipeline = createInitialPipeline();
    pipeline = reducePipelineEvent(pipeline, {
      type: "job-created",
      jobId: "j",
      timestamp: "12:00:00"
    });
    pipeline = reducePipelineEvent(pipeline, {
      type: "status",
      message: "Selected 1 repositories.",
      timestamp: "12:00:01"
    });
    pipeline = reducePipelineEvent(pipeline, {
      type: "failed",
      message: "kaput",
      timestamp: "12:00:02"
    });

    expect(pipeline.stages["repo-selection"].state).toBe("failed");
    expect(pipeline.stages["repo-selection"].detail).toBe("kaput");
    expect(pipeline.log.at(-1)?.message).toContain("ERROR: kaput");
  });

  it("falls back to job-created when failure arrives before any active stage", () => {
    const pipeline = reducePipelineEvent(createInitialPipeline(), {
      type: "failed",
      message: "early death",
      timestamp: "12:00:00"
    });
    expect(pipeline.stages["job-created"].state).toBe("failed");
  });
});
