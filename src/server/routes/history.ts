import type { Hono } from "hono";

import type { AppEnv } from "../app.ts";
import type { HistoryStore } from "../history-store.ts";
import type { AskJobManager } from "../../core/types.ts";

export interface HistoryDeps {
  jobManager: Pick<AskJobManager, "getJob">;
  historyStore: HistoryStore;
}

export function registerHistoryRoutes(app: Hono<AppEnv>, deps: HistoryDeps): void {
  app.get("/history", c => {
    const items = deps.historyStore
      .list()
      .map(id => deps.jobManager.getJob(id))
      .filter((job): job is NonNullable<ReturnType<typeof deps.jobManager.getJob>> => job !== null)
      .map(job => ({
        id: job.id,
        question: job.request.question,
        status: job.status,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt,
        repos: Array.isArray(job.result?.selectedRepos)
          ? job.result.selectedRepos.map(r => r.name)
          : []
      }));
    return c.json({ items, total: items.length });
  });
}
