import { describe, expect, it, vi } from "vitest";

import { curateRepoMetadataWithCodex } from "../src/repo-metadata-codex-curator.js";

describe("repo-metadata-codex-curator", () => {
  it("accepts Codex-curated metadata and normalizes it", async () => {
    const runCodexPromptFn = vi.fn(async () => ({
      text: JSON.stringify({
        description: "Shared Gradle plugin conventions for JDK-based projects.",
        topics: ["Gradle Plugin", "Conventions", "Java", "java-conventions"],
        classifications: ["library", "backend", "unknown"]
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
        topics: ["gradle", "conventions", "jdk"],
        classifications: ["library"]
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
      topics: ["gradle-plugin"],
      classifications: ["library", "backend"]
    });
  });

  it("falls back to inferred metadata when Codex does not return valid JSON", async () => {
    const inferredMetadata = {
      description: "Terminator is a small Java library.",
      topics: ["java", "shutdown", "blocking"],
      classifications: ["library"]
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

  it("lets Codex clear noisy topics and classifications explicitly", async () => {
    const metadata = await curateRepoMetadataWithCodex({
      directory: "/workspace/repos/noisy-repo",
      repo: {
        name: "noisy-repo",
        url: "https://github.com/leanish/noisy-repo.git",
        defaultBranch: "main"
      },
      inferredMetadata: {
        description: "Shared utilities",
        topics: ["shared", "utilities"],
        classifications: ["infra"]
      },
      runCodexPromptFn: vi.fn(async () => ({
        text: JSON.stringify({
          description: "Shared utilities",
          topics: [],
          classifications: []
        })
      }))
    });

    expect(metadata).toEqual({
      description: "Shared utilities",
      topics: [],
      classifications: []
    });
  });

  it("drops Codex-invented external for shared libraries without outward-facing evidence", async () => {
    const metadata = await curateRepoMetadataWithCodex({
      directory: "/workspace/repos/java-conventions",
      repo: {
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects"
      },
      sourceRepo: {
        description: "Shared Gradle conventions for JDK-based projects",
        topics: [],
        size: 245
      },
      inferredMetadata: {
        description: "Shared Gradle conventions for JDK-based projects",
        topics: ["gradle", "conventions", "jdk"],
        classifications: ["library"]
      },
      runCodexPromptFn: vi.fn(async () => ({
        text: JSON.stringify({
          description: "Shared Gradle conventions for JDK-based projects.",
          topics: ["gradle-plugin", "conventions", "java"],
          classifications: ["library", "external"]
        })
      }))
    });

    expect(metadata).toEqual({
      description: "Shared Gradle conventions for JDK-based projects.",
      topics: ["gradle-plugin"],
      classifications: ["library"]
    });
  });

  it("drops weak topics and service-app misclassifications from Codex cleanup", async () => {
    const metadata = await curateRepoMetadataWithCodex({
      directory: "/workspace/repos/playcart",
      repo: {
        name: "playcart",
        url: "https://github.com/Nosto/playcart.git",
        defaultBranch: "master",
        description: "Play framework based implementation of Nosto service"
      },
      sourceRepo: {
        description: "Play framework based implementation of Nosto service",
        topics: [],
        size: 150_000
      },
      inferredMetadata: {
        description: "Main web application for merchant backend, merchant frontend, and api services.",
        topics: ["merchant", "backend", "frontend", "api", "checkout", "storefront", "onboarding", "pricing", "personalization", "recommendations"],
        classifications: ["backend", "external"]
      },
      runCodexPromptFn: vi.fn(async () => ({
        text: JSON.stringify({
          description: "Main web application for merchant backend, merchant frontend, and api services.",
          topics: ["merchant-backend", "checkout", "api-services", "personalization", "recommendations", "https", "setup", "can", "nosto"],
          classifications: ["infra", "library", "external", "microservice", "backend"]
        })
      }))
    });

    expect(metadata).toEqual({
      description: "Main web application for merchant backend, merchant frontend, and api services.",
      topics: ["merchant-backend", "checkout", "api-services", "personalization", "recommendations"],
      classifications: ["external", "backend"]
    });
  });
});
