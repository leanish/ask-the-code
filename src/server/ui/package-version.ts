import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ReadTextFn = (filePath: string, encoding: BufferEncoding) => string;

/**
 * Read the host package's `version` field. Both arguments are injectable so
 * tests can drive the function with a fake `readText` and a fake module URL.
 *
 * Returns "0.0.0" if the file is missing, malformed, or the `version` field
 * isn't a non-empty string. The function never throws.
 */
export function resolvePackageVersion(
  moduleUrl: string = import.meta.url,
  readText: ReadTextFn = readFileSync
): string {
  const here = path.dirname(fileURLToPath(moduleUrl));
  const packageJsonPath = path.resolve(here, "../../../package.json");

  try {
    const parsed = JSON.parse(readText(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() !== ""
      ? parsed.version
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
