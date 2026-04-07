import { emitKeypressEvents } from "node:readline";
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
  return promptEnterOrCancel({
    input,
    output,
    createInterfaceFn,
    prompt: `Archa is not initialized yet: ${configPath} is missing.\nPress Enter to initialize it now, or press Esc to cancel.\n> `
  });
}

export async function promptToContinueGithubDiscovery({
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = createInterface
} = {}) {
  return promptEnterOrCancel({
    input,
    output,
    createInterfaceFn,
    prompt: "No repos are configured yet.\nPress Enter to continue with GitHub discovery, or press Esc to cancel.\n> "
  });
}

export async function promptForGithubOwner({
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = createInterface
} = {}) {
  const answer = await promptLineOrCancel({
    input,
    output,
    createInterfaceFn,
    prompt: "GitHub owner to discover from (user or org).\nPress Enter to use all accessible repos from your authenticated GitHub access.\n> "
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
        'GitHub discovery skipped. Add repos manually or run "archa config discover-github" when you are ready.\n'
      );
      return allowProceedWithoutRepos;
    }

    const owner = await promptForGithubOwnerFn({
      input,
      output
    });
    if (owner === null) {
      output.write(
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

    output.write(
      'No repos were added. Configure repos manually or run "archa config discover-github".\n'
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
    lines.push("Next step: archa config discover-github");
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

async function promptEnterOrCancel({
  input,
  output,
  createInterfaceFn,
  prompt
}) {
  if (supportsImmediateEscape(input)) {
    return await promptEnterOrEscape({
      input,
      output,
      prompt
    });
  }

  return withReadline({
    input,
    output,
    createInterfaceFn
  }, readline => promptEnterOrCancelWithReadline(readline, prompt));
}

async function promptLineOrCancel({
  input,
  output,
  createInterfaceFn,
  prompt
}) {
  if (supportsImmediateEscape(input)) {
    return await promptLineOrEscape({
      input,
      output,
      prompt
    });
  }

  return withReadline({
    input,
    output,
    createInterfaceFn
  }, readline => promptLineOrCancelWithReadline(readline, prompt));
}

async function promptEnterOrCancelWithReadline(readline, prompt) {
  while (true) {
    const answer = (await readline.question(prompt)).trim();
    const normalizedAnswer = answer.toLowerCase();

    if (answer === "") {
      return true;
    }

    if (answer === "\u001b"
      || normalizedAnswer === "esc"
      || normalizedAnswer === "escape"
      || normalizedAnswer === "cancel"
      || normalizedAnswer === "skip"
      || normalizedAnswer === "n"
      || normalizedAnswer === "no") {
      return false;
    }

    readline.write("Press Enter to continue, or press Esc to cancel.\n");
  }
}

async function promptEnterOrEscape({
  input,
  output,
  prompt
}) {
  output.write(prompt);
  emitKeypressEvents(input);
  const previousRawMode = input.isRaw === true;
  input.setRawMode?.(true);
  input.resume?.();
  let handleKeypress = null;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    if (handleKeypress) {
      input.off("keypress", handleKeypress);
      handleKeypress = null;
    }
    input.setRawMode?.(previousRawMode);
    input.pause?.();
  };

  try {
    return await new Promise(resolve => {
      handleKeypress = (_, key) => {
        if (key?.name === "c" && key?.ctrl) {
          cleanup();
          output.write("\n");
          resolve(false);
          return;
        }

        if (key?.name === "return" || key?.name === "enter") {
          cleanup();
          output.write("\n");
          resolve(true);
          return;
        }

        if (key?.name === "escape") {
          cleanup();
          output.write("\n");
          resolve(false);
        }
      };

      input.on("keypress", handleKeypress);
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function promptLineOrCancelWithReadline(readline, prompt) {
  const answer = await readline.question(prompt);
  const normalizedAnswer = answer.trim().toLowerCase();

  if (answer.trim() === "\u001b"
    || normalizedAnswer === "esc"
    || normalizedAnswer === "escape"
    || normalizedAnswer === "cancel"
    || normalizedAnswer === "skip"
    || normalizedAnswer === "n"
    || normalizedAnswer === "no") {
    return null;
  }

  return answer;
}

function supportsImmediateEscape(input) {
  return Boolean(
    input
    && typeof input.on === "function"
    && typeof input.off === "function"
    && typeof input.setRawMode === "function"
  );
}

async function promptLineOrEscape({
  input,
  output,
  prompt
}) {
  output.write(prompt);
  emitKeypressEvents(input);
  const previousRawMode = input.isRaw === true;
  input.setRawMode?.(true);
  input.resume?.();
  let buffer = "";
  let handleKeypress = null;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    if (handleKeypress) {
      input.off("keypress", handleKeypress);
      handleKeypress = null;
    }
    input.setRawMode?.(previousRawMode);
    input.pause?.();
  };

  try {
    return await new Promise(resolve => {
      handleKeypress = (text, key) => {
        if (key?.name === "c" && key?.ctrl) {
          cleanup();
          output.write("\n");
          resolve(null);
          return;
        }

        if (key?.name === "return" || key?.name === "enter") {
          cleanup();
          output.write("\n");
          resolve(buffer);
          return;
        }

        if (key?.name === "escape") {
          cleanup();
          output.write("\n");
          resolve(null);
          return;
        }

        if (key?.name === "backspace") {
          if (buffer.length === 0) {
            return;
          }
          buffer = buffer.slice(0, -1);
          output.write("\b \b");
          return;
        }

        if (isPrintableText(text, key)) {
          buffer += text;
          output.write(text);
        }
      };

      input.on("keypress", handleKeypress);
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}

function isPrintableText(text, key) {
  return typeof text === "string"
    && text !== ""
    && /^[\x20-\x7E]+$/.test(text)
    && !key?.ctrl
    && !key?.meta;
}
