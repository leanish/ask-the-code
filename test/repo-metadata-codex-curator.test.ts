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
      model: "gpt-5.4",
      workingDirectory: "/workspace/repos/java-conventions",
      reasoningEffort: "medium",
      timeoutMs: 120_000
    }));
    expect(runCodexPromptFn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining(
        "Compact selection mostly sees description, routing.role, routing.reach, routing.owns, routing.exposes, routing.selectWhen, and routing.boundaries."
      )
    }));
    expect(runCodexPromptFn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining(
        "description: one sentence, <= 180 characters, concrete and neutral, naming the primary owned surface rather than the implementation stack."
      )
    }));
    expect(runCodexPromptFn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining(
        "Do not use frameworks, languages, runtimes, or build tools as routing signals unless they are part of a real exposed surface."
      )
    }));
    expect(runCodexPromptFn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining(
        "List the most distinctive package names, domains, endpoints, and concrete API surfaces before broader summaries in routing.owns, routing.exposes, routing.selectWhen, and routing.boundaries."
      )
    }));
    expect(runCodexPromptFn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining(
        "Prefer examples like `product data DB`, `search index`, `search cache`, or `bulk export queue` over bare `MongoDB`, `Elasticsearch`, `Redis`, or `SQS`."
      )
    }));
    expect(runCodexPromptFn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining(
        "Keep product or vendor names in routing.consumes only when the external system itself is a meaningful surface users may ask about, such as `Shopify Admin API` or `Klaviyo`."
      )
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

  it("replaces weak curated descriptions and prioritizes concrete routing surfaces", async () => {
    const metadata = await curateRepoMetadataWithCodex({
      directory: "/workspace/repos/merchant-platform",
      repo: {
        name: "merchant-platform",
        url: "https://github.com/leanish/merchant-platform.git",
        defaultBranch: "main"
      },
      inferredMetadata: {
        description: "Play framework based commerce service",
        routing: createEmptyRepoRouting()
      },
      runCodexPromptFn: vi.fn(async () => ({
        text: JSON.stringify({
          description: "Play framework based commerce service",
          routing: {
            role: "platform-application",
            reach: ["merchant admin UI", "merchant GraphQL and REST APIs", "cron job endpoints"],
            owns: ["merchant admin UI", "POST /api/v1/graphql"],
            exposes: ["admin.example.com", "POST /api/v1/graphql", "/cron/*"],
            boundaries: [
              "Do not select only because it consumes shared infrastructure or external services.",
              "Do not select for scheduler ownership outside /cron/* handlers."
            ],
            selectWhen: [
              "Select when the task mentions admin.example.com behavior.",
              "Select when the task touches /api/v1/graphql."
            ]
          }
        })
      }))
    });

    expect(metadata.description).toBe(
      "Owns merchant admin UI, merchant GraphQL and REST APIs, and cron job endpoints."
    );
    expect(metadata.routing.exposes).toEqual([
      "POST /api/v1/graphql",
      "/cron/*",
      "admin.example.com"
    ]);
    expect(metadata.routing.selectWhen[0]).toBe("Select when the task mentions admin.example.com behavior.");
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
