import { describe, expect, it, vi } from "vitest";

import { curateRepoMetadataWithCodex } from "../src/core/discovery/repo-metadata-codex-curator.js";
import { createEmptyRepoRouting } from "../src/core/repos/repo-routing.js";

describe("repo-metadata-codex-curator", () => {
  it("accepts Codex-curated routing metadata and normalizes it", async () => {
    const runCodexPromptFn = vi.fn(async () => ({
      text: JSON.stringify({
        description: "Shared Gradle plugin conventions for JDK-based projects.",
        routing: {
          role: " shared-library ",
          reach: ["shared-library", "shared-library"],
        responsibilities: ["Provides reusable Gradle conventions.", "Provides reusable Gradle conventions."],
        owns: ["Gradle plugin", "gradle plugin", "build defaults"],
        exposes: ["Gradle plugin"],
        consumes: ["Gradle", "GitHub API"],
        workflows: ["Handles build convention workflows."],
          boundaries: ["Do not select only because another repo depends on this library."],
          selectWhen: ["The question is about build defaults."],
          selectWithOtherReposWhen: ["Use with application repos when debugging convention consumption."]
        }
      })
    }));

    const metadata = await curateRepoMetadataWithCodex({
      directory: "/workspace/repos/java-conventions",
      repo: {
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main"
      },
      sourceRepo: {
        size: 245
      },
      inferredMetadata: {
        description: "Shared Gradle conventions for JDK-based projects",
        routing: createEmptyRepoRouting()
      },
      runCodexPromptFn
    });

    expect(runCodexPromptFn).toHaveBeenCalledWith(expect.objectContaining({
      workingDirectory: "/workspace/repos/java-conventions",
      reasoningEffort: "none",
      timeoutMs: 60_000
    }));
    expect(metadata).toEqual({
      description: "Shared Gradle plugin conventions for JDK-based projects.",
      routing: {
        role: "shared-library",
        reach: ["shared-library"],
        responsibilities: ["Provides reusable Gradle conventions."],
        owns: ["Gradle plugin", "build defaults"],
        exposes: ["Gradle plugin"],
        consumes: ["GitHub API"],
        workflows: ["Handles build convention workflows."],
        boundaries: ["Do not select only because another repo depends on this library."],
        selectWhen: ["The question is about build defaults."],
        selectWithOtherReposWhen: ["Use with application repos when debugging convention consumption."]
      }
    });
  });

  it("falls back to inferred metadata when Codex does not return valid JSON", async () => {
    const inferredMetadata = {
      description: "Terminator is a small Java library.",
      routing: {
        role: "shared-library",
        reach: ["shared-library"],
        responsibilities: ["Provides reusable shutdown helpers."],
        owns: ["shutdown coordination"],
        exposes: [],
        consumes: [],
        workflows: [],
        boundaries: [],
        selectWhen: [],
        selectWithOtherReposWhen: []
      }
    };

    const metadata = await curateRepoMetadataWithCodex({
      directory: "/workspace/repos/terminator",
      repo: {
        name: "terminator",
        url: "https://github.com/leanish/terminator.git",
        defaultBranch: "main"
      },
      inferredMetadata,
      runCodexPromptFn: vi.fn(async () => ({
        text: "not json"
      }))
    });

    expect(metadata).toEqual(inferredMetadata);
  });

  it("falls back immediately when no Codex runner is available", async () => {
    const inferredMetadata = {
      description: "CLI utilities",
      routing: {
        role: "developer-cli",
        reach: ["cli"],
        responsibilities: ["Owns CLI utilities."],
        owns: ["CLI behavior"],
        exposes: ["archa CLI"],
        consumes: ["GitHub API"],
        workflows: ["Handles CLI workflows."],
        boundaries: [],
        selectWhen: [],
        selectWithOtherReposWhen: []
      }
    };

    const metadata = await curateRepoMetadataWithCodex({
      directory: "/workspace/repos/archa",
      repo: {
        name: "archa",
        url: "https://github.com/leanish/archa.git",
        defaultBranch: "main"
      },
      inferredMetadata,
      runCodexPromptFn: null as never
    });

    expect(metadata).toEqual(inferredMetadata);
  });

  it("truncates long descriptions and filters invalid routing entries", async () => {
    const metadata = await curateRepoMetadataWithCodex({
      directory: "/workspace/repos/noisy-repo",
      repo: {
        name: "noisy-repo",
        url: "https://github.com/leanish/noisy-repo.git",
        defaultBranch: "main"
      },
      inferredMetadata: {
        description: "Fallback description",
        routing: {
          role: "shared-library",
          reach: ["shared-library"],
          responsibilities: ["Keeps fallback responsibilities."],
          owns: ["fallback ownership"],
          exposes: ["npm package"],
          consumes: ["GitHub API"],
          workflows: ["Fallback workflow."],
          boundaries: ["Fallback boundary."],
          selectWhen: ["Fallback selectWhen."],
          selectWithOtherReposWhen: ["Fallback cross-repo guidance."]
        }
      },
      runCodexPromptFn: vi.fn(async () => ({
        text: JSON.stringify({
          description: "x".repeat(220),
          routing: {
            role: 123,
            reach: "bad",
            responsibilities: [123, "", "Refines responsibilities.", "refines responsibilities."],
            owns: ["", "Owns checkout.", "owns checkout.", 42, "Owns sync."],
            exposes: ["", "archa CLI", "Archa CLI"],
            consumes: [false, "Node.js", "node.js", "git", "GitHub API"],
            workflows: ["", "Handles sync flows."],
            boundaries: [],
            selectWhen: ["", "Select when the question is about sync."],
            selectWithOtherReposWhen: null
          }
        })
      }))
    });

    expect(metadata.description).toHaveLength(180);
    expect(metadata.description.endsWith("...")).toBe(true);
    expect(metadata.routing).toEqual({
      role: "shared-library",
      reach: ["shared-library"],
      responsibilities: ["Refines responsibilities."],
      owns: ["Owns checkout.", "Owns sync."],
      exposes: ["archa CLI"],
      consumes: ["GitHub API"],
      workflows: ["Handles sync flows."],
      boundaries: [],
      selectWhen: ["Select when the question is about sync."],
      selectWithOtherReposWhen: ["Fallback cross-repo guidance."]
    });
  });

  it("lets Codex clear routing arrays explicitly", async () => {
    const metadata = await curateRepoMetadataWithCodex({
      directory: "/workspace/repos/noisy-repo",
      repo: {
        name: "noisy-repo",
        url: "https://github.com/leanish/noisy-repo.git",
        defaultBranch: "main"
      },
      inferredMetadata: {
        description: "Shared utilities",
        routing: {
          role: "shared-library",
          reach: ["shared-library"],
          responsibilities: ["Provides shared utilities."],
          owns: ["utilities"],
          exposes: ["npm package"],
          consumes: ["GitHub API"],
          workflows: ["Handles utility workflows."],
          boundaries: ["Do not select for app-specific behavior."],
          selectWhen: ["The question is about utilities."],
          selectWithOtherReposWhen: ["Use with app repos when tracing consumers."]
        }
      },
      runCodexPromptFn: vi.fn(async () => ({
        text: JSON.stringify({
          description: "Shared utilities",
          routing: {
            role: "shared-library",
            reach: [],
            responsibilities: [],
            owns: [],
            exposes: [],
            consumes: [],
            workflows: [],
            boundaries: [],
            selectWhen: [],
            selectWithOtherReposWhen: []
          }
        })
      }))
    });

    expect(metadata).toEqual({
      description: "Shared utilities",
      routing: {
        role: "shared-library",
        reach: [],
        responsibilities: [],
        owns: [],
        exposes: [],
        consumes: [],
        workflows: [],
        boundaries: [],
        selectWhen: [],
        selectWithOtherReposWhen: []
      }
    });
  });
});
