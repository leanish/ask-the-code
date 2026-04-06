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

  it("allows selecting colliding repo names via owner-qualified identifiers", () => {
    const multiOwnerPlan = {
      entries: [
        {
          status: "new",
          repo: {
            name: "shared",
            sourceOwner: "leanish",
            sourceFullName: "leanish/shared",
            url: "https://github.com/leanish/shared.git",
            defaultBranch: "main",
            description: "",
            topics: []
          },
          suggestions: []
        },
        {
          status: "new",
          repo: {
            name: "shared",
            sourceOwner: "Nosto",
            sourceFullName: "Nosto/shared",
            url: "https://github.com/Nosto/shared.git",
            defaultBranch: "main",
            description: "",
            topics: []
          },
          suggestions: []
        }
      ]
    };

    expect(selectGithubDiscoveryRepos(multiOwnerPlan, {
      addRepoNames: ["leanish/shared", "Nosto/shared"]
    })).toEqual({
      reposToAdd: [multiOwnerPlan.entries[0].repo, multiOwnerPlan.entries[1].repo],
      reposToOverride: []
    });
  });

  it("accepts owner-qualified selections case-insensitively for single-owner discovery", () => {
    const singleOwnerPlan = {
      owner: "leanish",
      entries: [
        {
          status: "new",
          repo: {
            name: "nullability",
            url: "https://github.com/leanish/nullability.git",
            defaultBranch: "main",
            description: "",
            topics: []
          },
          suggestions: []
        }
      ]
    };

    expect(selectGithubDiscoveryRepos(singleOwnerPlan, {
      addRepoNames: ["Leanish/Nullability"]
    })).toEqual({
      reposToAdd: [singleOwnerPlan.entries[0].repo],
      reposToOverride: []
    });
  });

  it("prompts once for comma-separated add and override selections", async () => {
    const outputWrites = [];
    const fakeReadline = {
      question: async prompt => {
        outputWrites.push(prompt);
        return "archa, java-conventions, foundation";
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
    expect(outputWrites.join("")).toContain("Select repos to add or override");
    expect(outputWrites.join("")).toContain("Press Enter to add all new repos");
    expect(outputWrites.join("")).toContain("New (2): archa, java-conventions");
    expect(outputWrites.join("")).toContain("Configured already (1): foundation");
    expect(outputWrites.join("")).toContain("Name conflicts (1): shared");
  });

  it("defaults Enter to all new repos after confirmation", async () => {
    const prompts = [];
    const fakeReadline = {
      question: async prompt => {
        prompts.push(prompt);
        return "";
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
      reposToOverride: []
    });
    expect(prompts).toEqual([
      'Select repos to add or override (comma-separated, "*" for all)\n'
        + "Press Enter to add all new repos, or type repo names to customize.\n"
        + "New (2): archa, java-conventions\n"
        + "Configured already (1): foundation\n"
        + "Name conflicts (1): shared\n"
        + "> ",
      "Add all 2 new repo(s)? Press Enter to confirm, or type repo names to customize.\n> "
    ]);
  });

  it("shows qualified configured labels and visible conflicts for colliding repo names", async () => {
    const collisionPlan = {
      ownerDisplay: "leanish + orgs",
      entries: [
        {
          status: "configured",
          repo: {
            name: "nullability",
            sourceOwner: "leanish",
            sourceFullName: "leanish/nullability",
            url: "https://github.com/leanish/nullability.git",
            defaultBranch: "main",
            description: "",
            topics: []
          },
          suggestions: []
        },
        {
          status: "conflict",
          repo: {
            name: "nullability",
            sourceOwner: "Nosto",
            sourceFullName: "Nosto/nullability",
            url: "https://github.com/Nosto/nullability.git",
            defaultBranch: "main",
            description: "",
            topics: []
          },
          configuredRepo: {
            name: "nullability",
            url: "https://github.com/leanish/nullability.git"
          },
          suggestions: []
        }
      ]
    };
    const prompts = [];
    const fakeReadline = {
      question: async prompt => {
        prompts.push(prompt);
        return "";
      },
      close() {}
    };

    const result = await promptGithubDiscoverySelection(collisionPlan, {
      input: { isTTY: true },
      output: { isTTY: true },
      createInterfaceFn() {
        return fakeReadline;
      }
    });

    expect(result).toEqual({
      reposToAdd: [],
      reposToOverride: []
    });
    expect(prompts[0]).toContain("Configured already (1): leanish/nullability");
    expect(prompts[0]).toContain("Name conflicts (1): Nosto/nullability");
  });

  it("groups repos by source owner when multiple owners are in scope", async () => {
    const multiOwnerPlan = {
      ownerDisplay: "leanish + orgs",
      entries: [
        {
          status: "new",
          repo: {
            name: "archa",
            sourceOwner: "leanish",
            sourceFullName: "leanish/archa",
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
            name: "playcart",
            sourceOwner: "Nosto",
            sourceFullName: "Nosto/playcart",
            url: "https://github.com/Nosto/playcart.git",
            defaultBranch: "master",
            description: "Storefront backend",
            topics: ["play"]
          },
          suggestions: []
        }
      ]
    };
    const prompts = [];
    const fakeReadline = {
      question: async prompt => {
        prompts.push(prompt);
        return "Nosto/playcart";
      },
      close() {}
    };

    const result = await promptGithubDiscoverySelection(multiOwnerPlan, {
      input: { isTTY: true },
      output: { isTTY: true },
      createInterfaceFn() {
        return fakeReadline;
      }
    });

    expect(result).toEqual({
      reposToAdd: [multiOwnerPlan.entries[1].repo],
      reposToOverride: []
    });
    expect(prompts[0]).toContain("New (2):\nleanish: archa\nNosto: playcart");
  });

  it("keeps owner-qualified labels only when repo names collide across owners", async () => {
    const collisionPlan = {
      ownerDisplay: "leanish + orgs",
      entries: [
        {
          status: "new",
          repo: {
            name: "shared",
            sourceOwner: "leanish",
            sourceFullName: "leanish/shared",
            url: "https://github.com/leanish/shared.git",
            defaultBranch: "main",
            description: "Personal shared repo",
            topics: []
          },
          suggestions: []
        },
        {
          status: "new",
          repo: {
            name: "shared",
            sourceOwner: "Nosto",
            sourceFullName: "Nosto/shared",
            url: "https://github.com/Nosto/shared.git",
            defaultBranch: "main",
            description: "Company shared repo",
            topics: []
          },
          suggestions: []
        }
      ]
    };
    const prompts = [];
    const fakeReadline = {
      question: async prompt => {
        prompts.push(prompt);
        return "Nosto/shared";
      },
      close() {}
    };

    const result = await promptGithubDiscoverySelection(collisionPlan, {
      input: { isTTY: true },
      output: { isTTY: true },
      createInterfaceFn() {
        return fakeReadline;
      }
    });

    expect(result).toEqual({
      reposToAdd: [collisionPlan.entries[1].repo],
      reposToOverride: []
    });
    expect(prompts[0]).toContain("leanish: leanish/shared");
    expect(prompts[0]).toContain("Nosto: Nosto/shared");
  });

  it("rejects interactive selection without a tty", async () => {
    await expect(promptGithubDiscoverySelection(plan, {
      input: { isTTY: false },
      output: { isTTY: true, write() { return true; } }
    })).rejects.toThrow("Interactive GitHub discovery requires a TTY.");
  });
});
