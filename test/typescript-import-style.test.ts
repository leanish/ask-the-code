import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const relativeJsImportPattern =
  /\bfrom\s+["'](\.{1,2}\/[^"']+\.js)["']|\bimport\s*\(\s*["'](\.{1,2}\/[^"']+\.js)["']\s*\)/g;
const repoRoot = new URL("../", import.meta.url);
const tsDirectories = ["src", "test"];
const tsRootFiles = ["vitest.config.ts"];

describe("typescript import style", () => {
  it("does not use relative .js suffixes in TypeScript files", () => {
    const offenders = collectTrackedTypeScriptFiles()
      .flatMap((filePath) =>
        findRelativeJsImportSpecifiers(filePath).map(
          (specifier) => `${path.relative(fileURLToPath(repoRoot), filePath)}: ${specifier}`
        )
      );

    expect(offenders).toEqual([]);
  });
});

function collectTrackedTypeScriptFiles(): string[] {
  return [
    ...tsDirectories.flatMap((directory) =>
      collectTypeScriptFiles(path.join(fileURLToPath(repoRoot), directory))
    ),
    ...tsRootFiles.map((fileName) => path.join(fileURLToPath(repoRoot), fileName))
  ];
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectTypeScriptFiles(entryPath);
    }

    return entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

function findRelativeJsImportSpecifiers(filePath: string): string[] {
  const contents = readFileSync(filePath, "utf8");

  return Array.from(contents.matchAll(relativeJsImportPattern), (match) => match[1] ?? match[2] ?? "");
}
