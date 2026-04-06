import process from "node:process";

import { applyGithubDiscoveryToConfig, initializeConfig, loadConfig } from "./config.js";
import { ensureCodexInstalled } from "./codex-installation.js";
import { getConfigPath } from "./config-paths.js";
import { ensureGitInstalled } from "./git-installation.js";
import { ensureGithubDiscoveryAuthAvailable } from "./github-discovery-auth.js";
import { ensureInteractiveConfigSetup } from "./cli-bootstrap.js";
import {
  discoverGithubOwnerRepos,
  mergeGithubDiscoveryPlan,
  planGithubRepoDiscovery
} from "./github-catalog.js";
import { createGithubDiscoveryProgressReporter } from "./github-discovery-progress.js";
import { promptGithubDiscoverySelection } from "./github-discovery-selection.js";
import { startHttpServer } from "./http-server.js";
import { renderGithubDiscovery } from "./render.js";
import { HelpError, parseServerArgs } from "./server-args.js";

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
      'archa-server: no managed repos are configured yet. Suggestion: run "archa config discover-github --owner <github-user-or-org> --apply".\n'
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
    const discovery = await discoverGithubOwnerRepos({
      owner: options.owner,
      env: process.env,
      curateWithCodex: false,
      inspectRepos: false,
      onProgress: event => progressReporter.onProgress(event),
      includeForks: options.includeForks,
      includeArchived: options.includeArchived
    });
    let plan = planGithubRepoDiscovery(config, discovery);
    let selection = await promptGithubDiscoverySelection(plan, {
      input: process.stdin,
      output: process.stdout
    });
    const selectedRepoNames = collectSelectedRepoNames(selection);

    if (selectedRepoNames.length > 0) {
      const refinedDiscovery = await discoverGithubOwnerRepos({
        owner: options.owner,
        env: process.env,
        curateWithCodex: true,
        inspectRepos: true,
        selectedRepoNames,
        onProgress: event => progressReporter.onProgress(event),
        includeForks: options.includeForks,
        includeArchived: options.includeArchived
      });
      const refinedPlan = planGithubRepoDiscovery(config, refinedDiscovery);
      const refinedReposByName = new Map(
        refinedDiscovery.repos.map(repo => [repo.name, repo])
      );

      plan = mergeGithubDiscoveryPlan(plan, refinedPlan);
      selection = {
        reposToAdd: selection.reposToAdd.map(repo => refinedReposByName.get(repo.name) || repo),
        reposToOverride: selection.reposToOverride.map(repo => refinedReposByName.get(repo.name) || repo)
      };
    }

    const applyResult = selection.reposToAdd.length > 0 || selection.reposToOverride.length > 0
      ? await applyGithubDiscoveryToConfig({
          env: process.env,
          reposToAdd: selection.reposToAdd,
          reposToOverride: selection.reposToOverride
        })
      : {
          configPath: config.configPath,
          addedCount: 0,
          overriddenCount: 0
        };

    process.stdout.write(`${renderGithubDiscovery({
      ...plan,
      applied: true,
      configPath: applyResult.configPath,
      addedCount: applyResult.addedCount,
      overriddenCount: applyResult.overriddenCount
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

function collectSelectedRepoNames(selection) {
  return [...new Set([
    ...selection.reposToAdd.map(repo => repo.name),
    ...selection.reposToOverride.map(repo => repo.name)
  ])];
}
