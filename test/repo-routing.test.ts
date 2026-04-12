import { describe, expect, it } from "vitest";

import {
  chooseRepoRoutingDescription,
  createEmptyRepoRouting,
  filterRepoRoutingConsumes,
  getRepoRoutingSelectionEvidence,
  hasRepoRoutingContent,
  normalizeRepoRouting,
  prioritizeRepoRouting,
  summarizeRepoRouting
} from "../src/core/repos/repo-routing.js";

describe("repo-routing", () => {
  it("returns an empty routing card for null values", () => {
    expect(normalizeRepoRouting(null, {
      repoName: "archa",
      sourcePath: "/tmp/config.json"
    })).toEqual(createEmptyRepoRouting());
  });

  it("normalizes routing content and removes case-insensitive duplicates", () => {
    expect(normalizeRepoRouting({
      role: " developer-cli ",
      reach: ["cli", "CLI", "http-server"],
      responsibilities: ["Owns repo selection.", "Owns repo selection."],
      owns: ["repo selection", "Repo Selection", "question answering"],
      exposes: ["archa CLI", "archa CLI", "archa-server"],
      consumes: ["Codex"],
      workflows: ["Repo-aware Q&A"],
      boundaries: ["Do not select only because another repo mentions Codex."],
      selectWhen: ["The question is about repo selection."],
      selectWithOtherReposWhen: ["Use with config repos when tracing selection inputs."]
    }, {
      repoName: "archa",
      sourcePath: "/tmp/config.json"
    })).toEqual({
      role: "developer-cli",
      reach: ["cli", "http-server"],
      responsibilities: ["Owns repo selection."],
      owns: ["repo selection", "question answering"],
      exposes: ["archa CLI", "archa-server"],
      consumes: ["Codex"],
      workflows: ["Repo-aware Q&A"],
      boundaries: ["Do not select only because another repo mentions Codex."],
      selectWhen: ["The question is about repo selection."],
      selectWithOtherReposWhen: ["Use with config repos when tracing selection inputs."]
    });
  });

  it("throws clear errors for invalid routing payloads", () => {
    expect(() => normalizeRepoRouting("bad", {
      repoName: "archa",
      sourcePath: "/tmp/config.json"
    })).toThrow('repo "archa" has non-object "routing"');

    expect(() => normalizeRepoRouting({
      role: "developer-cli",
      reach: "cli"
    }, {
      repoName: "archa",
      sourcePath: "/tmp/config.json"
    })).toThrow('repo "archa" has non-array "reach"');

    expect(() => normalizeRepoRouting({
      role: "developer-cli",
      reach: ["cli", ""]
    }, {
      repoName: "archa",
      sourcePath: "/tmp/config.json"
    })).toThrow("has non-string or empty reach");
  });

  it("extracts selection evidence and summarizes populated routing cards", () => {
    const routing = {
      role: "developer-cli",
      reach: ["cli", "http-server"],
      responsibilities: ["Owns repo selection."],
      owns: ["repo selection", "question answering"],
      exposes: ["archa CLI", "archa-server"],
      consumes: ["Codex"],
      workflows: ["Repo-aware Q&A"],
      boundaries: ["Do not select only because another repo mentions Codex."],
      selectWhen: ["The question is about repo selection."],
      selectWithOtherReposWhen: ["Use with config repos when tracing selection inputs."]
    };

    expect(hasRepoRoutingContent(undefined)).toBe(false);
    expect(hasRepoRoutingContent(createEmptyRepoRouting())).toBe(false);
    expect(hasRepoRoutingContent(routing)).toBe(true);
    expect(getRepoRoutingSelectionEvidence(undefined)).toEqual([]);
    expect(getRepoRoutingSelectionEvidence(routing)).toEqual([
      "developer-cli",
      "cli",
      "http-server",
      "Owns repo selection.",
      "repo selection",
      "question answering",
      "archa CLI",
      "archa-server",
      "Codex",
      "Repo-aware Q&A",
      "Do not select only because another repo mentions Codex.",
      "The question is about repo selection.",
      "Use with config repos when tracing selection inputs."
    ]);
    expect(summarizeRepoRouting(createEmptyRepoRouting())).toBe("");
    expect(summarizeRepoRouting(routing)).toBe(
      "role=developer-cli reach=cli,http-server owns=repo selection,question answering exposes=archa CLI,archa-server"
    );
  });

  it("drops generic framework and tooling values from consumes when routing is used for selection", () => {
    expect(filterRepoRoutingConsumes([
      "Gradle",
      "Node.js",
      "Spring Boot",
      "GraphQL",
      "Git",
      "MongoDB",
      "Redis",
      "DB",
      "queue",
      "Shopify APIs",
      "GitHub API",
      "product data DB",
      "bulk export queue"
    ])).toEqual([
      "Shopify APIs",
      "GitHub API",
      "product data DB",
      "bulk export queue"
    ]);
  });

  it("prioritizes the most specific routing entries first", () => {
    const prioritized = prioritizeRepoRouting({
      role: "platform-application",
      reach: [],
      responsibilities: [],
      owns: ["merchant admin UI", "POST /api/v1/graphql", "cron handlers"],
      exposes: ["admin.example.com", "POST /api/v1/graphql", "/cron/*"],
      consumes: [],
      workflows: [],
      boundaries: [
        "Do not select only because it consumes shared infrastructure or external services.",
        "Do not select for scheduler ownership outside /cron/* handlers."
      ],
      selectWhen: [
        "Select when the task mentions admin.example.com behavior.",
        "Select when the task touches /api/v1/graphql."
      ],
      selectWithOtherReposWhen: []
    });

    expect(prioritized.owns).toEqual([
      "POST /api/v1/graphql",
      "merchant admin UI",
      "cron handlers"
    ]);
    expect(prioritized.exposes).toEqual([
      "POST /api/v1/graphql",
      "/cron/*",
      "admin.example.com"
    ]);
    expect(prioritized.boundaries[0]).toBe("Do not select for scheduler ownership outside /cron/* handlers.");
    expect(prioritized.selectWhen[0]).toBe("Select when the task mentions admin.example.com behavior.");
  });

  it("replaces weak implementation-stack descriptions with owned surfaces", () => {
    expect(chooseRepoRoutingDescription("Play framework based commerce service", {
      role: "platform-application",
      reach: ["merchant admin UI", "merchant GraphQL and REST APIs", "cron job endpoints"],
      responsibilities: [],
      owns: [],
      exposes: [],
      consumes: [],
      workflows: [],
      boundaries: [],
      selectWhen: [],
      selectWithOtherReposWhen: []
    })).toBe("Owns merchant admin UI, merchant GraphQL and REST APIs, and cron job endpoints.");
  });
});
