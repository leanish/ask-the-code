import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  loadConfig: vi.fn(),
  initializeConfig: vi.fn(),
  answerQuestion: vi.fn(),
  syncRepos: vi.fn(),
  getConfigPath: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mocks.readFile
  }
}));

vi.mock("../src/config.js", () => ({
  loadConfig: mocks.loadConfig,
  initializeConfig: mocks.initializeConfig
}));

vi.mock("../src/config-paths.js", () => ({
  getConfigPath: mocks.getConfigPath
}));

vi.mock("../src/question-answering.js", () => ({
  answerQuestion: mocks.answerQuestion
}));

vi.mock("../src/repo-sync.js", () => ({
  syncRepos: mocks.syncRepos
}));

import { main } from "../src/cli.js";

describe("cli", () => {
  let stdout;
  let stderr;
  let originalStdoutWrite;
  let originalStderrWrite;

  beforeEach(() => {
    vi.clearAllMocks();
    stdout = [];
    stderr = [];
    originalStdoutWrite = process.stdout.write;
    originalStderrWrite = process.stderr.write;
    process.stdout.write = vi.fn(chunk => {
      stdout.push(chunk);
      return true;
    });
    process.stderr.write = vi.fn(chunk => {
      stderr.push(chunk);
      return true;
    });
    mocks.getConfigPath.mockReturnValue("/tmp/archa-config.json");
    mocks.loadConfig.mockResolvedValue({
      repos: [
        {
          name: "sqs-codec",
          aliases: ["codec"],
          directory: "/workspace/repos/sqs-codec",
          defaultBranch: "main",
          description: "SQS execution interceptor with compression and checksum metadata"
        }
      ]
    });
    mocks.syncRepos.mockResolvedValue([
      {
        name: "sqs-codec",
        action: "updated",
        detail: "main"
      }
    ]);
    mocks.answerQuestion.mockResolvedValue({
      mode: "answer",
      selectedRepos: [
        {
          name: "sqs-codec"
        }
      ],
      syncReport: [
        {
          name: "sqs-codec",
          action: "updated",
          detail: "main"
        }
      ],
      synthesis: {
        text: "Final answer"
      }
    });
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  it("prints the sync report for repos sync", async () => {
    await main(["repos", "sync"]);

    expect(stdout.join("")).toContain("Sync report:");
    expect(stdout.join("")).toContain("sqs-codec: updated (main)");
  });

  it("fails repos sync when any selected repo failed to sync", async () => {
    mocks.syncRepos.mockResolvedValue([
      {
        name: "sqs-codec",
        action: "failed",
        detail: "git fetch failed"
      }
    ]);

    await expect(main(["repos", "sync"])).rejects.toThrow(
      "Failed to sync managed repo(s): sqs-codec (git fetch failed)"
    );
  });

  it("reads the question file before asking", async () => {
    mocks.readFile.mockResolvedValue("What is x-codec-meta?");

    await main(["--question-file", "/tmp/question.txt"]);

    expect(mocks.answerQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "What is x-codec-meta?"
      }),
      expect.objectContaining({
        env: process.env,
        statusReporter: expect.any(Object)
      })
    );
  });

  it("prints the active config path", async () => {
    await main(["config", "path"]);

    expect(stdout.join("")).toBe("/tmp/archa-config.json\n");
  });

  it("prints initialized config details", async () => {
    mocks.initializeConfig.mockResolvedValue({
      configPath: "/tmp/archa-config.json",
      managedReposRoot: "/workspace/repos",
      repoCount: 2
    });

    await main(["config", "init", "--force"]);

    expect(stdout.join("")).toContain("Initialized config at /tmp/archa-config.json");
    expect(stdout.join("")).toContain("Managed repos root: /workspace/repos");
    expect(stdout.join("")).toContain("Repos imported: 2");
  });

  it("prints the repo list", async () => {
    await main(["repos", "list"]);

    expect(stdout.join("")).toContain("Managed repos:");
    expect(stdout.join("")).toContain("sqs-codec [missing] main: aliases=codec SQS execution interceptor with compression and checksum metadata");
  });

  it("throws for unknown requested repos during sync", async () => {
    await expect(main(["repos", "sync", "missing-repo"])).rejects.toThrow(
      "Unknown managed repo(s): missing-repo"
    );
  });

  it("renders retrieval-only ask results", async () => {
    mocks.answerQuestion.mockResolvedValue({
      mode: "retrieval-only",
      question: "How does x-codec-meta work?",
      selectedRepos: [{ name: "sqs-codec" }],
      syncReport: [{ name: "sqs-codec", action: "skipped" }]
    });

    await main(["How", "does", "x-codec-meta", "work?"]);

    expect(stdout.join("")).toContain("Question: How does x-codec-meta work?");
    expect(stdout.join("")).toContain("Selected repos: sqs-codec");
  });
});
