import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runCodexPrompt: vi.fn()
}));

vi.mock("../src/core/codex/codex-runner.ts", () => ({
  runCodexPrompt: mocks.runCodexPrompt
}));

import {
  buildRepoSelectionPrompt,
  isUsableCodexRun,
  parseRepoSelectionRunResult,
  selectRepos,
  selectReposHeuristically
} from "../src/core/repos/repo-selection.ts";
import { createLoadedConfig, createManagedRepo } from "./test-helpers.ts";

const config = createLoadedConfig({
  configPath: "/workspace/.config/atc/config.json",
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
      name: "ask-the-code",
      description: "Repo-aware CLI for engineering Q&A with local Codex",
      routing: {
        role: "developer-cli",
        reach: ["developer-cli"],
        responsibilities: ["Owns the repo-aware question answering CLI and server."],
        owns: ["repo selection", "question answering"],
        exposes: ["atc CLI", "atc-server"],
        consumes: ["Codex"],
        workflows: ["Handles repo-aware engineering questions."],
        boundaries: ["Do not select only because a repo mentions Codex."],
        selectWhen: ["The question is about atc CLI behavior or repo selection."],
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
    const result = await selectRepos(config, "anything", ["ask-the-code"]);

    expect(result).toEqual({
      repos: [config.repos[1]],
      mode: "requested",
      selection: {
        mode: "single",
        shadowCompare: false,
        source: "requested",
        finalEffort: null,
        finalRepoNames: ["ask-the-code"],
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
            selectedRepoNames: ["ask-the-code"],
            confidence: 0.21
          })
        };
      }

      if (reasoningEffort === "minimal") {
        return {
          text: JSON.stringify({
            selectedRepoNames: ["ask-the-code"],
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
    expect(mocks.runCodexPrompt).toHaveBeenCalledTimes(3);
  });

  it("keeps background comparison runs available through selectionPromise", async () => {
    mocks.runCodexPrompt.mockImplementation(async ({ reasoningEffort }) => ({
      text: JSON.stringify({
        selectedRepoNames: reasoningEffort === "high" ? ["java-conventions"] : ["ask-the-code"],
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

describe("buildRepoSelectionPrompt", () => {
  it("builds a routing-focused prompt and filters noisy consumes values", () => {
    expect(buildRepoSelectionPrompt(createLoadedConfig({
      configPath: "/workspace/.config/atc/config.json",
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
      Return at most 4 configured repos.
      Return JSON only with exactly this shape: {"selectedRepoNames":["repo-a","repo-b"],"confidence":0.0}.
      Confidence must be a number from 0.0 to 1.0 for how confident you are that the selected set is sufficient.
      Use configured repo names exactly as provided.
      Return an empty array when no extra repos are clearly relevant.
      There are no alwaysSelect repos.

      Using full routing summaries for the configured repos.
      Configured repositories from /workspace/.config/atc/config.json (one JSON object per line):
      {"name":"java-conventions","description":"Java conventions and build defaults","routing":{"role":"shared-library","reach":["shared-library"],"owns":["Gradle conventions","Java build defaults"],"exposes":["Gradle plugin"],"selectWhen":["The question is about conventions or build defaults."],"responsibilities":["Owns shared Java build conventions."],"workflows":["Shared Java build setup"],"consumes":["GitHub API"]}}

      User question:
      """
      How do the conventions work?
      """"
    `);
  });

  it("compacts repo summaries when many repos are configured", () => {
    const largeConfig = createLoadedConfig({
      configPath: "/workspace/.config/atc/config.json",
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

    expect(prompt).toContain("Large repo set detected; omitting lower-signal routing fields to control prompt size.");
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
      effort: "none",
      repoNames: [],
      repos: null,
      confidence: null,
      latencyMs: 12
    });
    expect(parseRepoSelectionRunResult("{", config, "none", 13)).toEqual({
      effort: "none",
      repoNames: [],
      repos: null,
      confidence: null,
      latencyMs: 13
    });
  });

  it("rejects outputs that omit selectedRepoNames", () => {
    expect(parseRepoSelectionRunResult(JSON.stringify({
      confidence: 0.9
    }), config, "low", 14)).toEqual({
      effort: "low",
      repoNames: [],
      repos: null,
      confidence: null,
      latencyMs: 14
    });
  });

  it("normalizes invalid confidence values to null while keeping matched repos", () => {
    expect(parseRepoSelectionRunResult(JSON.stringify({
      selectedRepoNames: ["ask-the-code"],
      confidence: 1.2
    }), config, "low", 15)).toEqual({
      effort: "low",
      repoNames: ["ask-the-code"],
      repos: [config.repos[1]],
      confidence: null,
      latencyMs: 15
    });
  });

  it("rejects unknown or over-limit repo selections", () => {
    expect(parseRepoSelectionRunResult(JSON.stringify({
      selectedRepoNames: ["missing-repo"],
      confidence: 0.8
    }), config, "none", 16)).toEqual({
      effort: "none",
      repoNames: ["missing-repo"],
      repos: null,
      confidence: 0.8,
      latencyMs: 16
    });

    expect(parseRepoSelectionRunResult(JSON.stringify({
      selectedRepoNames: ["a", "b", "c", "d", "e"],
      confidence: 0.8
    }), config, "none", 17)).toEqual({
      effort: "none",
      repoNames: ["a", "b", "c", "d", "e"],
      repos: null,
      confidence: 0.8,
      latencyMs: 17
    });
  });
});

describe("isUsableCodexRun", () => {
  it("applies the per-effort confidence thresholds", () => {
    const baseRun = {
      repoNames: ["ask-the-code"],
      repos: [config.repos[1]!],
      latencyMs: 10
    };

    expect(isUsableCodexRun({
      ...baseRun,
      effort: "none",
      confidence: 0.77
    }, 0, "none")).toBe(false);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "none",
      confidence: 0.78
    }, 0, "none")).toBe(true);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "minimal",
      confidence: 0.73
    }, 0, "minimal")).toBe(false);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "minimal",
      confidence: 0.74
    }, 0, "minimal")).toBe(true);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "low",
      confidence: 0.67
    }, 0, "low")).toBe(false);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "low",
      confidence: 0.68
    }, 0, "low")).toBe(true);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "medium",
      confidence: 0.57
    }, 0, "medium")).toBe(false);
    expect(isUsableCodexRun({
      ...baseRun,
      effort: "medium",
      confidence: 0.58
    }, 0, "medium")).toBe(true);
  });

  it("allows high-effort runs without confidence and rejects empty repo sets", () => {
    expect(isUsableCodexRun({
      effort: "high",
      repoNames: ["ask-the-code"],
      repos: [config.repos[1]!],
      confidence: null,
      latencyMs: 20
    }, 0, "high")).toBe(true);
    expect(isUsableCodexRun({
      effort: "high",
      repoNames: [],
      repos: [],
      confidence: null,
      latencyMs: 21
    }, 0, "high")).toBe(false);
  });
});

describe("selectReposHeuristically", () => {
  it("prefers owned behavior and exposed surfaces", () => {
    const result = selectReposHeuristically(config, "Which repo owns the atc CLI?", null);

    expect(result.repos[0]?.name).toBe("ask-the-code");
  });

  it("honors explicit repo names", () => {
    const result = selectReposHeuristically(config, "anything", ["ask-the-code"]);

    expect(result.repos.map(repo => repo.name)).toEqual(["ask-the-code"]);
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

    expect(result.repos.map(repo => repo.name)).toEqual(["sqs-codec", "ask-the-code", "java-conventions"]);
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
    }), "Which repo owns the atc CLI?", null);

    expect(result.repos.map(repo => repo.name)).toContain("foundation");
    expect(result.repos[1]?.name).toBe("ask-the-code");
  });
});
