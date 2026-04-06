import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  spawn: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    access: mocks.access,
    mkdir: mocks.mkdir
  }
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn
}));

import { syncRepos } from "../src/repo-sync.js";

describe("syncRepos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mkdir.mockResolvedValue();
  });

  it("clones missing repos and reports them as cloned", async () => {
    mocks.access.mockRejectedValueOnce(new Error("missing"));
    mocks.spawn.mockReturnValue(createSuccessfulChild());

    const report = await syncRepos([
      {
        name: "sqs-codec",
        url: "git@github.com:leanish/sqs-codec.git",
        directory: "/workspace/repos/sqs-codec",
        defaultBranch: "main"
      }
    ]);

    expect(report).toEqual([
      {
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "cloned",
        detail: "main"
      }
    ]);
    expect(mocks.spawn).toHaveBeenCalledWith("git", [
      "clone",
      "--branch",
      "main",
      "--single-branch",
      "git@github.com:leanish/sqs-codec.git",
      "/workspace/repos/sqs-codec"
    ], expect.objectContaining({
      stdio: ["ignore", "pipe", "pipe"]
    }));
  });

  it("updates existing repos and reports them as updated", async () => {
    mocks.access.mockResolvedValue();
    mocks.spawn
      .mockReturnValueOnce(createSuccessfulChild())
      .mockReturnValueOnce(createSuccessfulChild())
      .mockReturnValueOnce(createSuccessfulChild());

    const report = await syncRepos([
      {
        name: "sqs-codec",
        url: "git@github.com:leanish/sqs-codec.git",
        directory: "/workspace/repos/sqs-codec",
        defaultBranch: "main"
      }
    ]);

    expect(report).toEqual([
      {
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "updated",
        detail: "main"
      }
    ]);
    expect(mocks.spawn.mock.calls.map(call => call[1])).toEqual([
      ["-C", "/workspace/repos/sqs-codec", "fetch", "origin", "main"],
      ["-C", "/workspace/repos/sqs-codec", "checkout", "main"],
      ["-C", "/workspace/repos/sqs-codec", "merge", "--ff-only", "origin/main"]
    ]);
  });

  it("records failures instead of throwing for individual repos", async () => {
    mocks.access.mockResolvedValue();
    mocks.spawn.mockReturnValue(createFailingChild("fetch failed"));

    const report = await syncRepos([
      {
        name: "sqs-codec",
        url: "git@github.com:leanish/sqs-codec.git",
        directory: "/workspace/repos/sqs-codec",
        defaultBranch: "main"
      }
    ]);

    expect(report).toEqual([
      {
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "failed",
        detail: "git -C /workspace/repos/sqs-codec fetch origin main failed: fetch failed"
      }
    ]);
  });

  it("normalizes missing git errors into an install hint", async () => {
    mocks.access.mockRejectedValueOnce(new Error("missing"));
    mocks.spawn.mockReturnValue(createErroringChild(
      Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" })
    ));

    const report = await syncRepos([
      {
        name: "sqs-codec",
        url: "git@github.com:leanish/sqs-codec.git",
        directory: "/workspace/repos/sqs-codec",
        defaultBranch: "main"
      }
    ]);

    expect(report).toEqual([
      {
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "failed",
        detail: 'Git CLI is required but was not found on PATH. Install it with "brew install git", then retry later.'
      }
    ]);
  });

  it("records unsupported trunk branches per repo and continues syncing others", async () => {
    mocks.access.mockRejectedValueOnce(new Error("missing"));
    mocks.spawn.mockReturnValue(createSuccessfulChild());

    const report = await syncRepos([
      {
        name: "sqs-codec",
        url: "git@github.com:leanish/sqs-codec.git",
        directory: "/workspace/repos/sqs-codec",
        defaultBranch: "develop"
      },
      {
        name: "java-conventions",
        url: "git@github.com:leanish/java-conventions.git",
        directory: "/workspace/repos/java-conventions",
        defaultBranch: "main"
      }
    ]);

    expect(report).toEqual([
      {
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "failed",
        detail: "Unsupported branch for managed repo sqs-codec: develop. Only main/master are supported."
      },
      {
        name: "java-conventions",
        directory: "/workspace/repos/java-conventions",
        action: "cloned",
        detail: "main"
      }
    ]);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });
});

function createSuccessfulChild() {
  return createChild({ exitCode: 0 });
}

function createFailingChild(stderr) {
  return createChild({ exitCode: 1, stderrChunks: [stderr] });
}

function createChild({ exitCode, stderrChunks = [] }) {
  const stderrHandlers = [];
  const closeHandlers = [];
  const errorHandlers = [];

  setTimeout(() => {
    stderrChunks.forEach(chunk => {
      stderrHandlers.forEach(handler => handler(Buffer.from(chunk)));
    });
    closeHandlers.forEach(handler => handler(exitCode));
  }, 0);

  return {
    stderr: {
      on: vi.fn((event, handler) => {
        if (event === "data") {
          stderrHandlers.push(handler);
        }
      })
    },
    on: vi.fn((event, handler) => {
      if (event === "close") {
        closeHandlers.push(handler);
      }
      if (event === "error") {
        errorHandlers.push(handler);
      }
    }),
    emitError(error) {
      errorHandlers.forEach(handler => handler(error));
    }
  };
}

function createErroringChild(error) {
  const stderrHandlers = [];
  const closeHandlers = [];
  const errorHandlers = [];

  setTimeout(() => {
    errorHandlers.forEach(handler => handler(error));
  }, 0);

  return {
    stderr: {
      on: vi.fn((event, handler) => {
        if (event === "data") {
          stderrHandlers.push(handler);
        }
      })
    },
    on: vi.fn((event, handler) => {
      if (event === "close") {
        closeHandlers.push(handler);
      }
      if (event === "error") {
        errorHandlers.push(handler);
      }
    })
  };
}
