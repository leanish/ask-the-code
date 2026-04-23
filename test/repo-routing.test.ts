import { describe, expect, it } from "vitest";

import {
  createEmptyRepoRouting,
  filterRepoRoutingConsumes,
  getRepoRoutingSelectionEvidence,
  hasRepoRoutingContent,
  normalizeRepoRouting,
  summarizeRepoRouting
} from "../src/core/repos/repo-routing.js";

describe("repo-routing", () => {
  it("returns an empty routing card for null values", () => {
    expect(normalizeRepoRouting(null, {
      repoName: "ask-the-code",
      sourcePath: "/tmp/config.json"
    })).toEqual(createEmptyRepoRouting());
  });

  it("normalizes routing content and removes case-insensitive duplicates", () => {
    expect(normalizeRepoRouting({
      role: " developer-cli ",
      reach: ["cli", "CLI", "http-server"],
      responsibilities: ["Owns repo selection.", "Owns repo selection."],
      owns: ["repo selection", "Repo Selection", "question answering"],
      exposes: ["atc CLI", "atc CLI", "atc-server"],
      consumes: ["Codex"],
      workflows: ["Repo-aware Q&A"],
      boundaries: ["Do not select only because another repo mentions Codex."],
      selectWhen: ["The question is about repo selection."],
      selectWithOtherReposWhen: ["Use with config repos when tracing selection inputs."]
    }, {
      repoName: "ask-the-code",
      sourcePath: "/tmp/config.json"
    })).toEqual({
      role: "developer-cli",
      reach: ["cli", "http-server"],
      responsibilities: ["Owns repo selection."],
      owns: ["repo selection", "question answering"],
      exposes: ["atc CLI", "atc-server"],
      consumes: ["Codex"],
      workflows: ["Repo-aware Q&A"],
      boundaries: ["Do not select only because another repo mentions Codex."],
      selectWhen: ["The question is about repo selection."],
      selectWithOtherReposWhen: ["Use with config repos when tracing selection inputs."]
    });
  });

  it("throws clear errors for invalid routing payloads", () => {
    expect(() => normalizeRepoRouting("bad", {
      repoName: "ask-the-code",
      sourcePath: "/tmp/config.json"
    })).toThrow('repo "ask-the-code" has non-object "routing"');

    expect(() => normalizeRepoRouting({
      role: "developer-cli",
      reach: "cli"
    }, {
      repoName: "ask-the-code",
      sourcePath: "/tmp/config.json"
    })).toThrow('repo "ask-the-code" has non-array "reach"');

    expect(() => normalizeRepoRouting({
      role: "developer-cli",
      reach: ["cli", ""]
    }, {
      repoName: "ask-the-code",
      sourcePath: "/tmp/config.json"
    })).toThrow("has non-string or empty reach");
  });

  it("extracts selection evidence and summarizes populated routing cards", () => {
    const routing = {
      role: "developer-cli",
      reach: ["cli", "http-server"],
      responsibilities: ["Owns repo selection."],
      owns: ["repo selection", "question answering"],
      exposes: ["atc CLI", "atc-server"],
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
      "atc CLI",
      "atc-server",
      "Codex",
      "Repo-aware Q&A",
      "Do not select only because another repo mentions Codex.",
      "The question is about repo selection.",
      "Use with config repos when tracing selection inputs."
    ]);
    expect(summarizeRepoRouting(createEmptyRepoRouting())).toBe("");
    expect(summarizeRepoRouting(routing)).toBe(
      "role=developer-cli reach=cli,http-server owns=repo selection,question answering exposes=atc CLI,atc-server"
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
      "Shopify APIs",
      "GitHub API"
    ])).toEqual([
      "MongoDB",
      "Redis",
      "Shopify APIs",
      "GitHub API"
    ]);
  });
});
