import fs from "node:fs/promises";
import process from "node:process";

import {
  ensureInteractiveConfigSetup,
  renderConfigInit as renderConfigInitSummary
} from "./cli-bootstrap.js";
import { applyGithubDiscoveryToConfig, loadConfig, initializeConfig } from "./config.js";
import { ensureCodexInstalled } from "./codex-installation.js";
import { getConfigPath } from "./config-paths.js";
import { discoverGithubOwnerRepos, planGithubRepoDiscovery } from "./github-catalog.js";
import { promptGithubDiscoverySelection, selectGithubDiscoveryRepos } from "./github-discovery-selection.js";
import { parseArgs } from "./parse-args.js";
import { answerQuestion } from "./question-answering.js";
import {
  renderAnswer,
  renderGithubDiscovery,
  renderRepoList,
  renderRetrievalOnly,
  renderSyncReport
} from "./render.js";
import { syncRepos } from "./repo-sync.js";
import { createStreamStatusReporter } from "./status-reporter.js";

export async function main(argv) {
  const options = parseArgs(argv, process.env);
  if (commandRequiresCodex(options)) {
    ensureCodexInstalled();
  }
  const shouldContinue = await ensureCliConfig(options);

  if (!shouldContinue) {
    return;
  }

  switch (options.command) {
    case "config-path":
      process.stdout.write(`${getConfigPath(process.env)}\n`);
      return;
    case "config-init": {
      const result = await initializeConfig({
        env: process.env,
        catalogPath: options.catalogPath,
        managedReposRoot: options.managedReposRoot,
        force: options.force
      });
      process.stdout.write(`${renderConfigInitSummary(result)}\n`);
      return;
    }
    case "config-discover-github": {
      await runGithubDiscovery(options);
      return;
    }
    case "repos-list": {
      const config = await loadConfig(process.env);
      process.stdout.write(`${renderRepoList(config.repos)}\n`);
      return;
    }
    case "repos-sync": {
      const config = await loadConfig(process.env);
      const repos = filterRepos(config.repos, options.repoNames);
      const report = await syncRepos(repos);
      failOnSyncFailures(report);
      process.stdout.write(`${renderSyncReport(report)}\n`);
      return;
    }
    case "ask": {
      const resolvedOptions = await resolveAskOptions(options);
      const result = await answerQuestion(resolvedOptions, {
        env: process.env,
        statusReporter: createStreamStatusReporter(process.stderr)
      });
      if (result.mode === "retrieval-only") {
        process.stdout.write(`${renderRetrievalOnly(result)}\n`);
        return;
      }
      process.stdout.write(`${renderAnswer(result)}\n`);
      return;
    }
    default:
      throw new Error(`Unsupported command: ${options.command}`);
  }
}

function commandRequiresCodex(options) {
  return (options.command === "ask" && !options.noSynthesis)
    || (options.command === "config-discover-github" && options.apply);
}

function filterRepos(repos, requestedNames) {
  if (!requestedNames || requestedNames.length === 0) {
    return repos;
  }

  const names = new Set(requestedNames.map(name => name.toLowerCase()));
  const selectedRepos = repos.filter(repo => matchesRequestedRepo(repo, names));
  const missingNames = requestedNames.filter(name => !selectedRepos.some(repo => repoMatchesName(repo, name)));

  if (missingNames.length > 0) {
    throw new Error(`Unknown managed repo(s): ${missingNames.join(", ")}`);
  }

  return selectedRepos;
}

function matchesRequestedRepo(repo, requestedNames) {
  return repoMatchesAnyName(repo, requestedNames);
}

function repoMatchesName(repo, name) {
  return repoMatchesAnyName(repo, new Set([name.toLowerCase()]));
}

function repoMatchesAnyName(repo, requestedNames) {
  if (requestedNames.has(repo.name.toLowerCase())) {
    return true;
  }

  return (repo.aliases || []).some(alias => requestedNames.has(alias.toLowerCase()));
}

async function resolveAskOptions(options) {
  if (options.command !== "ask" || !options.questionFile) {
    return options;
  }

  const question = await fs.readFile(options.questionFile, "utf8");

  return {
    ...options,
    question
  };
}

function failOnSyncFailures(report) {
  const failedSyncs = report.filter(item => item.action === "failed");
  if (failedSyncs.length === 0) {
    return;
  }

  throw new Error(`Failed to sync managed repo(s): ${failedSyncs.map(item => formatSyncFailure(item)).join(", ")}`);
}

function formatSyncFailure(item) {
  return item.detail ? `${item.name} (${item.detail})` : item.name;
}

function hasExplicitGithubDiscoverySelection(options) {
  return options.addRepoNames.length > 0 || options.overrideRepoNames.length > 0;
}

async function ensureCliConfig(options) {
  if (!requiresConfig(options.command)) {
    return true;
  }

  return ensureInteractiveConfigSetup({
    env: process.env,
    loadConfigFn: loadConfig,
    initializeConfigFn: initializeConfig,
    getConfigPathFn: getConfigPath,
    runDiscoveryFn: discoveryOptions => runGithubDiscovery(discoveryOptions),
    allowProceedWithoutRepos: options.command === "repos-list",
    skipDiscoveryPrompt: options.command === "config-discover-github"
  });
}

async function runGithubDiscovery(options, config = null) {
  const resolvedConfig = config || await loadConfig(process.env);
  const discovery = await discoverGithubOwnerRepos({
    owner: options.owner,
    env: process.env,
    curateWithCodex: options.apply,
    includeForks: options.includeForks,
    includeArchived: options.includeArchived
  });
  const plan = planGithubRepoDiscovery(resolvedConfig, discovery);

  if (!options.apply) {
    process.stdout.write(`${renderGithubDiscovery({
      ...plan,
      applied: false
    })}\n`);
    return;
  }

  const selection = hasExplicitGithubDiscoverySelection(options)
    ? selectGithubDiscoveryRepos(plan, {
        addRepoNames: options.addRepoNames,
        overrideRepoNames: options.overrideRepoNames
      })
    : await promptGithubDiscoverySelection(plan, {
        input: process.stdin,
        output: process.stdout
      });
  const applyResult = selection.reposToAdd.length > 0 || selection.reposToOverride.length > 0
    ? await applyGithubDiscoveryToConfig({
        env: process.env,
        reposToAdd: selection.reposToAdd,
        reposToOverride: selection.reposToOverride
      })
    : {
        configPath: resolvedConfig.configPath,
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
}

function requiresConfig(command) {
  return command === "config-discover-github"
    || command === "repos-list"
    || command === "repos-sync"
    || command === "ask";
}
