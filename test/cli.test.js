import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  loadConfig: vi.fn(),
  initializeConfig: vi.fn(),
  applyGithubDiscoveryToConfig: vi.fn(),
  discoverGithubOwnerRepos: vi.fn(),
  planGithubRepoDiscovery: vi.fn(),
  promptGithubDiscoverySelection: vi.fn(),
  selectGithubDiscoveryRepos: vi.fn(),
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
  initializeConfig: mocks.initializeConfig,
  applyGithubDiscoveryToConfig: mocks.applyGithubDiscoveryToConfig
}));

vi.mock("../src/config-paths.js", () => ({
  getConfigPath: mocks.getConfigPath
}));

vi.mock("../src/github-catalog.js", () => ({
  discoverGithubOwnerRepos: mocks.discoverGithubOwnerRepos,
  planGithubRepoDiscovery: mocks.planGithubRepoDiscovery
}));

vi.mock("../src/github-discovery-selection.js", () => ({
  promptGithubDiscoverySelection: mocks.promptGithubDiscoverySelection,
  selectGithubDiscoveryRepos: mocks.selectGithubDiscoveryRepos
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
      configPath: "/tmp/archa-config.json",
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
    mocks.discoverGithubOwnerRepos.mockResolvedValue({
      owner: "leanish",
      ownerType: "User",
      repos: [],
      skippedForks: 0,
      skippedArchived: 0
    });
    mocks.planGithubRepoDiscovery.mockReturnValue({
      owner: "leanish",
      ownerType: "User",
      skippedForks: 0,
      skippedArchived: 0,
      entries: [],
      reposToAdd: [],
      counts: {
        discovered: 0,
        configured: 0,
        new: 0,
        conflicts: 0,
        withSuggestions: 0
      }
    });
    mocks.promptGithubDiscoverySelection.mockResolvedValue({
      reposToAdd: [],
      reposToOverride: []
    });
    mocks.selectGithubDiscoveryRepos.mockReturnValue({
      reposToAdd: [],
      reposToOverride: []
    });
    mocks.applyGithubDiscoveryToConfig.mockResolvedValue({
      configPath: "/tmp/archa-config.json",
      addedCount: 0,
      overriddenCount: 0,
      totalCount: 1
    });
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

  it("prints a GitHub discovery preview without changing config", async () => {
    mocks.discoverGithubOwnerRepos.mockResolvedValue({
      owner: "leanish",
      ownerType: "User",
      skippedForks: 1,
      skippedArchived: 0,
      repos: [
        {
          name: "archa",
          url: "https://github.com/leanish/archa.git",
          defaultBranch: "main",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          topics: ["cli", "codex", "qa"]
        }
      ]
    });
    mocks.planGithubRepoDiscovery.mockReturnValue({
      owner: "leanish",
      ownerType: "User",
      skippedForks: 1,
      skippedArchived: 0,
      entries: [
        {
          status: "new",
          repo: {
            name: "archa",
            topics: ["cli", "codex", "qa"],
            description: "Repo-aware CLI for engineering Q&A with local Codex"
          },
          suggestions: []
        }
      ],
      reposToAdd: [
        {
          name: "archa",
          url: "https://github.com/leanish/archa.git",
          defaultBranch: "main",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          topics: ["cli", "codex", "qa"]
        }
      ],
      counts: {
        discovered: 1,
        configured: 0,
        new: 1,
        conflicts: 0,
        withSuggestions: 0
      }
    });

    await main(["config", "discover-github", "--owner", "leanish"]);

    expect(stdout.join("")).toContain("GitHub repo discovery for leanish (User):");
    expect(stdout.join("")).toContain("archa [new]");
    expect(stdout.join("")).toContain("Run: archa config discover-github --owner leanish --apply");
    expect(mocks.applyGithubDiscoveryToConfig).not.toHaveBeenCalled();
  });

  it("applies interactively selected repo changes when requested", async () => {
    const reposToAdd = [
      {
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects",
        topics: ["gradle", "java"]
      }
    ];
    mocks.planGithubRepoDiscovery.mockReturnValue({
      owner: "leanish",
      ownerType: "Organization",
      skippedForks: 0,
      skippedArchived: 0,
      entries: [
        {
          status: "new",
          repo: {
            name: "java-conventions",
            topics: ["gradle", "java"],
            description: "Shared Gradle conventions for JDK-based projects"
          },
          suggestions: []
        }
      ],
      counts: {
        discovered: 1,
        configured: 0,
        new: 1,
        conflicts: 0,
        withSuggestions: 0
      }
    });
    mocks.promptGithubDiscoverySelection.mockResolvedValue({
      reposToAdd,
      reposToOverride: []
    });
    mocks.applyGithubDiscoveryToConfig.mockResolvedValue({
      configPath: "/tmp/archa-config.json",
      addedCount: 1,
      overriddenCount: 0,
      totalCount: 2
    });

    await main(["config", "discover-github", "--owner", "leanish", "--apply"]);

    expect(mocks.promptGithubDiscoverySelection).toHaveBeenCalled();
    expect(mocks.applyGithubDiscoveryToConfig).toHaveBeenCalledWith({
      env: process.env,
      reposToAdd,
      reposToOverride: []
    });
    expect(stdout.join("")).toContain("Config updated: /tmp/archa-config.json");
    expect(stdout.join("")).toContain("Repos added: 1");
  });

  it("applies explicit add and override selections without prompting", async () => {
    const reposToAdd = [
      {
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects",
        topics: ["gradle", "java"]
      }
    ];
    const reposToOverride = [
      {
        name: "sqs-codec",
        url: "https://github.com/leanish/sqs-codec.git",
        defaultBranch: "main",
        description: "Updated description",
        topics: ["aws", "sqs"]
      }
    ];
    mocks.planGithubRepoDiscovery.mockReturnValue({
      owner: "leanish",
      ownerType: "Organization",
      skippedForks: 0,
      skippedArchived: 0,
      entries: [
        {
          status: "new",
          repo: reposToAdd[0],
          suggestions: []
        },
        {
          status: "configured",
          repo: reposToOverride[0],
          suggestions: ["review description"]
        }
      ],
      counts: {
        discovered: 2,
        configured: 1,
        new: 1,
        conflicts: 0,
        withSuggestions: 1
      }
    });
    mocks.selectGithubDiscoveryRepos.mockReturnValue({
      reposToAdd,
      reposToOverride
    });
    mocks.applyGithubDiscoveryToConfig.mockResolvedValue({
      configPath: "/tmp/archa-config.json",
      addedCount: 1,
      overriddenCount: 1,
      totalCount: 2
    });

    await main([
      "config",
      "discover-github",
      "--owner",
      "leanish",
      "--apply",
      "--add",
      "java-conventions",
      "--override",
      "sqs-codec"
    ]);

    expect(mocks.selectGithubDiscoveryRepos).toHaveBeenCalledWith(expect.any(Object), {
      addRepoNames: ["java-conventions"],
      overrideRepoNames: ["sqs-codec"]
    });
    expect(mocks.promptGithubDiscoverySelection).not.toHaveBeenCalled();
    expect(mocks.applyGithubDiscoveryToConfig).toHaveBeenCalledWith({
      env: process.env,
      reposToAdd,
      reposToOverride
    });
    expect(stdout.join("")).toContain("Repos overridden: 1");
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
