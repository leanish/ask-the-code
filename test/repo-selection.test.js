import { describe, expect, it } from "vitest";

import { selectRepos } from "../src/core/repos/repo-selection.js";

const config = {
  repos: [
    {
      name: "sqs-codec",
      description: "SQS execution interceptor with compression and checksum metadata",
      topics: ["aws", "sqs", "compression", "checksum"],
      classifications: ["library"]
    },
    {
      name: "archa",
      description: "Repo-aware CLI for engineering Q&A with local Codex",
      topics: ["cli", "codex", "qa"],
      classifications: ["cli"]
    },
    {
      name: "java-conventions",
      description: "Java conventions and build defaults",
      topics: ["java", "conventions"],
      classifications: ["infra"],
      aliases: ["conventions"]
    }
  ]
};

describe("selectRepos", () => {
  it("prefers matching topics during automatic selection", () => {
    const repos = selectRepos(config, "How does SQS compression metadata work?", null);

    expect(repos[0].name).toBe("sqs-codec");
  });

  it("honors explicit repo names", () => {
    const repos = selectRepos(config, "anything", ["archa"]);

    expect(repos.map(repo => repo.name)).toEqual(["archa"]);
  });

  it("honors explicit repo aliases", () => {
    const repos = selectRepos(config, "anything", ["conventions"]);

    expect(repos.map(repo => repo.name)).toEqual(["java-conventions"]);
  });

  it("throws for unknown explicit repos", () => {
    expect(() => selectRepos(config, "anything", ["missing-repo"])).toThrow(/Unknown managed repo/);
  });

  it("weights separate classifications more strongly than generic topics", () => {
    const repos = selectRepos({
      repos: [
        {
          name: "shared-lib",
          description: "Shared utilities and helpers",
          topics: ["helpers", "retry"],
          classifications: ["library"]
        },
        {
          name: "infra-live",
          description: "Deployment helpers and retry tooling",
          topics: ["helpers", "retry"],
          classifications: ["infra"]
        }
      ]
    }, "Which infra repo owns retry tooling?", null);

    expect(repos[0].name).toBe("infra-live");
  });

  it("matches classification aliases like lib to library", () => {
    const repos = selectRepos({
      repos: [
        {
          name: "shared-lib",
          description: "Shared utilities and helpers",
          topics: ["helpers"],
          classifications: ["library"]
        },
        {
          name: "app-service",
          description: "Application service",
          topics: ["helpers"],
          classifications: ["microservice"]
        }
      ]
    }, "Which lib exposes helpers?", null);

    expect(repos[0].name).toBe("shared-lib");
  });

  it("matches external-facing cues more strongly than generic topics", () => {
    const repos = selectRepos({
      repos: [
        {
          name: "platform-api",
          description: "Platform GraphQL API",
          topics: ["commerce"],
          classifications: ["external", "backend"]
        },
        {
          name: "internal-admin",
          description: "Backoffice tooling",
          topics: ["commerce"],
          classifications: ["internal"]
        }
      ]
    }, "Which external graphql service owns the commerce API?", null);

    expect(repos[0].name).toBe("platform-api");
  });

  it("scores repo names directly without needing duplicated topics", () => {
    const repos = selectRepos({
      repos: [
        {
          name: "java-conventions",
          description: "Shared Gradle defaults",
          topics: ["gradle"],
          classifications: ["infra"]
        },
        {
          name: "build-logic",
          description: "Shared Gradle defaults",
          topics: ["gradle"],
          classifications: ["infra"]
        }
      ]
    }, "Which repo owns the conventions defaults?", null);

    expect(repos[0].name).toBe("java-conventions");
  });

  it("falls back to all configured repos when nothing scores positively", () => {
    const repos = selectRepos(config, "totally unrelated question", null);

    expect(repos.map(repo => repo.name)).toEqual(["sqs-codec", "archa", "java-conventions"]);
  });

  it("still falls back to all configured repos when only alwaysSelect repos are in scope", () => {
    const repos = selectRepos({
      repos: [
        {
          name: "foundation",
          description: "Cross-cutting shared base functionality",
          topics: [],
          alwaysSelect: true
        },
        {
          name: "archa",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          topics: ["cli", "codex", "qa"]
        },
        {
          name: "java-conventions",
          description: "Java conventions and build defaults",
          topics: ["java", "conventions"]
        }
      ]
    }, "totally unrelated question", null);

    expect(repos.map(repo => repo.name)).toEqual(["foundation", "archa", "java-conventions"]);
  });

  it("preserves configured repo order in the all-repos fallback", () => {
    const repos = selectRepos({
      repos: [
        {
          name: "java-conventions",
          description: "Java conventions and build defaults",
          topics: ["java", "conventions", "gradle"]
        },
        {
          name: "archa",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          topics: ["cli", "codex", "qa"]
        }
      ]
    }, "totally unrelated question", null);

    expect(repos.map(repo => repo.name)).toEqual(["java-conventions", "archa"]);
  });

  it("includes alwaysSelect repos during automatic selection even when they do not match the question", () => {
    const repos = selectRepos({
      repos: [
        {
          name: "foundation",
          description: "Cross-cutting shared base functionality",
          topics: [],
          alwaysSelect: true
        },
        {
          name: "java-conventions",
          description: "Java conventions and build defaults",
          topics: ["java", "conventions"]
        },
        {
          name: "archa",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          topics: ["cli", "codex", "qa"]
        }
      ]
    }, "Need build defaults details", null);

    expect(repos.map(repo => repo.name)).toEqual(["foundation", "java-conventions"]);
  });

  it("does not let a matching alwaysSelect repo consume a scored selection slot", () => {
    const repos = selectRepos({
      repos: [
        {
          name: "foundation",
          description: "Shared build defaults and base support",
          topics: ["build", "defaults"],
          alwaysSelect: true
        },
        {
          name: "java-conventions",
          description: "Java conventions and build defaults",
          topics: ["java", "conventions", "build", "defaults"]
        },
        {
          name: "gradle-rules",
          description: "Gradle rules and plugin defaults",
          topics: ["gradle", "build", "defaults"]
        },
        {
          name: "release-tools",
          description: "Release tooling and build defaults",
          topics: ["release", "build", "defaults"]
        },
        {
          name: "artifact-metadata",
          description: "Artifact metadata and build defaults",
          topics: ["artifact", "build", "defaults"]
        }
      ]
    }, "Need build defaults details", null);

    expect(repos.map(repo => repo.name)).toEqual([
      "foundation",
      "java-conventions",
      "gradle-rules",
      "release-tools",
      "artifact-metadata"
    ]);
  });

  it("still respects explicit repo narrowing even when some repos are marked alwaysSelect", () => {
    const repos = selectRepos({
      repos: [
        {
          name: "foundation",
          description: "Cross-cutting shared base functionality",
          topics: [],
          alwaysSelect: true
        },
        {
          name: "archa",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          topics: ["cli", "codex", "qa"]
        }
      ]
    }, "anything", ["archa"]);

    expect(repos.map(repo => repo.name)).toEqual(["archa"]);
  });
});
