import { spawnSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  ensureGitInstalled,
  formatMissingGitMessage,
  normalizeGitExecutionError
} from "../src/core/git/git-installation.ts";
import { createSpawnSyncResult } from "./test-helpers.ts";

describe("git-installation", () => {
  it("returns quietly when git is installed", () => {
    expect(() => ensureGitInstalled({
      spawnSyncFn: vi.fn(() => createSpawnSyncResult()) as unknown as typeof spawnSync
    })).not.toThrow();
  });

  it("throws an install hint when git is missing", () => {
    expect(() => ensureGitInstalled({
      spawnSyncFn: vi.fn(() => createSpawnSyncResult({
        error: Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" })
      })) as unknown as typeof spawnSync
    })).toThrow(formatMissingGitMessage());
  });

  it("normalizes ENOENT runtime errors into the install hint", () => {
    const normalized = normalizeGitExecutionError(
      Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" })
    );

    expect(normalized).toEqual(new Error(formatMissingGitMessage()));
  });
});
