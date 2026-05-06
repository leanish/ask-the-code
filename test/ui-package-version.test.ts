import { describe, expect, it } from "vitest";

import { resolvePackageVersion } from "../src/server/ui/package-version.ts";

describe("UI package version", () => {
  it("caches resolved package versions by module URL", () => {
    let readCount = 0;
    const version = resolvePackageVersion("file:///repo/src/server/ui/package-version.ts", () => {
      readCount += 1;
      return JSON.stringify({ version: "1.2.3" });
    });

    expect(version).toBe("1.2.3");
    expect(resolvePackageVersion("file:///repo/src/server/ui/package-version.ts", () => {
      readCount += 1;
      return JSON.stringify({ version: "9.9.9" });
    })).toBe("1.2.3");
    expect(readCount).toBe(1);
  });
});
