import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runCodexPrompt: vi.fn()
}));

vi.mock("../src/core/codex/codex-runner.js", () => ({
  runCodexPrompt: mocks.runCodexPrompt
}));

import {
  buildRepoSelectionPrompt,
  isUsableCodexRun,
  parseRepoSelectionRunResult,
  selectRepos
} from "../src/core/repos/repo-selection.js";
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
        finalModel: null,
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
      }),
      usage: {
        inputTokens: 1_250,
        cachedInputTokens: 320,
        outputTokens: 14
      }
    });

    const result = await selectRepos(config, "How do the conventions work?", null);

    expect(result.repos).toEqual([config.repos[2]]);
    expect(result.mode).toBe("resolved");
    expect(result.selection).toMatchObject({
      mode: "single",
      source: "codex",
      finalModel: "gpt-5.4-mini",
      finalEffort: "medium",
      finalRepoNames: ["java-conventions"]
    });
    expect(result.selection?.runs).toEqual([
      expect.objectContaining({
        model: "gpt-5.4-mini",
        effort: "medium",
        repoNames: ["java-conventions"],
        confidence: 0.93,
        usage: {
          inputTokens: 1_250,
          cachedInputTokens: 320,
          outputTokens: 14
        },
        usedForFinal: true
      })
    ]);
    expect(result.selectionPromise).toBeUndefined();
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

  it("keeps alwaysSelect repos when single-mode selection returns a valid empty repo set", async () => {
    mocks.runCodexPrompt.mockResolvedValue({
      text: JSON.stringify({
        selectedRepoNames: [],
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

    expect(result.repos.map(repo => repo.name)).toEqual(["foundation"]);
    expect(result.selection).toMatchObject({
      mode: "single",
      finalModel: "gpt-5.4-mini",
      finalEffort: "medium",
      finalRepoNames: ["foundation"]
    });
    expect(mocks.runCodexPrompt).toHaveBeenCalledTimes(1);
  });

  it("keeps alwaysSelect repos when cascade-mode selection returns a valid empty repo set", async () => {
    mocks.runCodexPrompt.mockResolvedValue({
      text: JSON.stringify({
        selectedRepoNames: [],
        confidence: 0.35
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
    }), "How do the conventions work?", null, {
      selectionMode: "cascade"
    });

    expect(result.repos.map(repo => repo.name)).toEqual(["foundation"]);
    expect(result.selection).toMatchObject({
      mode: "cascade",
      finalModel: "gpt-5.4-mini",
      finalEffort: "medium",
      finalRepoNames: ["foundation"]
    });
    expect(mocks.runCodexPrompt).toHaveBeenCalledTimes(1);
  });

  it("fails when codex returns unusable selector output", async () => {
    mocks.runCodexPrompt.mockResolvedValue({
      text: "not json"
    });

    await expect(selectRepos(config, "How does SQS compression metadata work?", null)).rejects.toThrow(
      "Automatic repo selection failed. Codex did not return a usable repo set. Retry, use --repo <name>, or try --selection-mode cascade."
    );
    expect(mocks.runCodexPrompt).toHaveBeenCalledTimes(2);
  });

  it("retries once when the first selector reply is malformed", async () => {
    mocks.runCodexPrompt
      .mockResolvedValueOnce({
        text: "not json"
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          selectedRepoNames: ["sqs-codec"],
          confidence: 0.91
        })
      });

    const result = await selectRepos(config, "How does SQS compression metadata work?", null);

    expect(result.repos).toEqual([config.repos[0]]);
    expect(result.selection).toMatchObject({
      finalRepoNames: ["sqs-codec"]
    });
    expect(mocks.runCodexPrompt).toHaveBeenCalledTimes(2);
  });

  it("accepts a non-empty single-mode selection even when confidence is low", async () => {
    mocks.runCodexPrompt.mockResolvedValue({
      text: JSON.stringify({
        selectedRepoNames: ["archa"],
        confidence: 0.21
      })
    });

    const result = await selectRepos(config, "How does repo selection work?", null);

    expect(result.repos).toEqual([config.repos[1]]);
    expect(result.selection).toMatchObject({
      finalModel: "gpt-5.4-mini",
      finalEffort: "medium",
      finalRepoNames: ["archa"]
    });
    expect(mocks.runCodexPrompt).toHaveBeenCalledTimes(1);
  });

  it("fails single-mode selection immediately when the selector returns an empty repo set", async () => {
    mocks.runCodexPrompt.mockImplementation(async ({ reasoningEffort }) => {
      if (reasoningEffort === "medium") {
        return {
          text: JSON.stringify({
            selectedRepoNames: [],
            confidence: 0.9
          })
        };
      }

      throw new Error(`Unexpected effort: ${reasoningEffort}`);
    });

    await expect(selectRepos(config, "How do the conventions work?", null)).rejects.toThrow(
      "Automatic repo selection failed. Codex did not return a usable repo set. Retry, use --repo <name>, or try --selection-mode cascade."
    );
    expect(mocks.runCodexPrompt).toHaveBeenCalledTimes(1);
  });

  it("cascades to higher efforts when confidence is too low", async () => {
    mocks.runCodexPrompt.mockImplementation(async ({ reasoningEffort }) => {
      if (reasoningEffort === "medium") {
        return {
          text: JSON.stringify({
            selectedRepoNames: ["archa"],
            confidence: 0.21
          })
        };
      }

      if (reasoningEffort === "high") {
        return {
          text: JSON.stringify({
            selectedRepoNames: [],
            confidence: 0.35
          })
        };
      }

      if (reasoningEffort === "xhigh") {
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
      finalModel: "gpt-5.4-mini",
      finalEffort: "xhigh",
      finalRepoNames: ["java-conventions"]
    });
    expect(result.selection?.runs.map(run => `${run.model}:${run.effort}`)).toEqual([
      "gpt-5.4-mini:medium",
      "gpt-5.4-mini:high",
      "gpt-5.4-mini:xhigh"
    ]);
    expect(mocks.runCodexPrompt).toHaveBeenCalledTimes(3);
  });

  it("keeps background comparison runs available through selectionPromise", async () => {
    mocks.runCodexPrompt.mockImplementation(async ({ model, reasoningEffort }) => {
      const runKey = `${model}:${reasoningEffort}`;
      const selectedRepoNames = runKey === "gpt-5.4-mini:xhigh" ? ["java-conventions"] : ["archa"];
      const confidenceByRunKey: Record<string, number> = {
        "gpt-5.4:low": 0.72,
        "gpt-5.4:medium": 0.69,
        "gpt-5.4:high": 0.73,
        "gpt-5.4:none": 0.71,
        "gpt-5.4-mini:low": 0.78,
        "gpt-5.4-mini:high": 0.61,
        "gpt-5.4-mini:medium": 0.92,
        "gpt-5.4-mini:none": 0.74
      };

      return {
        text: JSON.stringify({
          selectedRepoNames,
          confidence: confidenceByRunKey[runKey] ?? 0.5
        })
      };
    });

    const result = await selectRepos(config, "How does repo selection work?", null, {
      selectionMode: "single",
      selectionShadowCompare: true
    });
    const finalizedSelection = await result.selectionPromise;

    expect(result.repos).toEqual([config.repos[1]]);
    expect(result.selection).toMatchObject({
      finalModel: "gpt-5.4-mini",
      finalEffort: "medium"
    });
    expect(finalizedSelection?.runs.map(run => `${run.model}:${run.effort}`)).toEqual([
      "gpt-5.4-mini:medium",
      "gpt-5.4-mini:none",
      "gpt-5.4-mini:low",
      "gpt-5.4-mini:high",
      "gpt-5.4-mini:xhigh",
      "gpt-5.4:none",
      "gpt-5.4:low",
      "gpt-5.4:medium",
      "gpt-5.4:high"
    ]);
  });

  it("keeps failed background comparison runs in the diagnostics", async () => {
    mocks.runCodexPrompt.mockImplementation(async ({ model, reasoningEffort }) => {
      const runKey = `${model}:${reasoningEffort}`;
      if (runKey === "gpt-5.4-mini:xhigh") {
        throw new Error("selector crashed");
      }

      return {
        text: JSON.stringify({
          selectedRepoNames: ["archa"],
          confidence: 0.8
        })
      };
    });

    const result = await selectRepos(config, "How does repo selection work?", null, {
      selectionMode: "single",
      selectionShadowCompare: true
    });
    const finalizedSelection = await result.selectionPromise;

    expect(finalizedSelection?.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "gpt-5.4-mini",
          effort: "xhigh",
          status: "failed",
          repoNames: []
        })
      ])
    );
  });
});

