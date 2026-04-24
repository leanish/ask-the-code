import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubDiscoveryPlan, GithubDiscoverySelection } from "../src/core/types.ts";

const mocks = vi.hoisted(() => ({
  startHttpServer: vi.fn(),
  ensureInteractiveConfigSetup: vi.fn(),
  ensureCodexInstalled: vi.fn(),
  ensureGitInstalled: vi.fn(),
  ensureGithubDiscoveryAuthAvailable: vi.fn(),
  loadConfig: vi.fn(),
  applyGithubDiscoveryToConfig: vi.fn(),
  buildAppliedGithubDiscoveryEntries: vi.fn(),
  discoverGithubOwnerRepos: vi.fn(),
  getGithubDiscoveryRepoKey: vi.fn(),
  planGithubRepoDiscovery: vi.fn(),
  refineDiscoveredGithubRepos: vi.fn(),
  promptGithubDiscoverySelection: vi.fn(),
  renderGithubDiscovery: vi.fn()
}));

vi.mock("../src/server/api/http-server.ts", () => ({
  startHttpServer: mocks.startHttpServer
}));

vi.mock("../src/cli/setup/bootstrap.ts", () => ({
  ensureInteractiveConfigSetup: mocks.ensureInteractiveConfigSetup
}));

vi.mock("../src/core/config/config.ts", () => ({
  loadConfig: mocks.loadConfig,
  initializeConfig: vi.fn(),
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

vi.mock("../src/core/discovery/github-catalog.ts", () => ({
  buildAppliedGithubDiscoveryEntries: mocks.buildAppliedGithubDiscoveryEntries,
  discoverGithubOwnerRepos: mocks.discoverGithubOwnerRepos,
  getGithubDiscoveryRepoKey: mocks.getGithubDiscoveryRepoKey,
  planGithubRepoDiscovery: mocks.planGithubRepoDiscovery,
  refineDiscoveredGithubRepos: mocks.refineDiscoveredGithubRepos
}));

vi.mock("../src/cli/setup/discovery-selection.ts", () => ({
  promptGithubDiscoverySelection: mocks.promptGithubDiscoverySelection
}));

vi.mock("../src/cli/render.ts", () => ({
  renderGithubDiscovery: mocks.renderGithubDiscovery
}));

import { main, setupShutdownHandlers } from "../src/server/main.ts";
import { createGithubDiscoveryPlan, createLoadedConfig } from "./test-helpers.ts";

describe("server-main", () => {
  let stdout: string[];
  let stderr: string[];
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

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
      ownerType: "User",
      skippedForks: 0,
      skippedArchived: 0,
      repos: []
    });
    mocks.ensureInteractiveConfigSetup.mockResolvedValue(true);
    mocks.loadConfig.mockResolvedValue(createLoadedConfig({
      configPath: "/tmp/atc-config.json",
      repos: []
    }));
    mocks.discoverGithubOwnerRepos.mockResolvedValue({
      owner: "leanish",
      ownerType: "User",
      repos: [],
      skippedForks: 0,
      skippedArchived: 0
    });
    mocks.planGithubRepoDiscovery.mockReturnValue(createGithubDiscoveryPlan({
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
    }));
    mocks.promptGithubDiscoverySelection.mockResolvedValue({
      reposToAdd: [],
      reposToOverride: []
    });
    mocks.applyGithubDiscoveryToConfig.mockResolvedValue({
      configPath: "/tmp/atc-config.json",
      addedCount: 0,
      overriddenCount: 0
    });
    mocks.renderGithubDiscovery.mockReturnValue("discovery summary");
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  it("prints the listening url and suggests discovery when no repos are configured", async () => {
    const serverHandle = {
      url: "http://127.0.0.1:8787",
      configuredRepoCount: 0
    };
    mocks.startHttpServer.mockResolvedValue(serverHandle);

    const result = await main([]);

    expect(result).toBe(serverHandle);
    expect(mocks.ensureGitInstalled).toHaveBeenCalled();
    expect(mocks.ensureCodexInstalled).toHaveBeenCalled();
    expect(mocks.ensureInteractiveConfigSetup).toHaveBeenCalled();
    expect(stdout.join("")).toBe("ask-the-code server listening on http://127.0.0.1:8787\n");
    expect(stderr.join("")).toContain('Suggestion: run "atc config discover-github".');
  });

  it("does not print the discovery suggestion when repos are already configured", async () => {
    mocks.startHttpServer.mockResolvedValue({
      url: "http://127.0.0.1:8787",
      configuredRepoCount: 2
    });

    await main([]);

    expect(stderr.join("")).toBe("");
  });

  it("does not start the server when interactive setup is declined", async () => {
    mocks.ensureInteractiveConfigSetup.mockResolvedValue(false);

    const result = await main([]);

    expect(result).toBeNull();
    expect(mocks.startHttpServer).not.toHaveBeenCalled();
  });

  it("shows lightweight discovery progress before selection during interactive server bootstrap", async () => {
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
        repos: [],
        skippedForks: 1,
        skippedArchived: 0
      };
    });
    mocks.ensureInteractiveConfigSetup.mockImplementation(async ({ runDiscoveryFn }) => {
      await runDiscoveryFn({
        owner: "leanish",
        includeForks: true,
        includeArchived: false
      });
      return false;
    });

    const result = await main([]);

    expect(result).toBeNull();
    expect(stderr.join("")).toContain("Discovering GitHub repos for leanish...");
    expect(stderr.join("")).toContain("Found 2 repo(s); ready to choose from 1 eligible repo(s).");
    expect(mocks.ensureGithubDiscoveryAuthAvailable).toHaveBeenCalled();
    expect(stdout.join("")).toContain("discovery summary");
    expect(mocks.startHttpServer).not.toHaveBeenCalled();
  });

  it("curates only the selected repo subset during interactive server bootstrap", async () => {
    const selectedRepo = {
      name: "ask-the-code",
      url: "https://github.com/leanish/ask-the-code.git",
      defaultBranch: "main",
      description: "Repo-aware CLI for engineering Q&A with local Codex",
      topics: ["cli", "codex", "qa"]
    };
    mocks.discoverGithubOwnerRepos
      .mockImplementationOnce(async ({ onProgress }) => {
        onProgress?.({
          type: "discovery-listed",
          owner: "leanish",
          discoveredCount: 2,
          eligibleCount: 2,
          inspectRepos: false,
          hydrateMetadata: false,
          skippedForks: 0,
          skippedArchived: 0
        });
        return {
          owner: "leanish",
          ownerType: "User",
          repos: [selectedRepo, {
            name: "terminator",
            url: "https://github.com/leanish/terminator.git",
            defaultBranch: "main",
            description: "",
            topics: []
          }],
          skippedForks: 0,
          skippedArchived: 0
        };
      });
    mocks.refineDiscoveredGithubRepos.mockImplementationOnce(async ({ onProgress, selectedRepoNames }) => {
        expect(selectedRepoNames).toEqual(["ask-the-code"]);
        onProgress?.({
          type: "discovery-listed",
          owner: "leanish",
          discoveredCount: 2,
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
          repoName: "ask-the-code",
          processedCount: 1,
          totalCount: 1
        });

        return {
          owner: "leanish",
          ownerType: "User",
          repos: [selectedRepo],
          skippedForks: 0,
          skippedArchived: 0
        };
      });
    mocks.planGithubRepoDiscovery
      .mockReturnValueOnce({
        owner: "leanish",
        ownerType: "User",
        skippedForks: 0,
        skippedArchived: 0,
        entries: [
          {
            status: "new",
            repo: selectedRepo,
            suggestions: []
          }
        ],
        reposToAdd: [selectedRepo],
        counts: {
          discovered: 1,
          configured: 0,
          new: 1,
          conflicts: 0,
          withSuggestions: 0
        }
      });
    mocks.promptGithubDiscoverySelection.mockResolvedValue({
      reposToAdd: [selectedRepo],
      reposToOverride: []
    });
    mocks.ensureInteractiveConfigSetup.mockImplementation(async ({ runDiscoveryFn }) => {
      await runDiscoveryFn({
        owner: "leanish",
        includeForks: true,
        includeArchived: false
      });
      return false;
    });

    const result = await main([]);

    expect(result).toBeNull();
    expect(stderr.join("")).toContain("Found 2 repo(s); ready to choose from 2 eligible repo(s).");
    expect(stderr.join("")).toContain("Found 2 repo(s); loading and curating metadata for 1 eligible repo(s)...");
    expect(stderr.join("")).toContain("Curating repos: 1/1 (ask-the-code)");
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
      selectedRepoNames: ["ask-the-code"]
    }));
    expect(mocks.applyGithubDiscoveryToConfig).toHaveBeenCalledTimes(1);
    expect(mocks.applyGithubDiscoveryToConfig).toHaveBeenCalledWith({
      env: process.env,
      reposToAdd: [selectedRepo],
      reposToOverride: []
    });
  });

  it("does not reload config before planning the applied discovery summary during server bootstrap", async () => {
    const selectedRepo = {
      name: "ask-the-code",
      url: "https://github.com/leanish/ask-the-code.git",
      defaultBranch: "main",
      description: "Repo-aware CLI",
      topics: ["cli"],
      classifications: ["cli"]
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
    mocks.ensureInteractiveConfigSetup.mockImplementation(async ({ runDiscoveryFn }) => {
      await runDiscoveryFn({
        owner: "leanish",
        includeForks: true,
        includeArchived: false
      });
      return false;
    });

    const result = await main([]);

    expect(result).toBeNull();
    expect(mocks.loadConfig).toHaveBeenCalledTimes(1);
    expect(mocks.planGithubRepoDiscovery).toHaveBeenNthCalledWith(2, initialConfig, expect.objectContaining({
      owner: "leanish"
    }));
  });

  it("fails before setup when Codex is missing", async () => {
    mocks.ensureCodexInstalled.mockImplementation(() => {
      throw new Error("Codex CLI is required but was not found on PATH.");
    });

    await expect(main([])).rejects.toThrow("Codex CLI is required but was not found on PATH.");
    expect(mocks.ensureInteractiveConfigSetup).not.toHaveBeenCalled();
    expect(mocks.startHttpServer).not.toHaveBeenCalled();
  });

  it("fails before setup when Git is missing", async () => {
    mocks.ensureGitInstalled.mockImplementation(() => {
      throw new Error("Git CLI is required but was not found on PATH.");
    });

    await expect(main([])).rejects.toThrow("Git CLI is required but was not found on PATH.");
    expect(mocks.ensureInteractiveConfigSetup).not.toHaveBeenCalled();
    expect(mocks.startHttpServer).not.toHaveBeenCalled();
  });

  it("fails interactive discovery when GitHub auth is unavailable", async () => {
    mocks.ensureGithubDiscoveryAuthAvailable.mockImplementation(() => {
      throw new Error("GitHub discovery requires either GH_TOKEN/GITHUB_TOKEN or a usable gh CLI session.");
    });
    mocks.ensureInteractiveConfigSetup.mockImplementation(async ({ runDiscoveryFn }) => {
      await runDiscoveryFn({
        owner: "leanish",
        includeForks: true,
        includeArchived: false
      });
      return false;
    });

    await expect(main([])).rejects.toThrow(
      "GitHub discovery requires either GH_TOKEN/GITHUB_TOKEN or a usable gh CLI session."
    );
    expect(mocks.startHttpServer).not.toHaveBeenCalled();
  });
});

