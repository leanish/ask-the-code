import { describe, expect, it } from "vitest";

import { selectRepos } from "../src/repo-selection.js";

const config = {
  repos: [
    {
      name: "sqs-codec",
      description: "SQS execution interceptor with compression and checksum metadata",
      topics: ["aws", "sqs", "compression", "checksum"]
    },
    {
      name: "archa",
      description: "Repo-aware CLI for engineering Q&A with local Codex",
      topics: ["cli", "codex", "qa"]
    },
    {
      name: "java-conventions",
      description: "Java conventions and build defaults",
      topics: ["java", "conventions"],
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

  it("falls back to all configured repos when nothing scores positively", () => {
    const repos = selectRepos(config, "totally unrelated question", null);

    expect(repos.map(repo => repo.name)).toEqual(["sqs-codec", "archa", "java-conventions"]);
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
