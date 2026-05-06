import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ReadTextFn = (filePath: string, encoding: BufferEncoding) => string;

const versionCache = new Map<string, string>();

export function resolvePackageVersion(
  moduleUrl: string = import.meta.url,
  readText: ReadTextFn = readFileSync
): string {
  const cachedVersion = versionCache.get(moduleUrl);
  if (cachedVersion) {
    return cachedVersion;
  }

  const packageJsonPath = path.resolve(path.dirname(fileURLToPath(moduleUrl)), "../../../package.json");

  try {
    const packageJson = JSON.parse(readText(packageJsonPath, "utf8")) as { version?: unknown };
    const version = typeof packageJson.version === "string" && packageJson.version.trim() !== ""
      ? packageJson.version
      : "0.0.0";
    versionCache.set(moduleUrl, version);
    return version;
  } catch {
    const version = "0.0.0";
    versionCache.set(moduleUrl, version);
    return version;
  }
}
