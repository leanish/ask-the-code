import { spawnSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  ensureCodexInstalled,
  formatMissingCodexMessage,
  formatUnconfiguredCodexMessage,
  normalizeCodexExecutionError
} from "../src/core/codex/codex-installation.ts";
import { createSpawnSyncResult } from "./test-helpers.ts";

describe("codex-installation", () => {
  it("returns quietly when codex is installed and logged in", () => {
    expect(() => ensureCodexInstalled({
      spawnSyncFn: vi
        .fn()
        .mockReturnValueOnce(createSpawnSyncResult())
        .mockReturnValueOnce(createSpawnSyncResult({
          status: 0,
          stdout: "Logged in using ChatGPT\n",
          stderr: ""
        })) as unknown as typeof spawnSync
    })).not.toThrow();
  });

  it("throws an install hint when codex is missing", () => {
    expect(() => ensureCodexInstalled({
      spawnSyncFn: vi.fn(() => createSpawnSyncResult({
        error: Object.assign(new Error("spawnSync codex ENOENT"), { code: "ENOENT" })
      })) as unknown as typeof spawnSync
    })).toThrow(formatMissingCodexMessage());
  });

  it("throws a login hint when codex is installed but not logged in", () => {
    expect(() => ensureCodexInstalled({
      spawnSyncFn: vi
        .fn()
        .mockReturnValueOnce(createSpawnSyncResult())
        .mockReturnValueOnce(createSpawnSyncResult({
          status: 1,
          stdout: "Not logged in\n",
          stderr: ""
        })) as unknown as typeof spawnSync
    })).toThrow(formatUnconfiguredCodexMessage());
  });

  it("normalizes ENOENT runtime errors into the install hint", () => {
    const normalized = normalizeCodexExecutionError(
      Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })
    );

    expect(normalized).toEqual(new Error(formatMissingCodexMessage()));
  });
});
