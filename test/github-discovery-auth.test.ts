import { spawnSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  ensureGithubDiscoveryAuthAvailable,
  formatMissingGithubDiscoveryAuthMessage
} from "../src/core/discovery/github-discovery-auth.ts";
import { createSpawnSyncResult } from "./test-helpers.ts";

describe("github-discovery-auth", () => {
  it("returns quietly when GH_TOKEN is set", () => {
    expect(() => ensureGithubDiscoveryAuthAvailable({
      env: {
        GH_TOKEN: "token"
      },
      spawnSyncFn: vi.fn() as unknown as typeof spawnSync
    })).not.toThrow();
  });

  it("returns quietly when gh auth token succeeds", () => {
    expect(() => ensureGithubDiscoveryAuthAvailable({
      env: {},
      spawnSyncFn: vi.fn(() => createSpawnSyncResult({
        status: 0,
        stdout: "gh-token\n"
      })) as unknown as typeof spawnSync
    })).not.toThrow();
  });

  it("throws a setup hint when gh is missing and no env token is set", () => {
    expect(() => ensureGithubDiscoveryAuthAvailable({
      env: {},
      spawnSyncFn: vi.fn(() => createSpawnSyncResult({
        error: Object.assign(new Error("spawnSync gh ENOENT"), { code: "ENOENT" })
      })) as unknown as typeof spawnSync
    })).toThrow(formatMissingGithubDiscoveryAuthMessage());
  });

  it("throws a setup hint when gh is installed but not authenticated", () => {
    expect(() => ensureGithubDiscoveryAuthAvailable({
      env: {},
      spawnSyncFn: vi.fn(() => createSpawnSyncResult({
        status: 1,
        stdout: ""
      })) as unknown as typeof spawnSync
    })).toThrow(formatMissingGithubDiscoveryAuthMessage());
  });
});
