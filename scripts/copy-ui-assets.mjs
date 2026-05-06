#!/usr/bin/env node
import { cp, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const source = resolve(repoRoot, "src/server/ui/assets");
const target = resolve(repoRoot, "dist/server/ui/assets");

try {
  await stat(source);
} catch {
  process.stdout.write(`copy-ui-assets: nothing to copy at ${source}\n`);
  process.exit(0);
}

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
process.stdout.write(`copy-ui-assets: copied to ${target}\n`);
