import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { loadConfig } from "../core/config/config.ts";
import { createHistoryStore, type HistoryStore } from "./history-store.ts";
import { registerAskRoutes } from "./routes/ask.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerHistoryRoutes } from "./routes/history.ts";
import type { LoadRepoListFn } from "./routes/repos.ts";
import { registerReposRoutes } from "./routes/repos.ts";
import { HttpError } from "./routes/api-helpers.ts";
import { registerUiRoutes } from "./routes/ui.tsx";
import type { AskJobManager, Environment } from "../core/types.ts";

export type AppEnv = { Bindings: HttpBindings };

export interface CreateAppOptions {
  jobManager: Pick<AskJobManager, "createJob" | "getJob" | "subscribe"> &
    Partial<Pick<AskJobManager, "getStats">>;
  bodyLimitBytes?: number;
  env?: Environment;
  loadConfigFn?: LoadRepoListFn;
  assetRoot?: string;
  historyStore?: HistoryStore;
}

export function resolveAssetRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "ui/assets"), resolve(here, "../ui/assets")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Cannot locate ui/assets relative to ${here}`);
}

export function createApp(options: CreateAppOptions): Hono<AppEnv> {
  const assetRoot = options.assetRoot ?? resolveAssetRoot();

  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Accept"]
    })
  );

  app.use(
    "/ui/assets/*",
    serveStatic({
      root: assetRoot,
      rewriteRequestPath: path => path.replace(/^\/ui\/assets\//, "/")
    })
  );

  const historyStore = options.historyStore ?? createHistoryStore();

  registerUiRoutes(app);
  registerAuthRoutes(app, options.env === undefined ? {} : { env: options.env });
  registerHealthRoutes(app, { jobManager: options.jobManager });
  registerHistoryRoutes(app, { jobManager: options.jobManager, historyStore });
  registerReposRoutes(app, {
    ...(options.env === undefined ? {} : { env: options.env }),
    loadConfigFn: options.loadConfigFn ?? loadConfig
  });
  registerAskRoutes(app, {
    jobManager: options.jobManager,
    historyStore,
    ...(options.bodyLimitBytes === undefined ? {} : { bodyLimitBytes: options.bodyLimitBytes })
  });

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: error.message }, asStatusCode(error.statusCode));
    }
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  });

  app.notFound(c => {
    const message = `No route for ${c.req.method} ${new URL(c.req.url).pathname}`;
    return c.json({ error: message }, 404);
  });

  return app;
}

type ContentfulStatusCode = Parameters<import("hono").Context["json"]>[1];

function asStatusCode(value: number): ContentfulStatusCode {
  return value as ContentfulStatusCode;
}
