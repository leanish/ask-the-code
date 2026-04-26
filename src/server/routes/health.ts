import type { Hono } from "hono";

import type { AppEnv } from "../app.ts";
import type { AskJobManager } from "../../core/types.ts";

export interface HealthDeps {
  jobManager: Partial<Pick<AskJobManager, "getStats">>;
}

export function registerHealthRoutes(app: Hono<AppEnv>, deps: HealthDeps): void {
  app.get("/health", c => {
    const stats = typeof deps.jobManager.getStats === "function" ? deps.jobManager.getStats() : null;
    return c.json({ status: "ok", jobs: stats }, 200, { "Cache-Control": "no-cache" });
  });
}
