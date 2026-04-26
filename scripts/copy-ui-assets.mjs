import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const sourceDirectory = path.join(repoRoot, "src/server/ui/assets");
const targetDirectory = path.join(repoRoot, "dist/server/ui/assets");

await fs.rm(targetDirectory, { recursive: true, force: true });
await fs.mkdir(path.dirname(targetDirectory), { recursive: true });
await fs.cp(sourceDirectory, targetDirectory, { recursive: true });
