import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runCodexPrompt: vi.fn()
}));

vi.mock("../src/core/codex/codex-runner.js", () => ({
  runCodexPrompt: mocks.runCodexPrompt
}));

import { selectRepos, selectReposHeuristically } from "../src/core/repos/repo-selection.js";
import { createLoadedConfig, createManagedRepo } from "./test-helpers.js";

const config = createLoadedConfig({
  configPath: "/workspace/.config/archa/config.json",
  repos: [
    createManagedRepo({
      name: "sqs-codec",
      description: "SQS execution interceptor with compression and checksum metadata",
      routing: {
        role: "shared-library",
        reach: ["shared-library"],
        responsibilities: ["Provides reusable SQS compression helpers."],
        owns: ["compression metadata", "checksum metadata"],
        exposes: ["Java library API"],
        consumes: ["AWS SQS"],
        workflows: ["Handles SQS message compression workflows."],
        boundaries: [],
        selectWhen: ["The question is about compression metadata or checksum metadata."],
        selectWithOtherReposWhen: []
      }
    }),
    createManagedRepo({
      name: "archa",
      description: "Repo-aware CLI for engineering Q&A with local Codex",
      routing: {
        role: "developer-cli",
        reach: ["developer-cli"],
        responsibilities: ["Owns the repo-aware question answering CLI and server."],
        owns: ["repo selection", "question answering"],
        exposes: ["archa CLI", "archa-server"],
        consumes: ["Codex"],
        workflows: ["Handles repo-aware engineering questions."],
        boundaries: ["Do not select only because a repo mentions Codex."],
        selectWhen: ["The question is about archa CLI behavior or repo selection."],
        selectWithOtherReposWhen: []
      }
    }),
    createManagedRepo({
      name: "java-conventions",
      description: "Java conventions and build defaults",
      aliases: ["conventions"],
      routing: {
        role: "shared-library",
        reach: ["shared-library"],
        responsibilities: ["Owns shared Java build conventions."],
        owns: ["Gradle conventions", "Java build defaults"],
        exposes: ["Gradle plugin"],
        consumes: [],
        workflows: ["Handles shared build convention workflows."],
        boundaries: [],
        selectWhen: ["The question is about conventions or build defaults."],
        selectWithOtherReposWhen: []
      }
    })
  ]
});

describe("selectRepos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("honors explicit repo names without invoking codex", async () => {
    const result = await selectRepos(config, "anything", ["archa"]);

    expect(result).toEqual({
      repos: [config.repos[1]],
      mode: "requested",
      selection: {
        mode: "single",
        shadowCompare: false,
        source: "requested",
        finalEffort: null,
        finalRepoNames: ["archa"],
        runs: []
      }
    });
    expect(mocks.runCodexPrompt).not.toHaveBeenCalled();
  });

  it("uses codex-selected repos during automatic selection", async () => {
    mocks.runCodexPrompt.mockResolvedValue({
      text: JSON.stringify({
        selectedRepoNames: ["java-conventions"],
        confidence: 0.93
      })
    });

    const result = await selectRepos(config, "How do the conventions work?", null);

    expect(result.repos).toEqual([config.repos[2]]);
    expect(result.mode).toBe("resolved");
    expect(result.selection).toMatchObject({
      mode: "single",
      source: "codex",
      finalEffort: "none",
      finalRepoNames: ["java-conventions"]
    });
    expect(result.selection?.runs).toEqual([
      expect.objectContaining({
        effort: "none",
        repoNames: ["java-conventions"],
        confidence: 0.93,
        usedForFinal: true
      })
    ]);
  });

  it("merges alwaysSelect repos into the codex selection", async () => {
    mocks.runCodexPrompt.mockResolvedValue({
      text: JSON.stringify({
        selectedRepoNames: ["java-conventions"],
        confidence: 0.93
      })
    });

    const result = await selectRepos(createLoadedConfig({
      ...config,
      repos: [
        createManagedRepo({
          name: "foundation",
          description: "Cross-cutting shared base functionality",
          alwaysSelect: true
        }),
        ...config.repos
      ]
    }), "How do the conventions work?", null);

    expect(result.repos.map(repo => repo.name)).toEqual(["foundation", "java-conventions"]);
    expect(result.selection?.finalRepoNames).toEqual(["foundation", "java-conventions"]);
  });

  it("falls back to heuristic selection when codex returns invalid JSON", async () => {
    mocks.runCodexPrompt.mockResolvedValue({
      text: "not json"
    });

    const result = await selectRepos(config, "How does SQS compression metadata work?", null);

    expect(result.repos.map(repo => repo.name)).toEqual(["sqs-codec"]);
    expect(result.mode).toBe("resolved");
    expect(result.selection).toMatchObject({
      source: "heuristic",
      finalRepoNames: ["sqs-codec"]
    });
  });

  it("cascades to higher efforts when confidence is too low", async () => {
    mocks.runCodexPrompt.mockImplementation(async ({ reasoningEffort }) => {
      if (reasoningEffort === "none") {
        return {
          text: JSON.stringify({
            selectedRepoNames: ["archa"],
            confidence: 0.21
          })
        };
      }

      if (reasoningEffort === "minimal") {
        return {
          text: JSON.stringify({
            selectedRepoNames: ["archa"],
            confidence: 0.35
          })
        };
      }

      if (reasoningEffort === "low") {
        return {
          text: JSON.stringify({
            selectedRepoNames: ["java-conventions"],
            confidence: 0.82
          })
        };
      }

      throw new Error(`Unexpected effort: ${reasoningEffort}`);
    });

    const result = await selectRepos(config, "How do the conventions work?", null, {
      selectionMode: "cascade",
      selectionShadowCompare: false
    });

    expect(result.repos).toEqual([config.repos[2]]);
    expect(result.selection).toMatchObject({
      mode: "cascade",
      source: "codex",
      finalEffort: "low",
      finalRepoNames: ["java-conventions"]
    });
    expect(result.selection?.runs.map(run => run.effort)).toEqual(["none", "minimal", "low"]);
  });

  it("keeps background comparison runs available through selectionPromise", async () => {
    mocks.runCodexPrompt.mockImplementation(async ({ reasoningEffort }) => ({
      text: JSON.stringify({
        selectedRepoNames: reasoningEffort === "high" ? ["java-conventions"] : ["archa"],
        confidence: reasoningEffort === "none" ? 0.92 : reasoningEffort === "low" ? 0.74 : 0.61
      })
    }));

    const result = await selectRepos(config, "How does repo selection work?", null, {
      selectionMode: "single",
      selectionShadowCompare: true
    });
    const finalizedSelection = await result.selectionPromise;

    expect(result.repos).toEqual([config.repos[1]]);
    expect(result.selection).toMatchObject({
      finalEffort: "none"
    });
    expect(finalizedSelection?.runs.map(run => run.effort)).toEqual(["none", "low", "high"]);
  });
});

