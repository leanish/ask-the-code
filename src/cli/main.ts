import fs from "node:fs/promises";
import process from "node:process";

import {
  canPromptInteractively,
  ensureInteractiveConfigSetup,
  promptForGithubOwner,
  renderConfigInit as renderConfigInitSummary
} from "./setup/bootstrap.ts";
import { loadConfig, initializeConfig } from "../core/config/config.ts";
import { ensureCodexInstalled } from "../core/codex/codex-installation.ts";
import { getConfigPath } from "../core/config/config-paths.ts";
import { ensureGitInstalled } from "../core/git/git-installation.ts";
import { ACCESSIBLE_GITHUB_OWNER } from "../core/discovery/constants.ts";
import { ensureGithubDiscoveryAuthAvailable } from "../core/discovery/github-discovery-auth.ts";
import { runGithubDiscoveryPipeline } from "../core/discovery/discovery-pipeline.ts";
import { createGithubDiscoveryProgressReporter } from "./setup/discovery-progress.ts";
import { promptGithubDiscoverySelection, selectGithubDiscoveryRepos } from "./setup/discovery-selection.ts";
import { parseArgs } from "./parse-args.ts";
import { answerQuestion } from "../core/answer/question-answering.ts";
import { selectReposByRequestedNames } from "../core/repos/repo-identifiers.ts";
import {
  renderAnswer,
  renderGithubDiscovery,
  renderRepoList,
  renderRetrievalOnly,
  renderSyncReport
} from "./render.ts";
import { syncRepos } from "../core/repos/repo-sync.ts";
import { formatSyncFailures } from "../core/repos/sync-report-format.ts";
import { createStreamStatusReporter } from "../core/status/status-reporter.ts";
import type {
  AskCommandOptions,
  CliCommandOptions,
  ConfigDiscoverGithubCommandOptions,
  LoadedConfig,
  ManagedRepo,
  SyncReportItem
} from "../core/types.ts";

type GithubDiscoveryOptions = Omit<ConfigDiscoverGithubCommandOptions, "command">;

export async function main(argv: string[]): Promise<void> {
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
      return assertNever(options);
  }
}

function commandRequiresCodex(options: CliCommandOptions): boolean {
  return options.command === "ask" && !options.noSynthesis;
}

function commandRequiresGit(options: CliCommandOptions): boolean {
  return options.command === "repos-sync"
    || (options.command === "ask" && !options.noSync);
}

function filterRepos(repos: ManagedRepo[], requestedNames: string[]): ManagedRepo[] {
  if (!requestedNames || requestedNames.length === 0) {
    return repos;
  }

  return selectReposByRequestedNames(repos, requestedNames);
}

async function resolveAskOptions(options: AskCommandOptions): Promise<AskCommandOptions> {
  if (options.command !== "ask" || !options.questionFile) {
    return options;
  }

  const question = await fs.readFile(options.questionFile, "utf8");

  return {
    ...options,
    question
  };
}

function failOnSyncFailures(report: SyncReportItem[]): void {
  const failedSyncs = report.filter(item => item.action === "failed");
  if (failedSyncs.length === 0) {
    return;
  }

  throw new Error(`Failed to sync managed repo(s): ${formatSyncFailures(failedSyncs)}`);
}

function hasExplicitGithubDiscoverySelection(options: GithubDiscoveryOptions): boolean {
  return options.addRepoNames.length > 0 || options.overrideRepoNames.length > 0;
}

async function ensureCliConfig(options: CliCommandOptions): Promise<boolean> {
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

async function runGithubDiscovery(
  options: GithubDiscoveryOptions,
  config: LoadedConfig | null = null
): Promise<void> {
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

async function resolveGithubDiscoveryOwner(owner: string | null): Promise<string | null> {
  if (owner) {
    return owner;
  }

  if (!canPromptInteractively({
    input: process.stdin,
    output: process.stdout
  })) {
    return ACCESSIBLE_GITHUB_OWNER;
  }

  return promptForGithubOwner({
    input: process.stdin,
    output: process.stdout
  });
}

function requiresConfig(command: CliCommandOptions["command"]): boolean {
  return command === "config-discover-github"
    || command === "repos-list"
    || command === "repos-sync"
    || command === "ask";
}

function assertNever(value: never): never {
  throw new Error(`Unsupported command: ${String(value)}`);
}