describe("buildRepoSelectionPrompt", () => {
  it("builds a routing-focused prompt and filters noisy consumes values", () => {
    expect(buildRepoSelectionPrompt(createLoadedConfig({
      configPath: "/workspace/.config/archa/config.json",
      repos: [
        createManagedRepo({
          name: "java-conventions",
          description: "Java conventions and build defaults",
          routing: {
            role: "shared-library",
            reach: ["shared-library"],
            responsibilities: ["Owns shared Java build conventions."],
            owns: ["Gradle conventions", "Java build defaults"],
            exposes: ["Gradle plugin"],
            consumes: ["Gradle", "Node.js", "GitHub API"],
            workflows: ["Shared Java build setup"],
            boundaries: [],
            selectWhen: ["The question is about conventions or build defaults."],
            selectWithOtherReposWhen: []
          }
        })
      ]
    }), "How do the conventions work?")).toMatchInlineSnapshot(`
      "Select the configured repositories that should be searched to answer the user question.
      Select repos by ownership and exposed surfaces, not by generic keyword overlap.
      Strong evidence: description, routing.role, routing.reach, routing.responsibilities, routing.owns, routing.exposes, routing.workflows, routing.selectWhen, and aliases.
      Weaker evidence: routing.consumes and generic ecosystem overlap.
      Negative evidence: routing.boundaries and routing.selectWithOtherReposWhen when the question does not cross repo boundaries.
      Prefer precision over recall. Only choose repos that are likely to contain the answer.
      Return between 0 and 4 configured repos.
      If no configured repo is relevant, return an empty array.
      Return raw JSON only with exactly this shape: {"selectedRepoNames":["repo-a","repo-b"],"confidence":0.0}.
      Do not wrap the JSON in markdown fences. Do not add explanation, commentary, or any extra text.
      Confidence must be a number from 0.0 to 1.0 for how confident you are that the selected set is sufficient.
      Use configured repo names exactly as provided. Unknown repo names will be rejected.
      There are no alwaysSelect repos.

      Using full routing summaries for the configured repos.
      Configured repositories from /workspace/.config/archa/config.json (one JSON object per line):
      {"name":"java-conventions","description":"Java conventions and build defaults","routing":{"role":"shared-library","reach":["shared-library"],"owns":["Gradle conventions","Java build defaults"],"exposes":["Gradle plugin"],"selectWhen":["The question is about conventions or build defaults."],"responsibilities":["Owns shared Java build conventions."],"workflows":["Shared Java build setup"],"consumes":["GitHub API"]}}

      User question:
      """
      How do the conventions work?
      """"
    `);
  });

  it("compacts repo summaries when many repos are configured", () => {
    const largeConfig = createLoadedConfig({
      configPath: "/workspace/.config/archa/config.json",
      repos: Array.from({ length: 17 }, (_, index) => createManagedRepo({
        name: `repo-${index + 1}`,
        description: `Service ${index + 1}`,
        routing: {
          role: "service-application",
          reach: ["service-api"],
          responsibilities: [`Owns backend behavior ${index + 1}.`],
          owns: [`domain-${index + 1}`],
          exposes: [`GET /api/${index + 1}`],
          consumes: ["GitHub API"],
          workflows: [`Workflow ${index + 1}`],
          boundaries: [`Boundary ${index + 1}`],
          selectWhen: [`The question is about domain-${index + 1}.`],
          selectWithOtherReposWhen: [`Use with repo-${index + 1}-worker when flows cross boundaries.`]
        }
      }))
    });

    const prompt = buildRepoSelectionPrompt(largeConfig, "Which repo owns domain-1?");

    expect(prompt).toContain(
      "Strong evidence: description, routing.role, routing.reach, routing.owns, routing.exposes, routing.selectWhen, routing.boundaries, and aliases."
    );
    expect(prompt).toContain(
      "Large repo set detected; using compact routing summaries with description, role, reach, owns, exposes, selectWhen, boundaries, and aliases only."
    );
    expect(prompt).not.toContain("routing.responsibilities");
    expect(prompt).not.toContain("routing.workflows");
    expect(prompt).not.toContain("routing.consumes");
    expect(prompt).not.toContain("routing.selectWithOtherReposWhen");
    expect(prompt).not.toContain("\"responsibilities\"");
    expect(prompt).not.toContain("\"workflows\"");
    expect(prompt).not.toContain("\"consumes\"");
    expect(prompt).not.toContain("\"selectWithOtherReposWhen\"");
    expect(prompt).toContain("{\"name\":\"repo-1\"");
    expect(prompt).toContain("\"owns\":[\"domain-1\"]");
    expect(prompt).toContain("\"selectWhen\":[\"The question is about domain-1.\"]");
    expect(prompt).toContain("\"boundaries\":[\"Boundary 1\"]");
  });
});

