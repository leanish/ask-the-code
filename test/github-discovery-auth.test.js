import { describe, expect, it, vi } from "vitest";

import {
  ensureGithubDiscoveryAuthAvailable,
  formatMissingGithubDiscoveryAuthMessage
} from "../src/github-discovery-auth.js";

describe("github-discovery-auth", () => {
  it("returns quietly when GH_TOKEN is set", () => {
    expect(() => ensureGithubDiscoveryAuthAvailable({
      env: {
        GH_TOKEN: "token"
      },
      spawnSyncFn: vi.fn()
    })).not.toThrow();
  });

  it("returns quietly when gh auth token succeeds", () => {
    expect(() => ensureGithubDiscoveryAuthAvailable({
      env: {},
      spawnSyncFn: vi.fn(() => ({
        status: 0,
        stdout: "gh-token\n"
      }))
    })).not.toThrow();
  });

  it("throws a setup hint when gh is missing and no env token is set", () => {
    expect(() => ensureGithubDiscoveryAuthAvailable({
      env: {},
      spawnSyncFn: vi.fn(() => ({
        error: Object.assign(new Error("spawnSync gh ENOENT"), { code: "ENOENT" })
      }))
    })).toThrow(formatMissingGithubDiscoveryAuthMessage());
  });

  it("throws a setup hint when gh is installed but not authenticated", () => {
    expect(() => ensureGithubDiscoveryAuthAvailable({
      env: {},
      spawnSyncFn: vi.fn(() => ({
        status: 1,
        stdout: ""
      }))
    })).toThrow(formatMissingGithubDiscoveryAuthMessage());
  });
});