describe("setupShutdownHandlers", () => {
  function createProcessDouble() {
    const handlers = new Map<string, Array<() => void>>();

    return {
      stderr: { write: vi.fn() },
      exit: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        const existing = handlers.get(event) || [];
        existing.push(handler);
        handlers.set(event, existing);
      }),
      emit(event: string) {
        for (const handler of handlers.get(event) || []) {
          handler();
        }
      }
    };
  }

  function createServerHandle() {
    return {
      close: vi.fn(() => Promise.resolve())
    };
  }

  it("calls close on the server handle when SIGTERM is received", async () => {
    const proc = createProcessDouble();
    const handle = createServerHandle();

    setupShutdownHandlers(handle, { processRef: proc });
    proc.emit("SIGTERM");

    expect(handle.close).toHaveBeenCalled();
    expect(proc.stderr.write).toHaveBeenCalledWith("Shutting down (SIGTERM)...\n");

    await handle.close.mock.results[0]!.value;
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it("calls close on the server handle when SIGINT is received", async () => {
    const proc = createProcessDouble();
    const handle = createServerHandle();

    setupShutdownHandlers(handle, { processRef: proc });
    proc.emit("SIGINT");

    expect(handle.close).toHaveBeenCalled();
    expect(proc.stderr.write).toHaveBeenCalledWith("Shutting down (SIGINT)...\n");

    await handle.close.mock.results[0]!.value;
    expect(proc.exit).toHaveBeenCalledWith(0);
  });

  it("forces shutdown on repeated signal", async () => {
    const proc = createProcessDouble();
    const handle = createServerHandle();
    handle.close.mockReturnValue(new Promise(() => {}));

    setupShutdownHandlers(handle, { processRef: proc });
    proc.emit("SIGTERM");
    proc.emit("SIGTERM");

    expect(proc.stderr.write).toHaveBeenCalledWith("Shutting down (SIGTERM)...\n");
    expect(proc.stderr.write).toHaveBeenCalledWith("Forced shutdown (SIGTERM)\n");
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when close rejects", async () => {
    const proc = createProcessDouble();
    const handle = createServerHandle();
    handle.close.mockReturnValue(Promise.reject(new Error("close failed")));

    setupShutdownHandlers(handle, { processRef: proc });
    proc.emit("SIGINT");

    await vi.waitFor(() => {
      expect(proc.exit).toHaveBeenCalledWith(1);
    });
  });
});
