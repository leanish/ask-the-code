import { describe, expect, it, vi } from "vitest";

import {
  ensureCodexInstalled,
  formatMissingCodexMessage,
  normalizeCodexExecutionError
} from "../src/codex-installation.js";

describe("codex-installation", () => {
  it("returns quietly when codex is installed", () => {
    expect(() => ensureCodexInstalled({
      spawnSyncFn: vi.fn(() => ({}))
    })).not.toThrow();
  });

  it("throws an install hint when codex is missing", () => {
    expect(() => ensureCodexInstalled({
      spawnSyncFn: vi.fn(() => ({
        error: Object.assign(new Error("spawnSync codex ENOENT"), { code: "ENOENT" })
      }))
    })).toThrow(formatMissingCodexMessage());
  });

  it("normalizes ENOENT runtime errors into the install hint", () => {
    const normalized = normalizeCodexExecutionError(
      Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })
    );

    expect(normalized).toEqual(new Error(formatMissingCodexMessage()));
  });
});
