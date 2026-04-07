import { describe, expect, it, vi } from "vitest";

import {
  ensureCodexInstalled,
  formatMissingCodexMessage,
  formatUnconfiguredCodexMessage,
  normalizeCodexExecutionError
} from "../src/core/codex/codex-installation.js";

describe("codex-installation", () => {
  it("returns quietly when codex is installed and logged in", () => {
    expect(() => ensureCodexInstalled({
      spawnSyncFn: vi
        .fn()
        .mockReturnValueOnce({})
        .mockReturnValueOnce({
          status: 0,
          stdout: "Logged in using ChatGPT\n",
          stderr: ""
        })
    })).not.toThrow();
  });

  it("throws an install hint when codex is missing", () => {
    expect(() => ensureCodexInstalled({
      spawnSyncFn: vi.fn(() => ({
        error: Object.assign(new Error("spawnSync codex ENOENT"), { code: "ENOENT" })
      }))
    })).toThrow(formatMissingCodexMessage());
  });

  it("throws a login hint when codex is installed but not logged in", () => {
    expect(() => ensureCodexInstalled({
      spawnSyncFn: vi
        .fn()
        .mockReturnValueOnce({})
        .mockReturnValueOnce({
          status: 1,
          stdout: "Not logged in\n",
          stderr: ""
        })
    })).toThrow(formatUnconfiguredCodexMessage());
  });

  it("normalizes ENOENT runtime errors into the install hint", () => {
    const normalized = normalizeCodexExecutionError(
      Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })
    );

    expect(normalized).toEqual(new Error(formatMissingCodexMessage()));
  });
});
