import type { Env, Hono } from "hono";

import {
  getEmptyConfigSetupHint,
  serializeRepoSummary,
  type ApiRouteDeps
} from "./api-helpers.ts";

export function registerRepoRoutes<E extends Env>(app: Hono<E>, deps: Pick<ApiRouteDeps, "env" | "loadConfigFn">): void {
  app.get("/repos", async c => {
    const config = await deps.loadConfigFn(deps.env);
    return c.json({
      repos: config.repos.map(serializeRepoSummary),
      setupHint: config.repos.length === 0 ? getEmptyConfigSetupHint() : null
    });
  });
}
