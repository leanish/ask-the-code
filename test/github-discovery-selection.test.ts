import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { promptGithubDiscoverySelection, selectGithubDiscoveryRepos } from "../src/cli/setup/discovery-selection.js";
import type { CreateInterfaceFn, PromptInput, ReadlineLike } from "../src/cli/setup/interactive-prompts.js";
import type { GithubDiscoveryPlan, GithubDiscoveryPlanEntry, ManagedRepoDefinition, RepoRecord } from "../src/core/types.js";
import {
  createGithubDiscoveryPlan,
  createGithubDiscoveryPlanEntry,
  createManagedRepo,
  createRepoRecord
} from "./test-helpers.js";

describe("github-discovery-selection", () => {
  const plan = createPlan([
    createEntry({
      status: "new",
      repo: createRepoRecord({
        name: "archa",
        url: "https://github.com/leanish/archa.git",
        defaultBranch: "main",
        description: "Repo-aware CLI",
        topics: ["cli"]
      })
    }),
    createEntry({
      status: "new",
      repo: createRepoRecord({
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions",
        topics: ["gradle"]
      })
    }),
    createEntry({
      status: "configured",
      repo: createRepoRecord({
        name: "foundation",
        url: "https://github.com/leanish/foundation.git",
        defaultBranch: "main",
        description: "Shared base",
        topics: ["java"]
      }),
      suggestions: ["review description"]
    }),
    createEntry({
      status: "conflict",
      repo: createRepoRecord({
        name: "shared",
        url: "https://github.com/leanish/shared.git",
        defaultBranch: "main",
        description: "",
        topics: []
      }),
      configuredRepo: createManagedRepo({
        name: "foundation",
        url: "https://github.com/leanish/foundation.git"
      }),
      suggestions: []
    })
  ]);

  it("selects explicit additions and overrides case-insensitively", () => {
    expect(selectGithubDiscoveryRepos(plan, {
      addRepoNames: ["Archa"],
      overrideRepoNames: ["FOUNDATION"]
    })).toEqual({
      reposToAdd: [plan.entries[0]!.repo],
      reposToOverride: [plan.entries[2]!.repo]
    });
  });

  it("supports selecting all addable or overridable repos", () => {
    expect(selectGithubDiscoveryRepos(plan, {
      addRepoNames: ["*"],
      overrideRepoNames: ["*"]
    })).toEqual({
      reposToAdd: [plan.entries[0]!.repo, plan.entries[1]!.repo],
      reposToOverride: [plan.entries[2]!.repo]
    });
  });

  it("rejects explicit selections that are not available for that action", () => {
    expect(() => selectGithubDiscoveryRepos(plan, {
      addRepoNames: ["foundation"]
    })).toThrow('Unknown new repo(s) for --add: foundation.');
  });

  it("allows selecting colliding repo names via owner-qualified identifiers", () => {
    const multiOwnerPlan = createPlan([
      createEntry({
        status: "new",
        repo: createRepoRecord({
          name: "shared",
          sourceOwner: "leanish",
          sourceFullName: "leanish/shared",
          url: "https://github.com/leanish/shared.git",
          defaultBranch: "main",
          description: "",
          topics: []
        })
      }),
      createEntry({
        status: "new",
        repo: createRepoRecord({
          name: "shared",
          sourceOwner: "OtherCo",
          sourceFullName: "OtherCo/shared",
          url: "https://github.com/OtherCo/shared.git",
          defaultBranch: "main",
          description: "",
          topics: []
        })
      })
    ]);

    expect(selectGithubDiscoveryRepos(multiOwnerPlan, {
      addRepoNames: ["leanish/shared", "OtherCo/shared"]
    })).toEqual({
      reposToAdd: [multiOwnerPlan.entries[0]!.repo, multiOwnerPlan.entries[1]!.repo],
      reposToOverride: []
    });
  });

  it("accepts owner-qualified selections case-insensitively for single-owner discovery", () => {
    const singleOwnerPlan = createPlan([
      createEntry({
        status: "new",
        repo: createRepoRecord({
          name: "nullability",
          url: "https://github.com/leanish/nullability.git",
          defaultBranch: "main",
          description: "",
          topics: []
        })
      })
    ], {
      owner: "leanish"
    });

    expect(selectGithubDiscoveryRepos(singleOwnerPlan, {
      addRepoNames: ["Leanish/Nullability"]
    })).toEqual({
      reposToAdd: [singleOwnerPlan.entries[0]!.repo],
      reposToOverride: []
    });
  });

  it("prompts once for comma-separated add and override selections", async () => {
    const outputWrites: string[] = [];
    const fakeReadline = {
      question: async (prompt: string) => {
        outputWrites.push(prompt);
        return "archa, java-conventions, foundation";
      },
      write() {},
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
      reposToAdd: [plan.entries[0]!.repo, plan.entries[1]!.repo],
      reposToOverride: [plan.entries[2]!.repo]
    });
    expect(outputWrites.join("")).toContain("Select repos to add or override");
    expect(outputWrites.join("")).toContain("Press Enter to add all new repos, press Esc to cancel");
    expect(outputWrites.join("")).toContain("New (2): archa, java-conventions");
    expect(outputWrites.join("")).toContain("Configured already (1): foundation");
    expect(outputWrites.join("")).toContain("Name conflicts (1): shared -> leanish/foundation");
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
    expect(readlineFactory.instances[0]!.readline.question).toHaveBeenCalledWith(
      'Select repos to add or override (comma-separated, "*" for all)\n'
        + "Press Enter to add all new repos, press Esc to cancel, or type repo names to customize.\n"
        + "New (2): archa, java-conventions\n"
        + "Configured already (1): foundation\n"
        + "Name conflicts (1): shared -> leanish/foundation\n"
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
    const prompts: string[] = [];
    const fakeReadline = {
      question: async (prompt: string) => {
        prompts.push(prompt);
        return "";
      },
      write() {},
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
      reposToAdd: [plan.entries[0]!.repo, plan.entries[1]!.repo],
      reposToOverride: []
    });
    expect(prompts).toEqual([
      'Select repos to add or override (comma-separated, "*" for all)\n'
        + "Press Enter to add all new repos, press Esc to cancel, or type repo names to customize.\n"
        + "New (2): archa, java-conventions\n"
        + "Configured already (1): foundation\n"
        + "Name conflicts (1): shared -> leanish/foundation\n"
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
    readlineFactory.instances[0]!.resolveQuestion?.("");

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
    expect(readlineFactory.instances[0]!.readline.question).toHaveBeenCalledWith(
      'Select repos to add or override (comma-separated, "*" for all)\n'
        + "Press Enter to add all new repos, press Esc to cancel, or type repo names to customize.\n"
        + "New (2): archa, java-conventions\n"
        + "Configured already (1): foundation\n"
        + "Name conflicts (1): shared -> leanish/foundation\n"
        + "> "
    );
    expect(readlineFactory.instances[1]!.readline.question).toHaveBeenCalledWith(
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
    const collisionPlan = createPlan([
      createEntry({
        status: "configured",
        repo: createRepoRecord({
          name: "nullability",
          sourceOwner: "leanish",
          sourceFullName: "leanish/nullability",
          url: "https://github.com/leanish/nullability.git",
          defaultBranch: "main",
          description: "",
          topics: []
        })
      }),
      createEntry({
        status: "new",
        repo: createRepoRecord({
          name: "otherco/nullability",
          sourceOwner: "OtherCo",
          sourceFullName: "OtherCo/nullability",
          url: "https://github.com/OtherCo/nullability.git",
          defaultBranch: "main",
          description: "",
          topics: []
        })
      })
    ], {
      ownerDisplay: "leanish + orgs"
    });
    const prompts: string[] = [];
    const fakeReadline = {
      question: async (prompt: string) => {
        prompts.push(prompt);
        return "";
      },
      write() {},
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
      reposToAdd: [collisionPlan.entries[1]!.repo],
      reposToOverride: []
    });
    expect(prompts[0]).toContain("New (1): OtherCo/nullability");
    expect(prompts[0]).toContain("Configured already (1): leanish/nullability");
    expect(prompts[1]).toBe(
      "Add all 1 new repo(s)? Press Enter to confirm, or type repo names to customize.\n> "
    );
  });

  it("derives owner-qualified configured labels from the GitHub URL when source metadata is missing", async () => {
    const collisionPlan = createPlan([
      createEntry({
        status: "configured",
        repo: createRepoRecord({
          name: "nullability",
          url: "https://github.com/leanish/nullability.git",
          defaultBranch: "main",
          description: "",
          topics: []
        })
      }),
      createEntry({
        status: "new",
        repo: createRepoRecord({
          name: "otherco/nullability",
          sourceOwner: "OtherCo",
          sourceFullName: "OtherCo/nullability",
          url: "https://github.com/OtherCo/nullability.git",
          defaultBranch: "main",
          description: "",
          topics: []
        })
      })
    ], {
      ownerDisplay: "leanish + orgs"
    });
    const prompts: string[] = [];
    const fakeReadline = {
      question: async (prompt: string) => {
        prompts.push(prompt);
        return "";
      },
      write() {},
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
    const multiOwnerPlan = createPlan([
      createEntry({
        status: "new",
        repo: createRepoRecord({
          name: "archa",
          sourceOwner: "leanish",
          sourceFullName: "leanish/archa",
          url: "https://github.com/leanish/archa.git",
          defaultBranch: "main",
          description: "Repo-aware CLI",
          topics: ["cli"]
        })
      }),
      createEntry({
        status: "new",
        repo: createRepoRecord({
          name: "dtv",
          sourceOwner: "OtherCo",
          sourceFullName: "OtherCo/dtv",
          url: "https://github.com/OtherCo/dtv.git",
          defaultBranch: "master",
          description: "Storefront backend",
          topics: ["play"]
        })
      })
    ], {
      ownerDisplay: "leanish + orgs"
    });
    const prompts: string[] = [];
    const fakeReadline = {
      question: async (prompt: string) => {
        prompts.push(prompt);
        return "OtherCo/dtv";
      },
      write() {},
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
      reposToAdd: [multiOwnerPlan.entries[1]!.repo],
      reposToOverride: []
    });
    expect(prompts[0]).toContain("New (2):\nleanish: archa\nOtherCo: dtv");
  });

  it("keeps owner-qualified labels only when repo names collide across owners", async () => {
    const collisionPlan = createPlan([
      createEntry({
        status: "new",
        repo: createRepoRecord({
          name: "shared",
          sourceOwner: "leanish",
          sourceFullName: "leanish/shared",
          url: "https://github.com/leanish/shared.git",
          defaultBranch: "main",
          description: "Personal shared repo",
          topics: []
        })
      }),
      createEntry({
        status: "new",
        repo: createRepoRecord({
          name: "shared",
          sourceOwner: "OtherCo",
          sourceFullName: "OtherCo/shared",
          url: "https://github.com/OtherCo/shared.git",
          defaultBranch: "main",
          description: "Company shared repo",
          topics: []
        })
      })
    ], {
      ownerDisplay: "leanish + orgs"
    });
    const prompts: string[] = [];
    const fakeReadline = {
      question: async (prompt: string) => {
        prompts.push(prompt);
        return "OtherCo/shared";
      },
      write() {},
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
      reposToAdd: [collisionPlan.entries[1]!.repo],
      reposToOverride: []
    });
    expect(prompts[0]).toContain("leanish: leanish/shared");
    expect(prompts[0]).toContain("OtherCo: OtherCo/shared");
  });

  it("rejects interactive selection without a tty", async () => {
    await expect(promptGithubDiscoverySelection(plan, {
      input: { isTTY: false },
      output: { isTTY: true, write() { return true; } }
    })).rejects.toThrow("Interactive GitHub discovery requires a TTY.");
  });
});

