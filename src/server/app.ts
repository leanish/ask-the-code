import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { loadConfig } from "../core/config/config.ts";
import { createApiAskRoutes } from "./routes/api-ask.ts";
import { registerAskRoutes } from "./routes/ask.ts";
import { DEFAULT_BODY_LIMIT_BYTES, toHttpError, type ApiRouteDeps } from "./routes/api-helpers.ts";
import { registerAuthRoutes, validateAuthConfig, type AuthFetchFn } from "./routes/auth.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerRepoRoutes } from "./routes/repos.ts";
import { registerUiRoutes } from "./routes/ui.tsx";

type ServerAppBindings = {
  Bindings: HttpBindings;
};
type CreateAppOptions = ApiRouteDeps & {
  assetRoot?: string;
  authFetchFn?: AuthFetchFn;
};

export function createApp(
  {
    bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
    env = process.env,
    loadConfigFn = loadConfig,
    jobManager,
    assetRoot = resolveUiAssetRoot(),
    authFetchFn
  }: CreateAppOptions
): Hono<ServerAppBindings> {
  validateAuthConfig(env);
  const app = new Hono<ServerAppBindings>();

  app.use("/api/*", cors({
    allowHeaders: [
      "Content-Type",
      "Accept",
      "Authorization",
      "X-ATC-Interaction-User",
      "X-ATC-Conversation-Key",
      "X-ATC-Interaction-Timestamp",
      "X-ATC-Interaction-Signature"
    ],
    allowMethods: ["GET", "POST", "OPTIONS"],
    origin: "*"
  }));
  app.get("/ui/assets/*", serveStatic<ServerAppBindings>({
    root: assetRoot,
    rewriteRequestPath: pathName => pathName.replace(/^\/ui\/assets\/?/u, "")
  }));
  registerUiRoutes(app);
  app.route("/api/v1", createApiAskRoutes({ bodyLimitBytes, env, jobManager }));
  registerAskRoutes(app, { bodyLimitBytes, env, jobManager });
  registerAuthRoutes(app, {
    env,
    ...(authFetchFn === undefined ? {} : { fetchFn: authFetchFn })
  });
  registerRepoRoutes(app, { env, loadConfigFn });
  registerHealthRoutes(app, { jobManager });

  app.onError((error, c) => {
    const httpError = toHttpError(error);
    return c.json({ error: httpError.message }, asStatusCode(httpError.statusCode));
  });

  app.notFound(c => c.json({
    error: `No route for ${c.req.method} ${new URL(c.req.url).pathname}`
  }, 404));

  return app;
}

export function resolveUiAssetRoot(
  moduleUrl: string = import.meta.url,
  pathExists: (filePath: string) => boolean = existsSync
): string {
  const modulePath = fileURLToPath(moduleUrl);
  const candidates: [string, string] = [
    path.resolve(path.dirname(modulePath), "ui/assets"),
    path.resolve(path.dirname(modulePath), "../ui/assets")
  ];
  return candidates.find(candidate => pathExists(candidate)) ?? candidates[0];
}

type ContentfulStatusCode = Parameters<import("hono").Context["json"]>[1];

function asStatusCode(value: number): ContentfulStatusCode {
  return value as ContentfulStatusCode;
}
