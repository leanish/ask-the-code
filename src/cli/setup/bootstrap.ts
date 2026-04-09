import process from "node:process";

import {
  canPromptInteractively,
  defaultCreateInterface,
  promptEnterOrCancel,
  promptLineOrCancel,
  type CreateInterfaceFn,
  type PromptInput,
  type PromptOutput
} from "./interactive-prompts.js";
import type {
  Environment,
  InitializeConfigResult,
  LoadedConfig
} from "../../core/types.js";

type DiscoveryRunOptions = {
  owner: string;
  includeForks: boolean;
  includeArchived: boolean;
  addRepoNames: string[];
  overrideRepoNames: string[];
};
type LoadedRepoList = Pick<LoadedConfig, "repos">;

export { canPromptInteractively };

export async function promptToInitializeConfig({
  configPath,
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = defaultCreateInterface
}: {
  configPath: string;
  input?: PromptInput;
  output?: PromptOutput;
  createInterfaceFn?: CreateInterfaceFn;
}): Promise<boolean> {
  return promptEnterOrCancel({
    input,
    output,
    createInterfaceFn,
    prompt: `Archa is not initialized yet: ${configPath} is missing.\nPress Enter to initialize it now, or press Esc to cancel.\n> `,
    nonInteractiveError: "Interactive Archa setup requires a TTY."
  });
}

export async function promptToContinueGithubDiscovery({
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = defaultCreateInterface
}: {
  input?: PromptInput;
  output?: PromptOutput;
  createInterfaceFn?: CreateInterfaceFn;
} = {}): Promise<boolean> {
  return promptEnterOrCancel({
    input,
    output,
    createInterfaceFn,
    prompt: "No repos are configured yet.\nPress Enter to continue with GitHub discovery, or press Esc to cancel.\n> ",
    nonInteractiveError: "Interactive Archa setup requires a TTY."
  });
}

export async function promptForGithubOwner({
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = defaultCreateInterface
}: {
  input?: PromptInput;
  output?: PromptOutput;
  createInterfaceFn?: CreateInterfaceFn;
} = {}): Promise<string | null> {
  const answer = await promptLineOrCancel({
    input,
    output,
    createInterfaceFn,
    prompt: "GitHub owner to discover from (user or org).\nPress Enter to use all accessible repos from your authenticated GitHub access.\n> ",
    nonInteractiveError: "Interactive Archa setup requires a TTY."
  });

  if (answer === null) {
    return null;
  }

  if (answer.trim() === "") {
    return "@accessible";
  }

  return answer.trim();
}

export async function ensureInteractiveConfigSetup({
  env = process.env,
  input = process.stdin,
  output = process.stdout,
  loadConfigFn,
  initializeConfigFn,
  getConfigPathFn,
  runDiscoveryFn,
  canPromptInteractivelyFn = canPromptInteractively,
  promptToInitializeConfigFn = promptToInitializeConfig,
  promptToContinueGithubDiscoveryFn = promptToContinueGithubDiscovery,
  promptForGithubOwnerFn = promptForGithubOwner,
  renderConfigInitFn = renderConfigInit,
  allowProceedWithoutRepos = false,
  skipDiscoveryPrompt = false
}: {
  env?: Environment;
  input?: PromptInput;
  output?: PromptOutput;
  loadConfigFn: (env: Environment) => Promise<LoadedRepoList>;
  initializeConfigFn: (options?: { env?: Environment }) => Promise<InitializeConfigResult>;
  getConfigPathFn: (env: Environment) => string;
  runDiscoveryFn: (options: DiscoveryRunOptions) => Promise<void>;
  canPromptInteractivelyFn?: typeof canPromptInteractively;
  promptToInitializeConfigFn?: typeof promptToInitializeConfig;
  promptToContinueGithubDiscoveryFn?: typeof promptToContinueGithubDiscovery;
  promptForGithubOwnerFn?: typeof promptForGithubOwner;
  renderConfigInitFn?: typeof renderConfigInit;
  allowProceedWithoutRepos?: boolean;
  skipDiscoveryPrompt?: boolean;
}): Promise<boolean> {
  try {
    const config = await loadConfigFn(env);
    return await maybeContinueWithZeroRepos(config);
  } catch (error) {
    if (!isMissingConfigError(error) || !canPromptInteractivelyFn({ input, output })) {
      throw error;
    }

    const shouldInitialize = await promptToInitializeConfigFn({
      configPath: getConfigPathFn(env),
      input,
      output
    });

    if (!shouldInitialize) {
      output.write?.(
        'Initialization skipped. Configure the config file yourself or run "archa config init" when you are ready.\n'
      );
      return false;
    }

    const result = await initializeConfigFn({ env });
    output.write?.(`${renderConfigInitFn(result, {
      includeNextStepSuggestion: false
    })}\n`);

    if (skipDiscoveryPrompt) {
      return true;
    }

    const config = await loadConfigFn(env);
    return await maybeContinueWithZeroRepos(config);
  }

  async function maybeContinueWithZeroRepos(config: LoadedRepoList): Promise<boolean> {
    if (skipDiscoveryPrompt || config.repos.length > 0 || !canPromptInteractivelyFn({ input, output })) {
      return true;
    }

    const shouldDiscover = await promptToContinueGithubDiscoveryFn({
      input,
      output
    });

    if (!shouldDiscover) {
      output.write?.(
        'GitHub discovery skipped. Add repos manually or run "archa config discover-github" when you are ready.\n'
      );
      return allowProceedWithoutRepos;
    }

    const owner = await promptForGithubOwnerFn({
      input,
      output
    });
    if (owner === null) {
      output.write?.(
        'GitHub discovery skipped. Add repos manually or run "archa config discover-github" when you are ready.\n'
      );
      return allowProceedWithoutRepos;
    }
    await runDiscoveryFn({
      owner,
      includeForks: true,
      includeArchived: false,
      addRepoNames: [],
      overrideRepoNames: []
    });

    const nextConfig = await loadConfigFn(env);

    if (nextConfig.repos.length > 0) {
      return true;
    }

    output.write?.(
      'No repos were added. Configure repos manually or run "archa config discover-github".\n'
    );
    return allowProceedWithoutRepos;
  }
}

export function renderConfigInit(result: InitializeConfigResult, {
  includeNextStepSuggestion = true
}: {
  includeNextStepSuggestion?: boolean;
} = {}): string {
  const lines = [
    `Initialized config at ${result.configPath}`,
    `Managed repos root: ${result.managedReposRoot}`,
    `Repos imported: ${result.repoCount}`
  ];

  if (includeNextStepSuggestion && result.repoCount === 0) {
    lines.push("");
    lines.push("Next step: archa config discover-github");
    lines.push("That imports GitHub metadata plus curated descriptions, topics, and classifications into your config.");
  }

  return lines.join("\n");
}

export function isMissingConfigError(error: unknown): error is Error {
  return error instanceof Error && error.message.includes("Archa config not found at ");
}
