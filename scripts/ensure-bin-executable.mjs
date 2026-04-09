import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const executableBits = 0o111;
const binFiles = [
  path.join(repoRoot, "dist/bin/archa.js"),
  path.join(repoRoot, "dist/bin/archa-server.js")
];

for (const filePath of binFiles) {
  const currentMode = (await fs.stat(filePath)).mode;
  await fs.chmod(filePath, currentMode | executableBits);
}
