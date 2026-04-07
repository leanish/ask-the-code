import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { promptGithubDiscoverySelection, selectGithubDiscoveryRepos } from "../src/cli/setup/discovery-selection.js";

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
    expect(outputWrites.join("")).toContain("Press Enter to add all new repos, press Esc to cancel");
    expect(outputWrites.join("")).toContain("New (2): archa, java-conventions");
    expect(outputWrites.join("")).toContain("Configured already (1): foundation");
    expect(outputWrites.join("")).toContain("Name conflicts (1): shared -> foundation");
  });

  it("cancels repo selection immediately on Esc", async () => {
    const input = createRawKeypressInput();
    const output = {
      isTTY: true,
      write: vi.fn()
    };
    const readlineFactory = createPendingReadlineFactory();

    const resultPromise = promptGithubDiscoverySelection(plan, {
      input,
      output,
      createInterfaceFn: readlineFactory.createInterfaceFn
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    input.emit("keypress", "\u001b", {
      name: "escape"
    });

    const result = await resultPromise;

    expect(result).toEqual({
      reposToAdd: [],
      reposToOverride: []
    });
    expect(readlineFactory.instances).toHaveLength(1);
    expect(readlineFactory.instances[0].readline.question).toHaveBeenCalledWith(
      'Select repos to add or override (comma-separated, "*" for all)\n'
        + "Press Enter to add all new repos, press Esc to cancel, or type repo names to customize.\n"
        + "New (2): archa, java-conventions\n"
        + "Configured already (1): foundation\n"
        + "Name conflicts (1): shared -> foundation\n"
        + "> "
    );
    expect(output.write).toHaveBeenCalledTimes(1);
    expect(output.write).toHaveBeenCalledWith("\n");
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(2, false);
    expect(input.resume).toHaveBeenCalledTimes(1);
    expect(input.pause).toHaveBeenCalledTimes(1);
  });

  it("does not cancel repo selection on arrow-left keypresses", async () => {
    const input = createRawKeypressInput();
    const output = {
      isTTY: true,
      write: vi.fn()
    };
    const readlineFactory = createPendingReadlineFactory();
    let settled = false;

    const resultPromise = promptGithubDiscoverySelection(plan, {
      input,
      output,
      createInterfaceFn: readlineFactory.createInterfaceFn
    }).then(result => {
      settled = true;
      return result;
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    input.emit("keypress", "\u001b[D", {
      name: "left"
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(settled).toBe(false);

    input.emit("keypress", "\u001b", {
      name: "escape"
    });

    await expect(resultPromise).resolves.toEqual({
      reposToAdd: [],
      reposToOverride: []
    });
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
        + "Press Enter to add all new repos, press Esc to cancel, or type repo names to customize.\n"
        + "New (2): archa, java-conventions\n"
        + "Configured already (1): foundation\n"
        + "Name conflicts (1): shared -> foundation\n"
        + "> ",
      "Add all 2 new repo(s)? Press Enter to confirm, or type repo names to customize.\n> "
    ]);
  });

  it("cancels add-all confirmation immediately on Esc", async () => {
    const input = createRawKeypressInput();
    const output = {
      isTTY: true,
      write: vi.fn()
    };
    const readlineFactory = createPendingReadlineFactory();

    const resultPromise = promptGithubDiscoverySelection(plan, {
      input,
      output,
      createInterfaceFn: readlineFactory.createInterfaceFn
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    readlineFactory.instances[0].resolveQuestion("");

    await new Promise(resolve => setTimeout(resolve, 0));
    input.emit("keypress", "\u001b", {
      name: "escape"
    });

    const result = await resultPromise;

    expect(result).toEqual({
      reposToAdd: [],
      reposToOverride: []
    });
    expect(readlineFactory.instances).toHaveLength(2);
    expect(readlineFactory.instances[0].readline.question).toHaveBeenCalledWith(
      'Select repos to add or override (comma-separated, "*" for all)\n'
        + "Press Enter to add all new repos, press Esc to cancel, or type repo names to customize.\n"
        + "New (2): archa, java-conventions\n"
        + "Configured already (1): foundation\n"
        + "Name conflicts (1): shared -> foundation\n"
        + "> "
    );
    expect(readlineFactory.instances[1].readline.question).toHaveBeenCalledWith(
      "Add all 2 new repo(s)? Press Enter to confirm, or type repo names to customize.\n> "
    );
    expect(output.write).toHaveBeenCalledTimes(1);
    expect(output.write).toHaveBeenCalledWith("\n");
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(2, false);
    expect(input.setRawMode).toHaveBeenNthCalledWith(3, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(4, false);
    expect(input.resume).toHaveBeenCalledTimes(2);
    expect(input.pause).toHaveBeenCalledTimes(2);
  });

  it("shows owner-qualified configured and new entries for colliding repo names", async () => {
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
          status: "new",
          repo: {
            name: "nosto/nullability",
            sourceOwner: "Nosto",
            sourceFullName: "Nosto/nullability",
            url: "https://github.com/Nosto/nullability.git",
            defaultBranch: "main",
            description: "",
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
      reposToAdd: [collisionPlan.entries[1].repo],
      reposToOverride: []
    });
    expect(prompts[0]).toContain("New (1): Nosto/nullability");
    expect(prompts[0]).toContain("Configured already (1): leanish/nullability");
    expect(prompts[1]).toBe(
      "Add all 1 new repo(s)? Press Enter to confirm, or type repo names to customize.\n> "
    );
  });

  it("derives owner-qualified configured labels from the GitHub URL when source metadata is missing", async () => {
    const collisionPlan = {
      ownerDisplay: "leanish + orgs",
      entries: [
        {
          status: "configured",
          repo: {
            name: "nullability",
            url: "https://github.com/leanish/nullability.git",
            defaultBranch: "main",
            description: "",
            topics: []
          },
          suggestions: []
        },
        {
          status: "new",
          repo: {
            name: "nosto/nullability",
            sourceOwner: "Nosto",
            sourceFullName: "Nosto/nullability",
            url: "https://github.com/Nosto/nullability.git",
            defaultBranch: "main",
            description: "",
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
        return "";
      },
      close() {}
    };

    await promptGithubDiscoverySelection(collisionPlan, {
      input: { isTTY: true },
      output: { isTTY: true },
      createInterfaceFn() {
        return fakeReadline;
      }
    });

    expect(prompts[0]).toContain("Configured already (1): leanish/nullability");
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

function createRawKeypressInput() {
  const input = new EventEmitter();

  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = vi.fn(enabled => {
    input.isRaw = enabled;
  });
  input.resume = vi.fn();
  input.pause = vi.fn();

  return input;
}

function createPendingReadlineFactory() {
  const instances = [];

  return {
    instances,
    createInterfaceFn() {
      const instance = {
        resolveQuestion: null,
        readline: {
          question: vi.fn(() => new Promise(resolve => {
            instance.resolveQuestion = resolve;
          })),
          close: vi.fn()
        }
      };

      instances.push(instance);
      return instance.readline;
    }
  };
}