describe("parseRepoSelectionRunResult", () => {
  it("treats empty or malformed selector output as unusable", () => {
    expect(parseRepoSelectionRunResult("", config, "none", 12)).toEqual({
      model: "gpt-5.4-mini",
      effort: "none",
      repoNames: [],
      repos: null,
      confidence: null,
      latencyMs: 12,
      status: "invalid"
    });
    expect(parseRepoSelectionRunResult("{", config, "none", 13)).toEqual({
      model: "gpt-5.4-mini",
      effort: "none",
      repoNames: [],
      repos: null,
      confidence: null,
      latencyMs: 13,
      status: "invalid"
    });
  });

  it("rejects outputs that omit selectedRepoNames", () => {
    expect(parseRepoSelectionRunResult(JSON.stringify({
      confidence: 0.9
    }), config, "low", 14)).toEqual({
      model: "gpt-5.4-mini",
      effort: "low",
      repoNames: [],
      repos: null,
      confidence: null,
      latencyMs: 14,
      status: "invalid"
    });
  });

  it("accepts outputs that return an empty repo array", () => {
    expect(parseRepoSelectionRunResult(JSON.stringify({
      selectedRepoNames: [],
      confidence: 0.9
    }), config, "low", 14)).toEqual({
      model: "gpt-5.4-mini",
      effort: "low",
      repoNames: [],
      repos: [],
      confidence: 0.9,
      latencyMs: 14,
      status: "ok"
    });
  });

  it("normalizes invalid confidence values to null while keeping matched repos", () => {
    expect(parseRepoSelectionRunResult(JSON.stringify({
      selectedRepoNames: ["archa"],
      confidence: 1.2
    }), config, "low", 15)).toEqual({
      model: "gpt-5.4-mini",
      effort: "low",
      repoNames: ["archa"],
      repos: [config.repos[1]],
      confidence: null,
      latencyMs: 15,
      status: "ok"
    });
  });

  it("rejects unknown or over-limit repo selections", () => {
    expect(parseRepoSelectionRunResult(JSON.stringify({
      selectedRepoNames: ["missing-repo"],
      confidence: 0.8
    }), config, "none", 16)).toEqual({
      model: "gpt-5.4-mini",
      effort: "none",
      repoNames: ["missing-repo"],
      repos: null,
      confidence: 0.8,
      latencyMs: 16,
      status: "invalid"
    });

    expect(parseRepoSelectionRunResult(JSON.stringify({
      selectedRepoNames: ["a", "b", "c", "d", "e"],
      confidence: 0.8
    }), config, "none", 17)).toEqual({
      model: "gpt-5.4-mini",
      effort: "none",
      repoNames: ["a", "b", "c", "d", "e"],
      repos: null,
      confidence: 0.8,
      latencyMs: 17,
      status: "invalid"
    });
  });
});

