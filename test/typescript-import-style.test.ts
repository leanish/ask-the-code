import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const relativeModuleSpecifierPattern =
  /\bfrom\s+["'](\.{1,2}\/[^"']+)["']|\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|\bvi\.mock\s*\(\s*["'](\.{1,2}\/[^"']+)["']/g;
const repoRoot = new URL("../", import.meta.url);
const repoRootPath = fileURLToPath(repoRoot);
const tsDirectories = ["src", "test"];
const tsRootFiles = ["vitest.config.ts"];

describe("typescript import style", () => {
  it("uses .ts suffixes on relative module specifiers in TypeScript files", () => {
    const offenders = collectTypeScriptSourceFiles()
      .flatMap((filePath) =>
        findNonTsRelativeModuleSpecifiers(filePath).map(
          (specifier) => `${path.relative(repoRootPath, filePath)}: ${specifier}`
        )
      );

    expect(offenders).toEqual([]);
  });
});

function collectTypeScriptSourceFiles(): string[] {
  return [
    ...tsDirectories.flatMap((directory) =>
      collectTypeScriptFiles(path.join(repoRootPath, directory))
    ),
    ...tsRootFiles.map((fileName) => path.join(repoRootPath, fileName))
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

function findNonTsRelativeModuleSpecifiers(filePath: string): string[] {
  const contents = readFileSync(filePath, "utf8");

  return Array.from(contents.matchAll(relativeModuleSpecifierPattern), (match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((specifier) => !specifier.endsWith(".ts"));
}
