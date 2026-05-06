import type { Hono } from "hono";

import { loadConfig } from "../../core/config/config.ts";
import type {
  AppEnv
} from "../app.ts";
import type {
  Environment,
  LoadedConfig,
  ManagedRepoDefinition
} from "../../core/types.ts";

type RepoConfig = Pick<LoadedConfig, "repos">;
export type LoadRepoListFn = (env: Environment) => Promise<RepoConfig>;

export interface ReposDeps {
  env?: Environment;
  loadConfigFn?: LoadRepoListFn;
}

export function registerReposRoutes(app: Hono<AppEnv>, deps: ReposDeps = {}): void {
  const env = deps.env ?? process.env;
  const loadConfigFn = deps.loadConfigFn ?? loadConfig;

  app.get("/repos", async c => {
    const config = await loadConfigFn(env);
    return c.json({
      repos: config.repos.map(serializeRepoSummary),
      setupHint: config.repos.length === 0 ? getEmptyConfigSetupHint() : null
    });
  });
}

function serializeRepoSummary(
  repo: Pick<ManagedRepoDefinition, "name" | "defaultBranch" | "description" | "aliases">
): Pick<ManagedRepoDefinition, "name" | "defaultBranch" | "description" | "aliases"> {
  return {
    name: repo.name,
    defaultBranch: repo.defaultBranch,
    description: repo.description,
    aliases: repo.aliases
  };
}

function getEmptyConfigSetupHint(): string {
  return 'No configured repos available. Try "atc config discover-github" to discover and add repos.';
}
