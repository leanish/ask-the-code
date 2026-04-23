import process from "node:process";

import { initializeConfig, loadConfig } from "../core/config/config.ts";
import { ensureCodexInstalled } from "../core/codex/codex-installation.ts";
import { getConfigPath } from "../core/config/config-paths.ts";
import { ensureGitInstalled } from "../core/git/git-installation.ts";
import { ensureGithubDiscoveryAuthAvailable } from "../core/discovery/github-discovery-auth.ts";
import { ensureInteractiveConfigSetup } from "../cli/setup/bootstrap.ts";
import { runGithubDiscoveryPipeline } from "../core/discovery/discovery-pipeline.ts";
import { createGithubDiscoveryProgressReporter } from "../cli/setup/discovery-progress.ts";
import { promptGithubDiscoverySelection } from "../cli/setup/discovery-selection.ts";
import { startHttpServer, type HttpServerHandle } from "./api/http-server.ts";
import { renderGithubDiscovery } from "../cli/render.ts";
import { HelpError, parseServerArgs } from "./args.ts";
import type { ConfigDiscoverGithubCommandOptions } from "../core/types.ts";

type ServerGithubDiscoveryOptions = Omit<ConfigDiscoverGithubCommandOptions, "command" | "owner"> & {
  owner: string;
};
type ShutdownProcessRef = {
  on(event: string, listener: () => void): unknown;
  exit(code?: number): unknown;
  stderr: Pick<NodeJS.WriteStream, "write">;
};

export async function main(argv: string[]) {
  const options = parseServerArgs(argv, process.env);
  ensureGitInstalled();
  ensureCodexInstalled();
  const shouldContinue = await ensureInteractiveConfigSetup({
    env: process.env,
    loadConfigFn: loadConfig,
    initializeConfigFn: initializeConfig,
    getConfigPathFn: getConfigPath,
    runDiscoveryFn: discoveryOptions => runServerGithubDiscovery(discoveryOptions),
    allowProceedWithoutRepos: false
  });

  if (!shouldContinue) {
    return null;
  }

  const serverHandle = await startHttpServer({
    env: process.env,
    host: options.host,
    port: options.port
  });

  process.stdout.write(`ask-the-code server listening on ${serverHandle.url}\n`);
  if (serverHandle.configuredRepoCount === 0) {
    process.stderr.write(
      'atc-server: no managed repos are configured yet. Suggestion: run "atc config discover-github".\n'
    );
  }

  setupShutdownHandlers(serverHandle);
  return serverHandle;
}

async function runServerGithubDiscovery(
  options: ServerGithubDiscoveryOptions
): Promise<void> {
  ensureGithubDiscoveryAuthAvailable({ env: process.env });
  const config = await loadConfig(process.env);
  const progressReporter = createGithubDiscoveryProgressReporter();
  progressReporter.start(options.owner);

  try {
    const result = await runGithubDiscoveryPipeline({
      config,
      owner: options.owner,
      env: process.env,
      includeForks: options.includeForks,
      includeArchived: options.includeArchived,
      resolveSelectionFn: async plan => await promptGithubDiscoverySelection(plan, {
        input: process.stdin,
        output: process.stdout
      }),
      onProgress: event => progressReporter.onProgress(event)
    });

    process.stdout.write(`${renderGithubDiscovery({
      ...result.plan,
      appliedEntries: result.appliedEntries,
      selectedCount: result.selectedCount,
      configPath: result.configPath,
      addedCount: result.addedCount,
      overriddenCount: result.overriddenCount
    })}\n`);
  } finally {
    progressReporter.finish();
  }
}

export function setupShutdownHandlers(serverHandle: Pick<HttpServerHandle, "close">, {
  processRef = process
}: {
  processRef?: ShutdownProcessRef;
} = {}) {
  let shuttingDown = false;

  function onSignal(signal: string) {
    if (shuttingDown) {
      processRef.stderr.write(`Forced shutdown (${signal})\n`);
      processRef.exit(1);
      return;
    }

    shuttingDown = true;
    processRef.stderr.write(`Shutting down (${signal})...\n`);
    serverHandle.close().then(
      () => processRef.exit(0),
      () => processRef.exit(1)
    );
  }

  processRef.on("SIGTERM", () => onSignal("SIGTERM"));
  processRef.on("SIGINT", () => onSignal("SIGINT"));
}

export { HelpError };
