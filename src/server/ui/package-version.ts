import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ReadTextFn = (filePath: string, encoding: BufferEncoding) => string;

export function resolvePackageVersion(
  moduleUrl: string = import.meta.url,
  readText: ReadTextFn = readFileSync
): string {
  const packageJsonPath = path.resolve(path.dirname(fileURLToPath(moduleUrl)), "../../../package.json");

  try {
    const packageJson = JSON.parse(readText(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version.trim() !== ""
      ? packageJson.version
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
