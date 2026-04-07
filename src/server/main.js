import process from "node:process";

import { initializeConfig, loadConfig } from "../core/config/config.js";
import { ensureCodexInstalled } from "../core/codex/codex-installation.js";
import { getConfigPath } from "../core/config/config-paths.js";
import { ensureGitInstalled } from "../core/git/git-installation.js";
import { ensureGithubDiscoveryAuthAvailable } from "../core/discovery/github-discovery-auth.js";
import { ensureInteractiveConfigSetup } from "../cli/setup/bootstrap.js";
import { runGithubDiscoveryPipeline } from "../core/discovery/discovery-pipeline.js";
import { createGithubDiscoveryProgressReporter } from "../cli/setup/discovery-progress.js";
import { promptGithubDiscoverySelection } from "../cli/setup/discovery-selection.js";
import { startHttpServer } from "./api/http-server.js";
import { renderGithubDiscovery } from "../cli/render.js";
import { HelpError, parseServerArgs } from "./args.js";

export async function main(argv) {
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

  process.stdout.write(`Archa server listening on ${serverHandle.url}\n`);
  if (serverHandle.configuredRepoCount === 0) {
    process.stderr.write(
      'archa-server: no managed repos are configured yet. Suggestion: run "archa config discover-github".\n'
    );
  }

  setupShutdownHandlers(serverHandle);
  return serverHandle;
}

async function runServerGithubDiscovery(options) {
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

export function setupShutdownHandlers(serverHandle, { processRef = process } = {}) {
  let shuttingDown = false;

  function onSignal(signal) {
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
