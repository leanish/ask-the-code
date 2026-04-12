import { describe, expect, it } from "vitest";

import { resolveManagedRepos } from "../src/core/repos/repo-filter.js";
import { createLoadedConfig, createManagedRepo } from "./test-helpers.js";

describe("repo-filter", () => {
  it("returns all configured repos when no explicit names are provided", () => {
    const config = createLoadedConfig({
      repos: [
        createManagedRepo({ name: "archa" }),
        createManagedRepo({ name: "java-conventions" })
      ]
    });

    expect(resolveManagedRepos(config, null).map(repo => repo.name)).toEqual([
      "archa",
      "java-conventions"
    ]);
  });

  it("matches explicit repo names and aliases case-insensitively", () => {
    const config = createLoadedConfig({
      repos: [
        createManagedRepo({
          name: "java-conventions",
          aliases: ["gradle"]
        })
      ]
    });

    expect(resolveManagedRepos(config, ["GRADLE"]).map(repo => repo.name)).toEqual([
      "java-conventions"
    ]);
  });

  it("rejects unknown explicit repo names", () => {
    const config = createLoadedConfig({
      repos: [
        createManagedRepo({ name: "archa" })
      ]
    });

    expect(() => resolveManagedRepos(config, ["missing"])).toThrow(
      "Unknown managed repo(s): missing"
    );
  });
});
