import { createInterface } from "node:readline/promises";
import process from "node:process";

export function canPromptInteractively({
  input = process.stdin,
  output = process.stdout
} = {}) {
  return Boolean(input?.isTTY && output?.isTTY);
}

export async function promptToInitializeConfig({
  configPath,
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = createInterface
} = {}) {
  return withReadline({
    input,
    output,
    createInterfaceFn
  }, readline => promptYesNo(
    readline,
    `Archa is not initialized yet: ${configPath} is missing.\nInitialize it now? [Y/n]\n> `,
    true
  ));
}

export async function promptToContinueGithubDiscovery({
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = createInterface
} = {}) {
  return withReadline({
    input,
    output,
    createInterfaceFn
  }, readline => promptYesNo(
    readline,
    "No repos are configured yet.\nContinue with GitHub discovery now? [Y/n]\n> ",
    true
  ));
}

export async function promptForGithubOwner({
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = createInterface
} = {}) {
  return withReadline({
    input,
    output,
    createInterfaceFn
  }, readline => promptRequiredValue(
    readline,
    "GitHub owner to discover from (user or org)\n> "
  ));
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
} = {}) {
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
      output.write(
        'Initialization skipped. Configure the config file yourself or run "archa config init" when you are ready.\n'
      );
      return false;
    }

    const result = await initializeConfigFn({ env });
    output.write(`${renderConfigInitFn(result, {
      includeNextStepSuggestion: false
    })}\n`);

    if (skipDiscoveryPrompt) {
      return true;
    }

    const config = await loadConfigFn(env);
    return await maybeContinueWithZeroRepos(config);
  }

  async function maybeContinueWithZeroRepos(config) {
    if (skipDiscoveryPrompt || config.repos.length > 0 || !canPromptInteractivelyFn({ input, output })) {
      return true;
    }

    const shouldDiscover = await promptToContinueGithubDiscoveryFn({
      input,
      output
    });

    if (!shouldDiscover) {
      output.write(
        'GitHub discovery skipped. Add repos manually or run "archa config discover-github --owner <github-user-or-org> --apply" when you are ready.\n'
      );
      return allowProceedWithoutRepos;
    }

    const owner = await promptForGithubOwnerFn({
      input,
      output
    });
    await runDiscoveryFn({
      owner,
      apply: true,
      includeForks: true,
      includeArchived: false,
      addRepoNames: [],
      overrideRepoNames: []
    });

    const nextConfig = await loadConfigFn(env);

    if (nextConfig.repos.length > 0) {
      return true;
    }

    output.write(
      'No repos were added. Configure repos manually or run "archa config discover-github --owner <github-user-or-org> --apply".\n'
    );
    return allowProceedWithoutRepos;
  }
}

export function renderConfigInit(result, {
  includeNextStepSuggestion = true
} = {}) {
  const lines = [
    `Initialized config at ${result.configPath}`,
    `Managed repos root: ${result.managedReposRoot}`,
    `Repos imported: ${result.repoCount}`
  ];

  if (includeNextStepSuggestion && result.repoCount === 0) {
    lines.push("");
    lines.push('Next step: archa config discover-github --owner <github-user-or-org> --apply');
    lines.push("That imports GitHub metadata plus curated descriptions, topics, and classifications into your config.");
  }

  return lines.join("\n");
}

export function isMissingConfigError(error) {
  return error instanceof Error && error.message.includes("Archa config not found at ");
}

async function withReadline({
  input,
  output,
  createInterfaceFn
}, callback) {
  if (!canPromptInteractively({ input, output })) {
    throw new Error("Interactive Archa setup requires a TTY.");
  }

  const readline = createInterfaceFn({
    input,
    output
  });

  try {
    return await callback(readline);
  } finally {
    readline.close();
  }
}

async function promptYesNo(readline, prompt, defaultValue) {
  while (true) {
    const answer = (await readline.question(prompt)).trim().toLowerCase();

    if (answer === "") {
      return defaultValue;
    }

    if (answer === "y" || answer === "yes") {
      return true;
    }

    if (answer === "n" || answer === "no") {
      return false;
    }

    readline.write('Please answer "yes" or "no".\n');
  }
}

async function promptRequiredValue(readline, prompt) {
  while (true) {
    const answer = (await readline.question(prompt)).trim();

    if (answer !== "") {
      return answer;
    }

    readline.write("Please enter a value.\n");
  }
}
