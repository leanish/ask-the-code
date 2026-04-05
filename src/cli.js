import fs from "node:fs/promises";
import process from "node:process";

import {
  canPromptInteractively,
  promptForGithubOwner,
  promptToContinueGithubDiscovery,
  promptToInitializeConfig
} from "./cli-bootstrap.js";
import { applyGithubDiscoveryToConfig, loadConfig, initializeConfig } from "./config.js";
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
      process.stdout.write(`${renderConfigInit(result)}\n`);
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

function renderConfigInit(result) {
  return formatConfigInit(result, {
    includeNextStepSuggestion: true
  });
}

function formatConfigInit(result, {
  includeNextStepSuggestion
}) {
  const lines = [
    `Initialized config at ${result.configPath}`,
    `Managed repos root: ${result.managedReposRoot}`,
    `Repos imported: ${result.repoCount}`
  ];

  if (includeNextStepSuggestion && result.repoCount === 0) {
    lines.push("");
    lines.push('Next step: archa config discover-github --owner <github-user-or-org> --apply');
    lines.push("That imports GitHub metadata and inferred classifications into your config.");
  }

  return lines.join("\n");
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

  try {
    const config = await loadConfig(process.env);
    return await maybeBootstrapZeroRepos(options, config);
  } catch (error) {
    if (!isMissingConfigError(error) || !canPromptInteractively()) {
      throw error;
    }

    const shouldInitialize = await promptToInitializeConfig({
      configPath: getConfigPath(process.env)
    });

    if (!shouldInitialize) {
      process.stdout.write(
        'Initialization skipped. Configure the config file yourself or run "archa config init" when you are ready.\n'
      );
      return false;
    }

    const result = await initializeConfig({
      env: process.env
    });
    process.stdout.write(`${formatConfigInit(result, {
      includeNextStepSuggestion: false
    })}\n`);

    if (options.command === "config-discover-github") {
      return true;
    }

    const config = await loadConfig(process.env);
    return await maybeBootstrapZeroRepos(options, config);
  }
}

async function maybeBootstrapZeroRepos(options, config) {
  if (config.repos.length > 0 || options.command === "config-discover-github" || !canPromptInteractively()) {
    return true;
  }

  const shouldDiscover = await promptToContinueGithubDiscovery();

  if (!shouldDiscover) {
    process.stdout.write(
      'GitHub discovery skipped. Add repos manually or run "archa config discover-github --owner <github-user-or-org> --apply" when you are ready.\n'
    );
    return options.command === "repos-list";
  }

  const owner = await promptForGithubOwner();
  await runGithubDiscovery({
    owner,
    apply: true,
    includeForks: true,
    includeArchived: false,
    addRepoNames: [],
    overrideRepoNames: []
  }, config);

  const nextConfig = await loadConfig(process.env);

  if (nextConfig.repos.length > 0) {
    return true;
  }

  process.stdout.write(
    'No repos were added. Configure repos manually or run "archa config discover-github --owner <github-user-or-org> --apply".\n'
  );
  return options.command === "repos-list";
}

async function runGithubDiscovery(options, config = null) {
  const resolvedConfig = config || await loadConfig(process.env);
  const discovery = await discoverGithubOwnerRepos({
    owner: options.owner,
    env: process.env,
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

function isMissingConfigError(error) {
  return error instanceof Error && error.message.includes("Archa config not found at ");
}
