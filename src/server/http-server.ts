import http from "node:http";

import { serve } from "@hono/node-server";

import { createApp } from "./app.ts";
import { loadConfig } from "../core/config/config.ts";
import { parseEnvPort, parseEnvPositiveInteger } from "../core/env/parse-env.ts";
import { createAskJobManager } from "../core/jobs/ask-job-manager.ts";
import type {
  AnswerQuestionFn,
  AskJobManager,
  Environment,
  LoadedConfig
} from "../core/types.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_BODY_LIMIT_BYTES = 65_536;

type LoadedServerConfig = Pick<LoadedConfig, "repos" | "configPath">;
type LoadServerConfigFn = (env: Environment) => Promise<LoadedServerConfig>;
type StartHttpServerOptions = {
  env?: Environment;
  host?: string | null;
  port?: number | null;
  bodyLimitBytes?: number | null;
  jobManager?: AskJobManager | null;
  answerQuestionFn?: AnswerQuestionFn | null;
  loadConfigFn?: LoadServerConfigFn;
  maxConcurrentJobs?: number | null;
  jobRetentionMs?: number | null;
};

export interface HttpServerHandle {
  jobManager: AskJobManager;
  server: http.Server;
  url: string | null;
  configuredRepoCount: number;
  configPath: string | null;
  close(): Promise<void>;
}

export async function startHttpServer({
  env = process.env,
  host = null,
  port = null,
  bodyLimitBytes = null,
  jobManager = null,
  answerQuestionFn = null,
  loadConfigFn = loadConfig,
  maxConcurrentJobs = null,
  jobRetentionMs = null
}: StartHttpServerOptions = {}): Promise<HttpServerHandle> {
  const resolvedHost = host || env.ATC_SERVER_HOST || DEFAULT_HOST;
  const resolvedPort =
    port ?? getOptionalPort(env.ATC_SERVER_PORT, "ATC_SERVER_PORT") ?? DEFAULT_PORT;
  const resolvedBodyLimitBytes =
    bodyLimitBytes ??
    getOptionalPositiveInteger(env.ATC_SERVER_BODY_LIMIT_BYTES, "ATC_SERVER_BODY_LIMIT_BYTES") ??
    DEFAULT_BODY_LIMIT_BYTES;
  const resolvedMaxConcurrentJobs =
    maxConcurrentJobs ??
    getOptionalPositiveInteger(env.ATC_SERVER_MAX_CONCURRENT_JOBS, "ATC_SERVER_MAX_CONCURRENT_JOBS") ??
    undefined;
  const resolvedJobRetentionMs =
    jobRetentionMs ??
    getOptionalPositiveInteger(env.ATC_SERVER_JOB_RETENTION_MS, "ATC_SERVER_JOB_RETENTION_MS") ??
    undefined;
  const loadedConfig = await loadConfigFn(env);
  const resolvedJobManager =
    jobManager ??
    createAskJobManager({
      env,
      answerQuestionFn: answerQuestionFn ?? undefined,
      maxConcurrentJobs: resolvedMaxConcurrentJobs,
      jobRetentionMs: resolvedJobRetentionMs
    });

  const app = createApp({
    jobManager: resolvedJobManager,
    bodyLimitBytes: resolvedBodyLimitBytes,
    env,
    loadConfigFn
  });

  let listening = false;
  const server = serve(
    {
      fetch: app.fetch,
      hostname: resolvedHost,
      port: resolvedPort,
      createServer: http.createServer
    },
    () => {
      listening = true;
    }
  ) as http.Server;

  if (!listening) {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const onListening = (): void => {
        server.off("error", onError);
        resolvePromise();
      };
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        rejectPromise(error);
      };
      server.once("listening", onListening);
      server.once("error", onError);
    });
  }

  return {
    jobManager: resolvedJobManager,
    server,
    url: formatServerUrl(server),
    configuredRepoCount: loadedConfig.repos.length,
    configPath: loadedConfig.configPath ?? null,
    async close(): Promise<void> {
      const shutdownPromise =
        typeof resolvedJobManager.shutdown === "function" ? resolvedJobManager.shutdown() : Promise.resolve();

      await Promise.all([
        shutdownPromise,
        new Promise<void>(resolve => {
          server.close(() => {
            resolve();
          });
          server.closeIdleConnections?.();
        })
      ]);

      resolvedJobManager.close();
    }
  };
}

function formatServerUrl(server: http.Server): string | null {
  const address = server.address();
  if (!address || typeof address === "string") {
    return null;
  }
  const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return `http://${host}:${address.port}`;
}

function getOptionalPort(value: string | undefined, label: string): number | null {
  return parseEnvPort(value, label);
}

function getOptionalPositiveInteger(value: string | undefined, label: string): number | null {
  return parseEnvPositiveInteger(value, { label });
}
