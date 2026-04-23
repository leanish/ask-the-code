import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("husky setup", () => {
  it("installs husky automatically after npm install", async () => {
    const packageJsonText = await readFile(new URL("../package.json", import.meta.url), "utf8");
    const packageJson = JSON.parse(packageJsonText) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.scripts).toMatchObject({
      check: "npm run typecheck && npm test && npm run build",
      prepare: "husky"
    });
    expect(packageJson.devDependencies).toHaveProperty("husky");
  });

  it("runs the full repo check from the pre-commit hook", async () => {
    const hookText = await readFile(new URL("../.husky/pre-commit", import.meta.url), "utf8");

    expect(hookText).toContain("npm run check");
  });
});
