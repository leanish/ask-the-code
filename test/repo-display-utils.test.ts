import { describe, expect, it } from "vitest";

import { getDiscoveryRepoBaseName } from "../src/core/discovery/repo-display-utils.js";

describe("repo-display-utils", () => {
  it("returns an empty string when a repo name is missing", () => {
    expect(getDiscoveryRepoBaseName({})).toBe("");
    expect(getDiscoveryRepoBaseName(null)).toBe("");
  });
});
