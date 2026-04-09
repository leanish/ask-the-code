import os from "node:os";
import path from "node:path";

import type { Environment } from "../types.js";

export function getConfigPath(env: Environment = process.env): string {
  if (env.ARCHA_CONFIG_PATH) {
    return env.ARCHA_CONFIG_PATH;
  }

  const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "archa", "config.json");
}

export function getDefaultManagedReposRoot(env: Environment = process.env): string {
  const dataHome = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "archa", "repos");
}
