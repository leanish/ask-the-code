import fs from "node:fs/promises";
import process from "node:process";

import {
  canPromptInteractively,
  ensureInteractiveConfigSetup,
  promptForGithubOwner,
  renderConfigInit as renderConfigInitSummary
} from "./setup/bootstrap.js";
import { loadConfig, initializeConfig } from "../core/config/config.js";
import { ensureCodexInstalled } from "../core/codex/codex-installation.js";
import { getConfigPath } from "../core/config/config-paths.js";
import { ensureGitInstalled } from "../core/git/git-installation.js";
import { ensureGithubDiscoveryAuthAvailable } from "../core/discovery/github-discovery-auth.js";
import { runGithubDiscoveryPipeline } from "../core/discovery/discovery-pipeline.js";
import { createGithubDiscoveryProgressReporter } from "./setup/discovery-progress.js";
import { promptGithubDiscoverySelection, selectGithubDiscoveryRepos } from "./setup/discovery-selection.js";
import { parseArgs } from "./parse-args.js";
import { answerQuestion } from "../core/answer/question-answering.js";
import {
  renderAnswer,
  renderGithubDiscovery,
  renderRepoList,
  renderRetrievalOnly,
  renderSyncReport
} from "./render.js";
import { syncRepos } from "../core/repos/repo-sync.js";
import { createStreamStatusReporter } from "../core/status/status-reporter.js";

export async function main(argv) {
  const options = parseArgs(argv, process.env);
  if (commandRequiresGit(options)) {
    ensureGitInstalled();
  }
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
      process.stdout.write(`${await renderRepoList(config.repos)}\n`);
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
      const statusReporter = createStreamStatusReporter(process.stderr);
      let result;

      try {
        result = await answerQuestion(resolvedOptions, {
          env: process.env,
          statusReporter
        });
      } finally {
        statusReporter.flush?.();
      }

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
  return options.command === "ask" && !options.noSynthesis;
}

function commandRequiresGit(options) {
  return options.command === "repos-sync"
    || (options.command === "ask" && !options.noSync);
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
  ensureGitInstalled();
  ensureCodexInstalled();
  ensureGithubDiscoveryAuthAvailable({ env: process.env });
  const resolvedConfig = config || await loadConfig(process.env);
  const resolvedOwner = await resolveGithubDiscoveryOwner(options.owner);
  if (resolvedOwner === null) {
    process.stdout.write("GitHub discovery cancelled.\n");
    return;
  }
  const progressReporter = createGithubDiscoveryProgressReporter();
  progressReporter.start(resolvedOwner);

  try {
    const result = await runGithubDiscoveryPipeline({
      config: resolvedConfig,
      owner: resolvedOwner,
      env: process.env,
      includeForks: options.includeForks,
      includeArchived: options.includeArchived,
      resolveSelectionFn: async plan => hasExplicitGithubDiscoverySelection(options)
        ? selectGithubDiscoveryRepos(plan, {
            addRepoNames: options.addRepoNames,
            overrideRepoNames: options.overrideRepoNames
          })
        : await promptGithubDiscoverySelection(plan, {
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

async function resolveGithubDiscoveryOwner(owner) {
  if (owner) {
    return owner;
  }

  if (!canPromptInteractively({
    input: process.stdin,
    output: process.stdout
  })) {
    return "@accessible";
  }

  return promptForGithubOwner({
    input: process.stdin,
    output: process.stdout
  });
}

function requiresConfig(command) {
  return command === "config-discover-github"
    || command === "repos-list"
    || command === "repos-sync"
    || command === "ask";
}
