import { describe, expect, it } from "vitest";

import { promptGithubDiscoverySelection, selectGithubDiscoveryRepos } from "../src/github-discovery-selection.js";

describe("github-discovery-selection", () => {
  const plan = {
    entries: [
      {
        status: "new",
        repo: {
          name: "archa",
          url: "https://github.com/leanish/archa.git",
          defaultBranch: "main",
          description: "Repo-aware CLI",
          topics: ["cli"]
        },
        suggestions: []
      },
      {
        status: "new",
        repo: {
          name: "java-conventions",
          url: "https://github.com/leanish/java-conventions.git",
          defaultBranch: "main",
          description: "Shared Gradle conventions",
          topics: ["gradle"]
        },
        suggestions: []
      },
      {
        status: "configured",
        repo: {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          defaultBranch: "main",
          description: "Shared base",
          topics: ["java"]
        },
        suggestions: ["review description"]
      },
      {
        status: "conflict",
        repo: {
          name: "shared",
          url: "https://github.com/leanish/shared.git",
          defaultBranch: "main",
          description: "",
          topics: []
        },
        configuredRepo: {
          name: "foundation"
        },
        suggestions: []
      }
    ]
  };

  it("selects explicit additions and overrides case-insensitively", () => {
    expect(selectGithubDiscoveryRepos(plan, {
      addRepoNames: ["Archa"],
      overrideRepoNames: ["FOUNDATION"]
    })).toEqual({
      reposToAdd: [plan.entries[0].repo],
      reposToOverride: [plan.entries[2].repo]
    });
  });

  it("supports selecting all addable or overridable repos", () => {
    expect(selectGithubDiscoveryRepos(plan, {
      addRepoNames: ["*"],
      overrideRepoNames: ["*"]
    })).toEqual({
      reposToAdd: [plan.entries[0].repo, plan.entries[1].repo],
      reposToOverride: [plan.entries[2].repo]
    });
  });

  it("rejects explicit selections that are not available for that action", () => {
    expect(() => selectGithubDiscoveryRepos(plan, {
      addRepoNames: ["foundation"]
    })).toThrow('Unknown new repo(s) for --add: foundation.');
  });

  it("prompts for comma-separated add and override selections", async () => {
    const outputWrites = [];
    const fakeReadline = {
      question: async prompt => {
        outputWrites.push(prompt);

        if (prompt.startsWith("Add repos")) {
          return "archa, java-conventions";
        }

        return "foundation";
      },
      close() {}
    };

    const result = await promptGithubDiscoverySelection(plan, {
      input: { isTTY: true },
      output: { isTTY: true },
      createInterfaceFn() {
        return fakeReadline;
      }
    });

    expect(result).toEqual({
      reposToAdd: [plan.entries[0].repo, plan.entries[1].repo],
      reposToOverride: [plan.entries[2].repo]
    });
    expect(outputWrites.join("")).toContain("Add repos");
    expect(outputWrites.join("")).toContain("Override repos");
  });

  it("rejects interactive selection without a tty", async () => {
    await expect(promptGithubDiscoverySelection(plan, {
      input: { isTTY: false },
      output: { isTTY: true, write() { return true; } }
    })).rejects.toThrow("Interactive GitHub discovery requires a TTY.");
  });
});
