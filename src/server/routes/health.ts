import type { Env, Hono } from "hono";

import type { ApiRouteDeps } from "./api-helpers.ts";

export function registerHealthRoutes<E extends Env>(app: Hono<E>, deps: Pick<ApiRouteDeps, "jobManager">): void {
  app.get("/health", c => c.json({
    status: "ok",
    jobs: typeof deps.jobManager.getStats === "function" ? deps.jobManager.getStats() : null
  }));
}
