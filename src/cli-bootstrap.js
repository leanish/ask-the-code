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
