import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubDiscoveryPlan, GithubDiscoverySelection } from "../src/core/types.ts";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  canPromptInteractively: vi.fn(),
  promptToInitializeConfig: vi.fn(),
  promptToContinueGithubDiscovery: vi.fn(),
  promptForGithubOwner: vi.fn(),
  ensureInteractiveConfigSetup: vi.fn(),
  renderConfigInit: vi.fn(),
  ensureCodexInstalled: vi.fn(),
  ensureGitInstalled: vi.fn(),
  ensureGithubDiscoveryAuthAvailable: vi.fn(),
  loadConfig: vi.fn(),
  initializeConfig: vi.fn(),
  applyGithubDiscoveryToConfig: vi.fn(),
  buildAppliedGithubDiscoveryEntries: vi.fn(),
  discoverGithubOwnerRepos: vi.fn(),
  getGithubDiscoveryRepoKey: vi.fn(),
  planGithubRepoDiscovery: vi.fn(),
  refineDiscoveredGithubRepos: vi.fn(),
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

vi.mock("../src/cli/setup/bootstrap.ts", () => ({
  canPromptInteractively: mocks.canPromptInteractively,
  promptToInitializeConfig: mocks.promptToInitializeConfig,
  promptToContinueGithubDiscovery: mocks.promptToContinueGithubDiscovery,
  promptForGithubOwner: mocks.promptForGithubOwner,
  ensureInteractiveConfigSetup: mocks.ensureInteractiveConfigSetup,
  renderConfigInit: mocks.renderConfigInit
}));

vi.mock("../src/core/config/config.ts", () => ({
  loadConfig: mocks.loadConfig,
  initializeConfig: mocks.initializeConfig,
  applyGithubDiscoveryToConfig: mocks.applyGithubDiscoveryToConfig
}));

vi.mock("../src/core/codex/codex-installation.ts", () => ({
  ensureCodexInstalled: mocks.ensureCodexInstalled
}));

vi.mock("../src/core/git/git-installation.ts", () => ({
  ensureGitInstalled: mocks.ensureGitInstalled
}));

vi.mock("../src/core/discovery/github-discovery-auth.ts", () => ({
  ensureGithubDiscoveryAuthAvailable: mocks.ensureGithubDiscoveryAuthAvailable
}));

vi.mock("../src/core/config/config-paths.ts", () => ({
  getConfigPath: mocks.getConfigPath
}));

vi.mock("../src/core/discovery/github-catalog.ts", () => ({
  buildAppliedGithubDiscoveryEntries: mocks.buildAppliedGithubDiscoveryEntries,
  discoverGithubOwnerRepos: mocks.discoverGithubOwnerRepos,
  getGithubDiscoveryRepoKey: mocks.getGithubDiscoveryRepoKey,
  planGithubRepoDiscovery: mocks.planGithubRepoDiscovery,
  refineDiscoveredGithubRepos: mocks.refineDiscoveredGithubRepos
}));

vi.mock("../src/cli/setup/discovery-selection.ts", () => ({
  promptGithubDiscoverySelection: mocks.promptGithubDiscoverySelection,
  selectGithubDiscoveryRepos: mocks.selectGithubDiscoveryRepos
}));

vi.mock("../src/core/answer/question-answering.ts", () => ({
  answerQuestion: mocks.answerQuestion
}));

vi.mock("../src/core/repos/repo-sync.ts", () => ({
  syncRepos: mocks.syncRepos
}));

import { main } from "../src/cli/main.ts";
import { createAnswerResult, createManagedRepo, createLoadedConfig } from "./test-helpers.ts";