describe("selectReposHeuristically", () => {
  it("prefers owned behavior and exposed surfaces", () => {
    const result = selectReposHeuristically(config, "Which repo owns the archa CLI?", null);

    expect(result.repos[0]?.name).toBe("archa");
  });

  it("honors explicit repo names", () => {
    const result = selectReposHeuristically(config, "anything", ["archa"]);

    expect(result.repos.map(repo => repo.name)).toEqual(["archa"]);
    expect(result.mode).toBe("requested");
  });

  it("honors explicit repo aliases", () => {
    const result = selectReposHeuristically(config, "anything", ["conventions"]);

    expect(result.repos.map(repo => repo.name)).toEqual(["java-conventions"]);
  });

  it("throws for unknown explicit repos", () => {
    expect(() => selectReposHeuristically(config, "anything", ["missing-repo"])).toThrow(/Unknown managed repo/);
  });

  it("falls back to all configured repos when nothing scores positively", () => {
    const result = selectReposHeuristically(config, "zebra moonlight quartz", null);

    expect(result.repos.map(repo => repo.name)).toEqual(["sqs-codec", "archa", "java-conventions"]);
    expect(result.mode).toBe("all");
  });

  it("ignores generic consumes values during heuristic selection", () => {
    const result = selectReposHeuristically(createLoadedConfig({
      ...config,
      repos: [
        createManagedRepo({
          name: "helper-kit",
          description: "Wrapper scripts",
          routing: {
            role: "shared-library",
            reach: [],
            responsibilities: [],
            owns: [],
            exposes: [],
            consumes: ["Gradle", "Node.js"],
            workflows: [],
            boundaries: [],
            selectWhen: [],
            selectWithOtherReposWhen: []
          }
        }),
        createManagedRepo({
          name: "payments",
          description: "Payment flows",
          routing: {
            role: "service-application",
            reach: [],
            responsibilities: [],
            owns: ["payments"],
            exposes: [],
            consumes: [],
            workflows: [],
            boundaries: [],
            selectWhen: [],
            selectWithOtherReposWhen: []
          }
        })
      ]
    }), "Which repo uses Gradle?", null);

    expect(result.mode).toBe("all");
  });

  it("includes alwaysSelect repos during automatic selection even when they do not match the question", () => {
    const result = selectReposHeuristically(createLoadedConfig({
      ...config,
      repos: [
        createManagedRepo({
          name: "foundation",
          description: "Cross-cutting shared base functionality",
          alwaysSelect: true
        }),
        ...config.repos
      ]
    }), "Which repo owns the archa CLI?", null);

    expect(result.repos.map(repo => repo.name)).toContain("foundation");
    expect(result.repos[1]?.name).toBe("archa");
  });
});
