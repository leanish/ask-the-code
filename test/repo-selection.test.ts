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
      topics: ["aws", "sqs", "compression", "checksum"],
      classifications: ["library"]
    }),
    createManagedRepo({
      name: "archa",
      description: "Repo-aware CLI for engineering Q&A with local Codex",
      topics: ["cli", "codex", "qa"],
      classifications: ["cli"]
    }),
    createManagedRepo({
      name: "java-conventions",
      description: "Java conventions and build defaults",
      topics: ["java", "conventions"],
      classifications: ["infra"],
      aliases: ["conventions"]
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
      mode: "requested"
    });
    expect(mocks.runCodexPrompt).not.toHaveBeenCalled();
  });

  it("uses codex-selected repos during automatic selection", async () => {
    mocks.runCodexPrompt.mockResolvedValue({
      text: JSON.stringify({
        selectedRepoNames: ["java-conventions"]
      })
    });

    const result = await selectRepos(config, "How do the conventions work?", null);

    expect(result).toEqual({
      repos: [config.repos[2]],
      mode: "resolved"
    });
  });

  it("merges alwaysSelect repos into the codex selection", async () => {
    mocks.runCodexPrompt.mockResolvedValue({
      text: JSON.stringify({
        selectedRepoNames: ["java-conventions"]
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

    expect(result).toEqual({
      repos: [
        expect.objectContaining({ name: "foundation" }),
        config.repos[2]
      ],
      mode: "resolved"
    });
  });

  it("keeps alwaysSelect repos even when codex returns no extra repos", async () => {
    mocks.runCodexPrompt.mockResolvedValue({
      text: JSON.stringify({
        selectedRepoNames: []
      })
    });

    const result = await selectRepos(createLoadedConfig({
      ...config,
      repos: [
        createManagedRepo({
          name: "playcart",
          description: "Core Nosto platform service",
          topics: ["recommendations"],
          alwaysSelect: true
        }),
        ...config.repos
      ]
    }), "How do recommendations work?", null);

    expect(result).toEqual({
      repos: [
        expect.objectContaining({ name: "playcart" })
      ],
      mode: "resolved"
    });
  });

  it("falls back to heuristic selection when codex returns invalid JSON", async () => {
    mocks.runCodexPrompt.mockResolvedValue({
      text: "not json"
    });

    const result = await selectRepos(config, "How does SQS compression metadata work?", null);

    expect(result.repos.map(repo => repo.name)).toEqual(["sqs-codec"]);
    expect(result.mode).toBe("resolved");
  });
});

describe("selectReposHeuristically", () => {
  it("prefers matching topics during automatic selection", () => {
    const result = selectReposHeuristically(config, "How does SQS compression metadata work?", null);

    expect(result.repos[0]?.name).toBe("sqs-codec");
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

  it("weights separate classifications more strongly than generic topics", () => {
    const result = selectReposHeuristically(createLoadedConfig({
      ...config,
      repos: [
        createManagedRepo({
          name: "shared-lib",
          description: "Shared utilities and helpers",
          topics: ["helpers", "retry"],
          classifications: ["library"]
        }),
        createManagedRepo({
          name: "infra-live",
          description: "Deployment helpers and retry tooling",
          topics: ["helpers", "retry"],
          classifications: ["infra"]
        })
      ]
    }), "Which infra repo owns retry tooling?", null);

    expect(result.repos[0]?.name).toBe("infra-live");
  });

  it("matches classification aliases like lib to library", () => {
    const result = selectReposHeuristically(createLoadedConfig({
      ...config,
      repos: [
        createManagedRepo({
          name: "shared-lib",
          description: "Shared utilities and helpers",
          topics: ["helpers"],
          classifications: ["library"]
        }),
        createManagedRepo({
          name: "app-service",
          description: "Application service",
          topics: ["helpers"],
          classifications: ["microservice"]
        })
      ]
    }), "Which lib exposes helpers?", null);

    expect(result.repos[0]?.name).toBe("shared-lib");
  });

  it("matches external-facing cues more strongly than generic topics", () => {
    const result = selectReposHeuristically(createLoadedConfig({
      ...config,
      repos: [
        createManagedRepo({
          name: "platform-api",
          description: "Platform GraphQL API",
          topics: ["commerce"],
          classifications: ["external", "backend"]
        }),
        createManagedRepo({
          name: "internal-admin",
          description: "Backoffice tooling",
          topics: ["commerce"],
          classifications: ["internal"]
        })
      ]
    }), "Which external graphql service owns the commerce API?", null);

    expect(result.repos[0]?.name).toBe("platform-api");
  });

  it("scores repo names directly without needing duplicated topics", () => {
    const result = selectReposHeuristically(createLoadedConfig({
      ...config,
      repos: [
        createManagedRepo({
          name: "java-conventions",
          description: "Shared Gradle defaults",
          topics: ["gradle"],
          classifications: ["infra"]
        }),
        createManagedRepo({
          name: "build-logic",
          description: "Shared Gradle defaults",
          topics: ["gradle"],
          classifications: ["infra"]
        })
      ]
    }), "Which repo owns the conventions defaults?", null);

    expect(result.repos[0]?.name).toBe("java-conventions");
  });

  it("falls back to all configured repos when nothing scores positively", () => {
    const result = selectReposHeuristically(config, "totally unrelated question", null);

    expect(result.repos.map(repo => repo.name)).toEqual(["sqs-codec", "archa", "java-conventions"]);
    expect(result.mode).toBe("all");
  });

  it("still falls back to all configured repos when only alwaysSelect repos are in scope", () => {
    const result = selectReposHeuristically(createLoadedConfig({
      ...config,
      repos: [
        createManagedRepo({
          name: "foundation",
          description: "Cross-cutting shared base functionality",
          alwaysSelect: true
        }),
        createManagedRepo({
          name: "archa",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          topics: ["cli", "codex", "qa"]
        }),
        createManagedRepo({
          name: "java-conventions",
          description: "Java conventions and build defaults",
          topics: ["java", "conventions"]
        })
      ]
    }), "totally unrelated question", null);

    expect(result.repos.map(repo => repo.name)).toEqual(["foundation", "archa", "java-conventions"]);
    expect(result.mode).toBe("all");
  });

  it("preserves configured repo order in the all-repos fallback", () => {
    const result = selectReposHeuristically(createLoadedConfig({
      ...config,
      repos: [
        createManagedRepo({
          name: "java-conventions",
          description: "Java conventions and build defaults",
          topics: ["java", "conventions", "gradle"]
        }),
        createManagedRepo({
          name: "archa",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          topics: ["cli", "codex", "qa"]
        })
      ]
    }), "totally unrelated question", null);

    expect(result.repos.map(repo => repo.name)).toEqual(["java-conventions", "archa"]);
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
        createManagedRepo({
          name: "java-conventions",
          description: "Java conventions and build defaults",
          topics: ["java", "conventions"]
        }),
        createManagedRepo({
          name: "archa",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          topics: ["cli", "codex", "qa"]
        })
      ]
    }), "Need build defaults details", null);

    expect(result.repos.map(repo => repo.name)).toEqual(["foundation", "java-conventions"]);
  });

  it("does not let a matching alwaysSelect repo consume a scored selection slot", () => {
    const result = selectReposHeuristically(createLoadedConfig({
      ...config,
      repos: [
        createManagedRepo({
          name: "foundation",
          description: "Shared build defaults and base support",
          topics: ["build", "defaults"],
          alwaysSelect: true
        }),
        createManagedRepo({
          name: "java-conventions",
          description: "Java conventions and build defaults",
          topics: ["java", "conventions", "build", "defaults"]
        }),
        createManagedRepo({
          name: "gradle-rules",
          description: "Gradle rules and plugin defaults",
          topics: ["gradle", "build", "defaults"]
        }),
        createManagedRepo({
          name: "release-tools",
          description: "Release tooling and build defaults",
          topics: ["release", "build", "defaults"]
        }),
        createManagedRepo({
          name: "artifact-metadata",
          description: "Artifact metadata and build defaults",
          topics: ["artifact", "build", "defaults"]
        })
      ]
    }), "Need build defaults details", null);

    expect(result.repos.map(repo => repo.name)).toEqual([
      "foundation",
      "java-conventions",
      "gradle-rules",
      "release-tools",
      "artifact-metadata"
    ]);
  });

  it("still respects explicit repo narrowing even when some repos are marked alwaysSelect", () => {
    const result = selectReposHeuristically(createLoadedConfig({
      ...config,
      repos: [
        createManagedRepo({
          name: "foundation",
          description: "Cross-cutting shared base functionality",
          alwaysSelect: true
        }),
        createManagedRepo({
          name: "archa",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          topics: ["cli", "codex", "qa"]
        })
      ]
    }), "anything", ["archa"]);

    expect(result.repos.map(repo => repo.name)).toEqual(["archa"]);
    expect(result.mode).toBe("requested");
  });
});