describe("isUsableCodexRun", () => {
  it("applies the per-effort confidence thresholds", () => {
    const baseRun = {
      model: "gpt-5.4-mini",
      repoNames: ["archa"],
      repos: [config.repos[1]!],
      latencyMs: 10,
      status: "ok" as const
    };

    expect(isUsableCodexRun({
      ...baseRun,
      effort: "none",
      confidence: 0.77
    }, "none")).toBe(false);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "none",
      confidence: 0.78
    }, "none")).toBe(true);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "minimal",
      confidence: 0.73
    }, "minimal")).toBe(false);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "minimal",
      confidence: 0.74
    }, "minimal")).toBe(true);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "low",
      confidence: 0.67
    }, "low")).toBe(false);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "low",
      confidence: 0.68
    }, "low")).toBe(true);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "medium",
      confidence: 0.57
    }, "medium")).toBe(false);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "medium",
      confidence: 0.58
    }, "medium")).toBe(true);
  });

  it("allows high-effort runs without confidence and rejects empty repo sets", () => {
    expect(isUsableCodexRun({
      model: "gpt-5.4-mini",
      effort: "high",
      repoNames: ["archa"],
      repos: [config.repos[1]!],
      confidence: null,
      latencyMs: 20,
      status: "ok"
    }, "high")).toBe(true);
    expect(isUsableCodexRun({
      model: "gpt-5.4-mini",
      effort: "high",
      repoNames: [],
      repos: [],
      confidence: null,
      latencyMs: 21,
      status: "invalid"
    }, "high")).toBe(false);
  });
});
