import fs from "node:fs/promises";
import process from "node:process";

import {
  canPromptInteractively,
  ensureInteractiveConfigSetup,
  promptForGithubOwner,
  renderConfigInit as renderConfigInitSummary
} from "./cli-bootstrap.js";
import { applyGithubDiscoveryToConfig, loadConfig, initializeConfig } from "./config.js";
import { ensureCodexInstalled } from "./codex-installation.js";
import { getConfigPath } from "./config-paths.js";
import { ensureGitInstalled } from "./git-installation.js";
import { ensureGithubDiscoveryAuthAvailable } from "./github-discovery-auth.js";
import {
  buildAppliedGithubDiscoveryEntries,
  discoverGithubOwnerRepos,
  getGithubDiscoveryRepoKey,
  mergeGithubDiscoveryPlan,
  planGithubRepoDiscovery,
  refineDiscoveredGithubRepos
} from "./github-catalog.js";
import { createGithubDiscoveryProgressReporter } from "./github-discovery-progress.js";
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
  return options.command === "ask" && !options.noSynthesis;
}

function commandRequiresGit(options) {
  return options.command === "repos-sync"
    || options.command === "config-discover-github"
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
  ensureGithubDiscoveryAuthAvailable({ env: process.env });
  ensureCodexInstalled();
  const resolvedConfig = config || await loadConfig(process.env);
  const resolvedOwner = await resolveGithubDiscoveryOwner(options.owner);
  const progressReporter = createGithubDiscoveryProgressReporter();
  progressReporter.start(resolvedOwner);

  try {
    const discovery = await discoverGithubOwnerRepos({
      owner: resolvedOwner,
      env: process.env,
      curateWithCodex: false,
      inspectRepos: false,
      hydrateMetadata: !options.apply,
      onProgress: event => progressReporter.onProgress(event),
      includeForks: options.includeForks,
      includeArchived: options.includeArchived
    });
    let plan = planGithubRepoDiscovery(resolvedConfig, discovery);

    if (!options.apply) {
      process.stdout.write(`${renderGithubDiscovery({
        ...plan,
        applied: false
      })}\n`);
      return;
    }

    let selection = hasExplicitGithubDiscoverySelection(options)
      ? selectGithubDiscoveryRepos(plan, {
          addRepoNames: options.addRepoNames,
          overrideRepoNames: options.overrideRepoNames
        })
      : await promptGithubDiscoverySelection(plan, {
          input: process.stdin,
          output: process.stdout
        });
    const selectedRepoNames = collectSelectedRepoNames(selection);
    let configPath = resolvedConfig.configPath;
    let addedCount = 0;
    let overriddenCount = 0;

    if (selectedRepoNames.length > 0) {
      const selectedRepoActions = buildSelectedRepoActions(selection);
      const refinedDiscovery = await refineDiscoveredGithubRepos({
        discovery,
        env: process.env,
        curateWithCodex: true,
        inspectRepos: true,
        selectedRepoNames,
        onHydratedRepo: async repo => {
          const actionKey = getGithubDiscoveryRepoKey(repo);
          const action = selectedRepoActions.get(actionKey);
          if (!action) {
            return;
          }

          const applyResult = await applyGithubDiscoveryToConfig({
            env: process.env,
            reposToAdd: action === "add" ? [repo] : [],
            reposToOverride: action === "override" ? [repo] : []
          });
          configPath = applyResult.configPath;
          if (action === "add") {
            addedCount += 1;
          } else {
            overriddenCount += 1;
          }
          progressReporter.onProgress({
            type: "repo-applied",
            repoName: repo.name,
            processedCount: addedCount + overriddenCount,
            totalCount: selectedRepoNames.length
          });
        },
        onProgress: event => progressReporter.onProgress(event),
        includeForks: options.includeForks,
        includeArchived: options.includeArchived
      });
      const refinedPlan = planGithubRepoDiscovery(resolvedConfig, refinedDiscovery);
      const refinedReposByName = new Map(
        refinedPlan.entries.map(entry => [getGithubDiscoveryRepoKey(entry.repo), entry.repo])
      );

      plan = mergeGithubDiscoveryPlan(plan, refinedPlan);
      selection = {
        reposToAdd: selection.reposToAdd.map(repo => refinedReposByName.get(getGithubDiscoveryRepoKey(repo)) || repo),
        reposToOverride: selection.reposToOverride.map(repo => refinedReposByName.get(getGithubDiscoveryRepoKey(repo)) || repo)
      };
    }

    process.stdout.write(`${renderGithubDiscovery({
      ...plan,
      applied: true,
      appliedEntries: buildAppliedGithubDiscoveryEntries(plan, selection),
      selectedCount: selectedRepoNames.length,
      configPath,
      addedCount,
      overriddenCount
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

function collectSelectedRepoNames(selection) {
  return [...new Set([
    ...selection.reposToAdd.map(repo => repo.sourceFullName || repo.name),
    ...selection.reposToOverride.map(repo => repo.sourceFullName || repo.name)
  ])];
}

function buildSelectedRepoActions(selection) {
  return new Map([
    ...selection.reposToAdd.map(repo => [getGithubDiscoveryRepoKey(repo), "add"]),
    ...selection.reposToOverride.map(repo => [getGithubDiscoveryRepoKey(repo), "override"])
  ]);
}