type RawKeypressInput = EventEmitter & Required<Pick<PromptInput, "setRawMode" | "resume" | "pause">> & {
  isTTY: true;
  isRaw: boolean;
};

type PendingReadlineInstance = {
  resolveQuestion: ((answer: string) => void) | null;
  readline: ReadlineLike & {
    question: ReturnType<typeof vi.fn<(prompt: string) => Promise<string>>>;
    close: ReturnType<typeof vi.fn<() => void>>;
  };
};

function createRawKeypressInput(): RawKeypressInput {
  const input = new EventEmitter() as RawKeypressInput;

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
  const instances: PendingReadlineInstance[] = [];

  return {
    instances,
    createInterfaceFn: (() => {
      const instance: PendingReadlineInstance = {
        resolveQuestion: null,
        readline: {
          question: vi.fn((_: string) => new Promise<string>(resolve => {
            instance.resolveQuestion = resolve;
          })),
          write() {},
          close: vi.fn()
        }
      };

      instances.push(instance);
      return instance.readline;
    }) satisfies CreateInterfaceFn
  };
}

function createEntry(overrides: Partial<GithubDiscoveryPlanEntry> & {
  repo: RepoRecord;
  status: GithubDiscoveryPlanEntry["status"];
}): GithubDiscoveryPlanEntry {
  return createGithubDiscoveryPlanEntry({
    configuredRepo: null,
    suggestions: [],
    ...overrides
  });
}

function createPlan(
  entries: GithubDiscoveryPlanEntry[],
  overrides: Partial<Pick<GithubDiscoveryPlan, "owner" | "ownerDisplay">> = {}
): Pick<GithubDiscoveryPlan, "entries"> & Partial<Pick<GithubDiscoveryPlan, "owner" | "ownerDisplay">> {
  return createGithubDiscoveryPlan({
    entries,
    ...overrides
  });
}
