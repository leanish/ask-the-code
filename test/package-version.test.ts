import { describe, expect, it, vi } from "vitest";

import { resolvePackageVersion } from "../src/server/ui/package-version.ts";

const MODULE_URL = "file:///fake/repo/src/server/ui/package-version.ts";

describe("resolvePackageVersion", () => {
  it("returns the version from package.json", () => {
    const readText = vi.fn(() => JSON.stringify({ version: "1.2.3" }));
    expect(resolvePackageVersion(MODULE_URL, readText)).toBe("1.2.3");
  });

  it("resolves package.json relative to the module URL", () => {
    const readText = vi.fn(() => JSON.stringify({ version: "9.9.9" }));
    resolvePackageVersion(MODULE_URL, readText);

    expect(readText).toHaveBeenCalledWith("/fake/repo/package.json", "utf8");
  });

  it("falls back to 0.0.0 when the file cannot be read", () => {
    const readText = vi.fn(() => {
      throw new Error("ENOENT");
    });
    expect(resolvePackageVersion(MODULE_URL, readText)).toBe("0.0.0");
  });

  it("falls back to 0.0.0 when the file is not valid JSON", () => {
    const readText = vi.fn(() => "{ not json");
    expect(resolvePackageVersion(MODULE_URL, readText)).toBe("0.0.0");
  });

  it("falls back to 0.0.0 when version is missing", () => {
    const readText = vi.fn(() => JSON.stringify({}));
    expect(resolvePackageVersion(MODULE_URL, readText)).toBe("0.0.0");
  });

  it("falls back to 0.0.0 when version is not a non-empty string", () => {
    const readText = vi.fn(() => JSON.stringify({ version: "" }));
    expect(resolvePackageVersion(MODULE_URL, readText)).toBe("0.0.0");

    const readText2 = vi.fn(() => JSON.stringify({ version: 123 }));
    expect(resolvePackageVersion(MODULE_URL, readText2)).toBe("0.0.0");
  });
});