describe("cli", () => {
  let stdout: string[];
  let stderr: string[];
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;
  let originalStderrIsTTYDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    stdout = [];
    stderr = [];
    originalStdoutWrite = process.stdout.write;
    originalStderrWrite = process.stderr.write;
    originalStderrIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    process.stdout.write = vi.fn(chunk => {
      stdout.push(chunk);
      return true;
    });
    process.stderr.write = vi.fn(chunk => {
      stderr.push(chunk);
      return true;
    });
    mocks.getConfigPath.mockReturnValue("/tmp/atc-config.json");
    mocks.ensureCodexInstalled.mockImplementation(() => {});
    mocks.ensureGitInstalled.mockImplementation(() => {});
    mocks.ensureGithubDiscoveryAuthAvailable.mockImplementation(() => {});
    mocks.getGithubDiscoveryRepoKey.mockImplementation((repo: { sourceFullName?: string; name: string }) => repo.sourceFullName || repo.name);
    mocks.buildAppliedGithubDiscoveryEntries.mockImplementation((plan: GithubDiscoveryPlan, selection: GithubDiscoverySelection) => [
      ...selection.reposToAdd.map(repo => plan.entries.find(entry => entry.repo === repo) || {
        repo,
        status: "new",
        suggestions: []
      }),
      ...selection.reposToOverride.map(repo => plan.entries.find(entry => entry.repo === repo) || {
        repo,
        status: "configured",
        suggestions: []
      })
    ]);
    mocks.refineDiscoveredGithubRepos.mockResolvedValue({
      owner: "leanish",
      ownerType: "Organization",
      skippedForks: 0,
      skippedArchived: 0,
      repos: []
    });
    mocks.canPromptInteractively.mockReturnValue(true);
    mocks.promptToInitializeConfig.mockResolvedValue(true);
    mocks.promptToContinueGithubDiscovery.mockResolvedValue(false);
    mocks.promptForGithubOwner.mockResolvedValue("leanish");
    mocks.ensureInteractiveConfigSetup.mockResolvedValue(true);
    mocks.renderConfigInit.mockImplementation((result, options = {}) => {
      const lines = [
        `Initialized config at ${result.configPath}`,
        `Managed repos root: ${result.managedReposRoot}`,
        `Repos imported: ${result.repoCount}`
      ];

      if (options.includeNextStepSuggestion !== false && result.repoCount === 0) {
        lines.push("");
        lines.push("Next step: atc config discover-github");
        lines.push("That imports GitHub metadata plus curated descriptions, topics, and classifications into your config.");
      }

      return lines.join("\n");
    });
    mocks.loadConfig.mockResolvedValue(createLoadedConfig({
      configPath: "/tmp/atc-config.json",
      repos: [
        createManagedRepo({
          name: "sqs-codec",
          aliases: ["codec"],
          directory: "/workspace/repos/sqs-codec",
          defaultBranch: "main",
          description: "SQS execution interceptor with compression and checksum metadata"
        })
      ]
    }));
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
      configPath: "/tmp/atc-config.json",
      addedCount: 0,
      overriddenCount: 0,
      totalCount: 1
    });
    mocks.answerQuestion.mockResolvedValue(createAnswerResult({
      question: "ignored",
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
    }));
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;

    if (originalStderrIsTTYDescriptor) {
      Object.defineProperty(process.stderr, "isTTY", originalStderrIsTTYDescriptor);
    } else {
      Object.defineProperty(process.stderr, "isTTY", {
        configurable: true,
        enumerable: true,
        value: undefined,
        writable: true
      });
    }
  });

  it("prints the sync report for repos sync", async () => {
    await main(["repos", "sync"]);

    expect(stdout.join("")).toContain("Sync report:");
    expect(stdout.join("")).toContain("sqs-codec: updated (main)");
    expect(mocks.ensureGitInstalled).toHaveBeenCalled();
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
    expect(mocks.ensureCodexInstalled).toHaveBeenCalled();
    expect(mocks.ensureGitInstalled).toHaveBeenCalled();
  });

  it("flushes interactive codex progress before printing the final answer", async () => {
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true
    });
    mocks.answerQuestion.mockImplementation(async (_options, { statusReporter }) => {
      statusReporter.info("Running Codex...");
      statusReporter.info("Running Codex... 5s elapsed");
      statusReporter.info("Running Codex... done in 5s");

      return {
        mode: "answer",
        selectedRepos: [{ name: "sqs-codec" }],
        syncReport: [],
        synthesis: {
          text: "Final answer"
        }
      };
    });

    await main(["What", "is", "x-codec-meta?"]);

    expect(stderr.join("")).toBe(
      "[ask-the-code] Running Codex...\r\x1b[2K[ask-the-code] Running Codex... 5s elapsed\r\x1b[2K[ask-the-code] Running Codex... done in 5s\n"
    );
    expect(stdout.join("")).toContain("Final answer");
  });

  it("does not require Codex for retrieval-only ask mode", async () => {
    mocks.answerQuestion.mockResolvedValue({
      mode: "retrieval-only",
      question: "What is x-codec-meta?",
      selectedRepos: [{ name: "sqs-codec" }],
      syncReport: []
    });

    await main(["--no-synthesis", "What", "is", "x-codec-meta?"]);

    expect(mocks.ensureCodexInstalled).not.toHaveBeenCalled();
    expect(mocks.ensureGitInstalled).toHaveBeenCalled();
  });

  it("does not require Git for no-sync retrieval-only ask mode", async () => {
    mocks.answerQuestion.mockResolvedValue({
      mode: "retrieval-only",
      question: "What is x-codec-meta?",
      selectedRepos: [{ name: "sqs-codec" }],
      syncReport: []
    });

    await main(["--no-sync", "--no-synthesis", "What", "is", "x-codec-meta?"]);

    expect(mocks.ensureCodexInstalled).not.toHaveBeenCalled();
    expect(mocks.ensureGitInstalled).not.toHaveBeenCalled();
  });

  it("prints the active config path", async () => {
    await main(["config", "path"]);

    expect(stdout.join("")).toBe("/tmp/atc-config.json\n");
  });

  it("prints initialized config details", async () => {
    mocks.initializeConfig.mockResolvedValue({
      configPath: "/tmp/atc-config.json",
      managedReposRoot: "/workspace/repos",
      repoCount: 2
    });

    await main(["config", "init", "--force"]);

    expect(stdout.join("")).toContain("Initialized config at /tmp/atc-config.json");
    expect(stdout.join("")).toContain("Managed repos root: /workspace/repos");
    expect(stdout.join("")).toContain("Repos imported: 2");
  });

  it("suggests GitHub discovery when config init creates an empty repo list", async () => {
    mocks.initializeConfig.mockResolvedValue({
      configPath: "/tmp/atc-config.json",
      managedReposRoot: "/workspace/repos",
      repoCount: 0
    });

    await main(["config", "init"]);

    expect(stdout.join("")).toContain("Initialized config at /tmp/atc-config.json");
    expect(stdout.join("")).toContain("Repos imported: 0");
    expect(stdout.join("")).toContain(
      "Next step: atc config discover-github"
    );
    expect(stdout.join("")).toContain(
      "That imports GitHub metadata plus curated descriptions, topics, and classifications into your config."
    );
  });

  it("does not continue when shared bootstrap declines", async () => {
    mocks.ensureInteractiveConfigSetup.mockResolvedValue(false);

    await main(["How", "does", "x-codec-meta", "work?"]);

    expect(mocks.answerQuestion).not.toHaveBeenCalled();
  });

  it("continues normal execution when shared bootstrap succeeds", async () => {
    await main(["How", "does", "x-codec-meta", "work?"]);

    expect(mocks.answerQuestion).toHaveBeenCalled();
  });

  it("prints the repo list", async () => {
    await main(["repos", "list"]);

    expect(stdout.join("")).toContain("Managed repos:");
    expect(stdout.join("")).toContain("sqs-codec [missing] main aliases=codec SQS execution interceptor with compression and checksum metadata");
  });

  it("prints an unchanged discovery summary when nothing is selected", async () => {
    mocks.discoverGithubOwnerRepos.mockImplementation(async ({ onProgress }) => {
      onProgress?.({
        type: "discovery-listed",
        owner: "leanish",
        discoveredCount: 2,
        eligibleCount: 1,
        inspectRepos: false,
        hydrateMetadata: false,
        skippedForks: 1,
        skippedArchived: 0
      });

      return {
        owner: "leanish",
        ownerType: "User",
        skippedForks: 1,
        skippedArchived: 0,
        repos: [
          {
            name: "ask-the-code",
            url: "https://github.com/leanish/ask-the-code.git",
            defaultBranch: "main",
            description: "Repo-aware CLI for engineering Q&A with local Codex",
            topics: ["cli", "codex", "qa"]
          }
        ]
      };
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
            name: "ask-the-code",
            topics: ["cli", "codex", "qa"],
            description: "Repo-aware CLI for engineering Q&A with local Codex"
          },
          suggestions: []
        }
      ],
      reposToAdd: [
        {
          name: "ask-the-code",
          url: "https://github.com/leanish/ask-the-code.git",
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
    expect(stdout.join("")).toContain("Repos selected: 0");
    expect(stdout.join("")).toContain("Config unchanged: /tmp/atc-config.json");
    expect(stderr.join("")).toContain("Discovering GitHub repos for leanish...");
    expect(stderr.join("")).toContain("Found 2 repo(s); ready to choose from 1 eligible repo(s).");
    expect(mocks.applyGithubDiscoveryToConfig).not.toHaveBeenCalled();
    expect(mocks.ensureCodexInstalled).toHaveBeenCalled();
    expect(mocks.ensureGitInstalled).toHaveBeenCalled();
    expect(mocks.ensureGithubDiscoveryAuthAvailable).toHaveBeenCalled();
    expect(mocks.discoverGithubOwnerRepos).toHaveBeenCalledWith(expect.objectContaining({
      inspectRepos: false,
      hydrateMetadata: false,
      curateWithCodex: false
    }));
  });

  it("requires Codex before GitHub discovery", async () => {
    mocks.discoverGithubOwnerRepos.mockResolvedValue({
      owner: "leanish",
      ownerType: "User",
      skippedForks: 0,
      skippedArchived: 0,
      repos: []
    });

    await main(["config", "discover-github", "--owner", "leanish"]);

    expect(mocks.ensureCodexInstalled).toHaveBeenCalled();
    expect(mocks.ensureGitInstalled).toHaveBeenCalled();
    expect(mocks.ensureGithubDiscoveryAuthAvailable).toHaveBeenCalled();
  });

  it("prompts for the GitHub owner when discovery omits --owner on a TTY", async () => {
    mocks.canPromptInteractively.mockReturnValue(true);
    mocks.promptForGithubOwner.mockResolvedValue("leanish");
    mocks.discoverGithubOwnerRepos.mockResolvedValue({
      owner: "leanish",
      ownerType: "User",
      skippedForks: 0,
      skippedArchived: 0,
      repos: []
    });
    mocks.planGithubRepoDiscovery.mockReturnValue({
      owner: "leanish",
      ownerType: "User",
      skippedForks: 0,
      skippedArchived: 0,
      entries: [],
      counts: {
        discovered: 0,
        configured: 0,
        new: 0,
        conflicts: 0,
        withSuggestions: 0
      }
    });

    await main(["config", "discover-github"]);

    expect(mocks.promptForGithubOwner).toHaveBeenCalledWith({
      input: process.stdin,
      output: process.stdout
    });
    expect(mocks.discoverGithubOwnerRepos).toHaveBeenCalledWith(expect.objectContaining({
      owner: "leanish"
    }));
    expect(stderr.join("")).toContain("Discovering GitHub repos for leanish...");
  });

  it("cancels discovery when the interactive GitHub owner prompt is cancelled", async () => {
    mocks.canPromptInteractively.mockReturnValue(true);
    mocks.promptForGithubOwner.mockResolvedValue(null);

    await main(["config", "discover-github"]);

    expect(mocks.promptForGithubOwner).toHaveBeenCalledWith({
      input: process.stdin,
      output: process.stdout
    });
    expect(mocks.discoverGithubOwnerRepos).not.toHaveBeenCalled();
    expect(stdout.join("")).toContain("GitHub discovery cancelled.");
  });

  it("defaults discovery to @accessible when --owner is omitted outside a TTY", async () => {
    mocks.canPromptInteractively.mockReturnValue(false);
    mocks.discoverGithubOwnerRepos.mockResolvedValue({
      owner: "@accessible",
      ownerType: "Accessible",
      skippedForks: 0,
      skippedArchived: 0,
      repos: []
    });
    mocks.planGithubRepoDiscovery.mockReturnValue({
      owner: "@accessible",
      ownerType: "Accessible",
      skippedForks: 0,
      skippedArchived: 0,
      entries: [],
      counts: {
        discovered: 0,
        configured: 0,
        new: 0,
        conflicts: 0,
        withSuggestions: 0
      }
    });

    await main(["config", "discover-github"]);

    expect(mocks.promptForGithubOwner).not.toHaveBeenCalled();
    expect(mocks.discoverGithubOwnerRepos).toHaveBeenCalledWith(expect.objectContaining({
      owner: "@accessible"
    }));
    expect(stderr.join("")).toContain("Discovering accessible GitHub repos...");
  });

  it("applies interactively selected repo changes", async () => {
    const reposToAdd = [
      {
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects",
        topics: ["gradle", "java"]
      }
    ];
    mocks.discoverGithubOwnerRepos
      .mockImplementationOnce(async ({ onProgress }) => {
        onProgress?.({
          type: "discovery-listed",
          owner: "leanish",
          discoveredCount: 1,
          eligibleCount: 1,
          inspectRepos: false,
          hydrateMetadata: false,
          skippedForks: 0,
          skippedArchived: 0
        });
        return {
          owner: "leanish",
          ownerType: "Organization",
          skippedForks: 0,
          skippedArchived: 0,
          repos: reposToAdd
        };
      });
    mocks.refineDiscoveredGithubRepos.mockImplementationOnce(async ({ onProgress, selectedRepoNames }) => {
        expect(selectedRepoNames).toEqual(["java-conventions"]);
        onProgress?.({
          type: "discovery-listed",
          owner: "leanish",
          discoveredCount: 1,
          eligibleCount: 1,
          inspectRepos: true,
          hydrateMetadata: true,
          skippedForks: 0,
          skippedArchived: 0
        });
        onProgress?.({
          type: "repo-hydrated",
          inspectRepos: true,
          owner: "leanish",
          repoName: "java-conventions",
          processedCount: 1,
          totalCount: 1
        });
        return {
          owner: "leanish",
          ownerType: "Organization",
          skippedForks: 0,
          skippedArchived: 0,
          repos: reposToAdd
        };
      });
    mocks.planGithubRepoDiscovery
      .mockReturnValue({
        owner: "leanish",
        ownerType: "Organization",
        skippedForks: 0,
        skippedArchived: 0,
        entries: [
          {
            status: "new",
            repo: reposToAdd[0],
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
    mocks.selectGithubDiscoveryRepos.mockReturnValue({
      reposToAdd,
      reposToOverride: []
    });
    mocks.applyGithubDiscoveryToConfig.mockResolvedValue({
      configPath: "/tmp/atc-config.json",
      addedCount: 1,
      overriddenCount: 0,
      totalCount: 2
    });

    await main(["config", "discover-github", "--owner", "leanish"]);

    expect(mocks.ensureCodexInstalled).toHaveBeenCalled();
    expect(mocks.ensureGitInstalled).toHaveBeenCalled();
    expect(mocks.ensureGithubDiscoveryAuthAvailable).toHaveBeenCalled();
    expect(mocks.promptGithubDiscoverySelection).toHaveBeenCalled();
    expect(mocks.discoverGithubOwnerRepos).toHaveBeenNthCalledWith(1, expect.objectContaining({
      inspectRepos: false,
      hydrateMetadata: false,
      curateWithCodex: false
    }));
    expect(mocks.refineDiscoveredGithubRepos).toHaveBeenCalledWith(expect.objectContaining({
      discovery: expect.objectContaining({
        owner: "leanish"
      }),
      inspectRepos: true,
      curateWithCodex: true,
      selectedRepoNames: ["java-conventions"]
    }));
    expect(mocks.applyGithubDiscoveryToConfig).toHaveBeenCalledTimes(1);
    expect(mocks.applyGithubDiscoveryToConfig).toHaveBeenCalledWith({
      env: process.env,
      reposToAdd: [reposToAdd[0]],
      reposToOverride: []
    });
    expect(stderr.join("")).toContain("Found 1 repo(s); ready to choose from 1 eligible repo(s).");
    expect(stderr.join("")).toContain("Curating repos: 1/1 (java-conventions)");
    expect(stdout.join("")).toContain("Config updated: /tmp/atc-config.json");
    expect(stdout.join("")).toContain("Repos added: 1");
  });

  it("does not reload config before planning the applied discovery summary", async () => {
    const selectedRepo = {
      name: "java-conventions",
      url: "https://github.com/leanish/java-conventions.git",
      defaultBranch: "main",
      description: "Shared Gradle conventions",
      topics: ["gradle"],
      classifications: ["library"]
    };
    const initialConfig = {
      configPath: "/tmp/atc-config.json",
      repos: []
    };

    mocks.loadConfig
      .mockReset()
      .mockResolvedValueOnce(initialConfig);
    mocks.discoverGithubOwnerRepos.mockResolvedValueOnce({
      owner: "leanish",
      ownerType: "Organization",
      skippedForks: 0,
      skippedArchived: 0,
      repos: [selectedRepo]
    });
    mocks.planGithubRepoDiscovery.mockImplementation((
      config: { repos: Array<{ name: string }> },
      discovery: {
        owner: string;
        ownerType: string;
        skippedForks: number;
        skippedArchived: number;
        repos: Array<{ name: string }>;
      }
    ) => ({
      owner: discovery.owner,
      ownerType: discovery.ownerType,
      skippedForks: discovery.skippedForks,
      skippedArchived: discovery.skippedArchived,
      entries: discovery.repos.map(repo => ({
        repo,
        status: config.repos.length === 0 ? "new" : "configured",
        configuredRepo: config.repos.find(candidate => candidate.name === repo.name) || null,
        suggestions: []
      })),
      reposToAdd: config.repos.length === 0 ? discovery.repos : [],
      counts: {
        discovered: discovery.repos.length,
        configured: 0,
        new: discovery.repos.length,
        conflicts: 0,
        withSuggestions: 0
      }
    }));
    mocks.promptGithubDiscoverySelection.mockResolvedValue({
      reposToAdd: [selectedRepo],
      reposToOverride: []
    });
    mocks.refineDiscoveredGithubRepos.mockImplementationOnce(async () => {
      return {
        owner: "leanish",
        ownerType: "Organization",
        skippedForks: 0,
        skippedArchived: 0,
        repos: [selectedRepo]
      };
    });

    await main(["config", "discover-github", "--owner", "leanish"]);

    expect(mocks.loadConfig).toHaveBeenCalledTimes(1);
    expect(mocks.planGithubRepoDiscovery).toHaveBeenNthCalledWith(2, initialConfig, expect.objectContaining({
      owner: "leanish"
    }));
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
    mocks.discoverGithubOwnerRepos
      .mockResolvedValueOnce({
        owner: "leanish",
        ownerType: "Organization",
        skippedForks: 0,
        skippedArchived: 0,
        repos: [...reposToAdd, ...reposToOverride]
      });
    mocks.refineDiscoveredGithubRepos.mockImplementationOnce(async ({ selectedRepoNames }) => {
        expect(selectedRepoNames).toEqual(["java-conventions", "sqs-codec"]);
        return {
          owner: "leanish",
          ownerType: "Organization",
          skippedForks: 0,
          skippedArchived: 0,
          repos: [...reposToAdd, ...reposToOverride]
        };
      });
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
      configPath: "/tmp/atc-config.json",
      addedCount: 1,
      overriddenCount: 1,
      totalCount: 2
    });

    await main([
      "config",
      "discover-github",
      "--owner",
      "leanish",
      "--add",
      "java-conventions",
      "--override",
      "sqs-codec"
    ]);

    expect(mocks.selectGithubDiscoveryRepos).toHaveBeenCalledWith(expect.any(Object), {
      addRepoNames: ["java-conventions"],
      overrideRepoNames: ["sqs-codec"]
    });
    expect(mocks.ensureGitInstalled).toHaveBeenCalled();
    expect(mocks.ensureGithubDiscoveryAuthAvailable).toHaveBeenCalled();
    expect(mocks.promptGithubDiscoverySelection).not.toHaveBeenCalled();
    expect(mocks.discoverGithubOwnerRepos).toHaveBeenNthCalledWith(1, expect.objectContaining({
      inspectRepos: false,
      hydrateMetadata: false,
      curateWithCodex: false
    }));
    expect(mocks.refineDiscoveredGithubRepos).toHaveBeenCalledWith(expect.objectContaining({
      discovery: expect.objectContaining({
        owner: "leanish"
      }),
      inspectRepos: true,
      curateWithCodex: true,
      selectedRepoNames: ["java-conventions", "sqs-codec"]
    }));
    expect(mocks.applyGithubDiscoveryToConfig).toHaveBeenCalledTimes(1);
    expect(mocks.applyGithubDiscoveryToConfig).toHaveBeenCalledWith({
      env: process.env,
      reposToAdd: [reposToAdd[0]],
      reposToOverride: [reposToOverride[0]]
    });
    expect(stdout.join("")).toContain("Repos overridden: 1");
  });

  it("fails discovery early when GitHub auth is unavailable", async () => {
    mocks.ensureGithubDiscoveryAuthAvailable.mockImplementation(() => {
      throw new Error("GitHub discovery requires either GH_TOKEN/GITHUB_TOKEN or a usable gh CLI session.");
    });

    await expect(main(["config", "discover-github", "--owner", "leanish"])).rejects.toThrow(
      "GitHub discovery requires either GH_TOKEN/GITHUB_TOKEN or a usable gh CLI session."
    );
    expect(mocks.discoverGithubOwnerRepos).not.toHaveBeenCalled();
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
