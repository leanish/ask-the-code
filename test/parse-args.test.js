import { describe, expect, it } from "vitest";

import { HelpError, parseArgs } from "../src/cli/parse-args.js";

describe("parseArgs", () => {
  it("defaults ask command to gpt-5.4-mini low", () => {
    const parsed = parseArgs(["How", "is", "x-codec-meta", "implemented?"], {});

    expect(parsed.command).toBe("ask");
    expect(parsed.audience).toBe("general");
    expect(parsed.model).toBe("gpt-5.4-mini");
    expect(parsed.reasoningEffort).toBe("low");
    expect(parsed.question).toBe("How is x-codec-meta implemented?");
  });

  it("supports repos sync subcommand", () => {
    const parsed = parseArgs(["repos", "sync", "sqs-codec", "java-conventions"], {});

    expect(parsed.command).toBe("repos-sync");
    expect(parsed.repoNames).toEqual(["sqs-codec", "java-conventions"]);
  });

  it("supports config path, init, and discover-github subcommands", () => {
    expect(parseArgs(["config", "path"], {})).toEqual({ command: "config-path" });
    expect(parseArgs(["config", "init", "--catalog", "/tmp/catalog.json", "--managed-repos-root", "/tmp/repos", "--force"], {}))
      .toEqual({
        command: "config-init",
        catalogPath: "/tmp/catalog.json",
        managedReposRoot: "/tmp/repos",
        force: true
      });
    expect(parseArgs(["config", "discover-github", "--owner", "leanish"], {}))
      .toEqual({
        command: "config-discover-github",
        owner: "leanish",
        includeForks: true,
        includeArchived: false,
        addRepoNames: [],
        overrideRepoNames: []
      });
    expect(parseArgs(["config", "discover-github"], {}))
      .toEqual({
        command: "config-discover-github",
        owner: null,
        includeForks: true,
        includeArchived: false,
        addRepoNames: [],
        overrideRepoNames: []
      });
  });

  it("supports explicit GitHub discovery selections and fork exclusion", () => {
    expect(parseArgs([
      "config",
      "discover-github",
      "--owner",
      "leanish",
      "--add",
      "archa,java-conventions",
      "--override",
      "foundation",
      "--exclude-forks",
      "--include-archived"
    ], {})).toEqual({
      command: "config-discover-github",
      owner: "leanish",
      includeForks: false,
      includeArchived: true,
      addRepoNames: ["archa", "java-conventions"],
      overrideRepoNames: ["foundation"]
    });
  });

  it("rejects the removed include-forks flag", () => {
    expect(() => parseArgs([
      "config",
      "discover-github",
      "--include-forks"
    ], {})).toThrow("Unknown config discover-github option: --include-forks");
  });

  it("parses ask options and env overrides", () => {
    const parsed = parseArgs(
      ["--repo", "sqs-codec,java-conventions", "--audience", "codebase", "--model", "gpt-5.4", "--reasoning-effort", "high", "--no-sync", "--no-synthesis", "How", "does", "it", "work?"],
      {
        ARCHA_DEFAULT_MODEL: "ignored",
        ARCHA_DEFAULT_REASONING_EFFORT: "low"
      }
    );

    expect(parsed.repoNames).toEqual(["sqs-codec", "java-conventions"]);
    expect(parsed.audience).toBe("codebase");
    expect(parsed.model).toBe("gpt-5.4");
    expect(parsed.reasoningEffort).toBe("high");
    expect(parsed.noSync).toBe(true);
    expect(parsed.noSynthesis).toBe(true);
    expect(parsed.question).toBe("How does it work?");
  });

  it("uses the new default-setting env vars when flags are absent", () => {
    const parsed = parseArgs(["How", "does", "it", "work?"], {
      ARCHA_DEFAULT_MODEL: "gpt-5.4-mini",
      ARCHA_DEFAULT_REASONING_EFFORT: "medium"
    });

    expect(parsed.model).toBe("gpt-5.4-mini");
    expect(parsed.reasoningEffort).toBe("medium");
  });

  it("keeps supporting legacy env var names for compatibility", () => {
    const parsed = parseArgs(["How", "does", "it", "work?"], {
      ARCHA_MODEL: "gpt-5.4-mini",
      ARCHA_REASONING_EFFORT: "medium"
    });

    expect(parsed.model).toBe("gpt-5.4-mini");
    expect(parsed.reasoningEffort).toBe("medium");
  });

  it("prefers the new env var names over legacy aliases when both are set", () => {
    const parsed = parseArgs(["How", "does", "it", "work?"], {
      ARCHA_DEFAULT_MODEL: "gpt-5.4",
      ARCHA_MODEL: "gpt-5.4-mini",
      ARCHA_DEFAULT_REASONING_EFFORT: "low",
      ARCHA_REASONING_EFFORT: "high"
    });

    expect(parsed.model).toBe("gpt-5.4");
    expect(parsed.reasoningEffort).toBe("low");
  });

  it("supports reading the question from a file", () => {
    const parsed = parseArgs(["--repo", "sqs-codec", "--question-file", "/tmp/question.txt"], {});

    expect(parsed.repoNames).toEqual(["sqs-codec"]);
    expect(parsed.questionFile).toBe("/tmp/question.txt");
    expect(parsed.question).toBe("");
  });

  it("supports -- to stop option parsing for question text", () => {
    const parsed = parseArgs(["--", "--repo", "sqs-codec", "question"], {});

    expect(parsed.command).toBe("ask");
    expect(parsed.question).toBe("--repo sqs-codec question");
  });

  it("supports repos list subcommand", () => {
    const parsed = parseArgs(["repos", "list"], {});

    expect(parsed).toEqual({ command: "repos-list" });
  });

  it("returns empty repoNames when syncing all repos", () => {
    const parsed = parseArgs(["repos", "sync"], {});

    expect(parsed.command).toBe("repos-sync");
    expect(parsed.repoNames).toEqual([]);
  });

  it("throws help text for missing ask question", () => {
    expect(() => parseArgs([], {})).toThrow(/Usage:/);
  });

  it("throws help text for ask help flag", () => {
    expect(() => parseArgs(["--help"], {})).toThrow(HelpError);
  });

  it("throws for unknown ask options", () => {
    expect(() => parseArgs(["--no-syn", "How", "does", "it", "work?"], {}))
      .toThrow(/Unknown ask option: --no-syn/);
  });

  it("throws when an option value is missing", () => {
    expect(() => parseArgs(["--repo"], {})).toThrow("Missing value for --repo");
  });

  it("throws when both a positional question and question file are provided", () => {
    expect(() => parseArgs(["--question-file", "/tmp/question.txt", "How", "does", "it", "work?"], {}))
      .toThrow("Use either a positional question or --question-file, not both");
  });

  it("throws for unsupported audiences", () => {
    expect(() => parseArgs(["--audience", "internal", "How", "does", "it", "work?"], {}))
      .toThrow("Unsupported audience: internal. Use one of: general, codebase.");
  });

  it("throws help text for repos help flag", () => {
    expect(() => parseArgs(["repos", "--help"], {})).toThrow(HelpError);
  });

  it("throws help text for repos sync help flag", () => {
    expect(() => parseArgs(["repos", "sync", "--help"], {})).toThrow(HelpError);
  });

  it("throws help text for repos sync help flag even when combined with other args", () => {
    expect(() => parseArgs(["repos", "sync", "sqs-codec", "--help"], {})).toThrow(HelpError);
  });

  it("throws for unknown repos subcommand", () => {
    expect(() => parseArgs(["repos", "prune"], {})).toThrow(/Unknown repos subcommand: prune/);
  });

  it("throws for unknown repos sync options", () => {
    expect(() => parseArgs(["repos", "sync", "--all"], {})).toThrow(/Unknown repos sync option: --all/);
  });

  it("throws for unknown config subcommand", () => {
    expect(() => parseArgs(["config", "prune"], {})).toThrow(/Unknown config subcommand: prune/);
  });

  it("throws help text for config help flag", () => {
    expect(() => parseArgs(["config", "--help"], {})).toThrow(HelpError);
  });

  it("throws help text for config init help flag", () => {
    expect(() => parseArgs(["config", "init", "--help"], {})).toThrow(HelpError);
  });

  it("throws for unknown config init options", () => {
    expect(() => parseArgs(["config", "init", "--wat"], {})).toThrow(/Unknown config init option: --wat/);
  });

  it("throws help text for config discover-github help flag", () => {
    expect(() => parseArgs(["config", "discover-github", "--help"], {})).toThrow(HelpError);
  });

  it("throws for unknown config discover-github options", () => {
    expect(() => parseArgs(["config", "discover-github", "--owner", "leanish", "--wat"], {}))
      .toThrow(/Unknown config discover-github option: --wat/);
  });

  it("accepts explicit GitHub discovery selections without an apply flag", () => {
    expect(parseArgs([
      "config",
      "discover-github",
      "--owner",
      "leanish",
      "--add",
      "archa"
    ], {})).toEqual({
      command: "config-discover-github",
      owner: "leanish",
      includeForks: true,
      includeArchived: false,
      addRepoNames: ["archa"],
      overrideRepoNames: []
    });
  });

});
