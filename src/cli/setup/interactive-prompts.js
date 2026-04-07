import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import process from "node:process";

export function canPromptInteractively({
  input = process.stdin,
  output = process.stdout
} = {}) {
  return Boolean(input?.isTTY && output?.isTTY);
}

export async function promptEnterOrCancel({
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = createInterface,
  prompt,
  retryPrompt = "Press Enter to continue, or press Esc to cancel.\n",
  nonInteractiveError = "Interactive Archa setup requires a TTY."
}) {
  if (!canPromptInteractively({ input, output })) {
    throw new Error(nonInteractiveError);
  }

  if (supportsImmediateEscape(input)) {
    return await promptEnterOrCancelWithEscape({
      input,
      output,
      prompt
    });
  }

  const readline = createInterfaceFn({
    input,
    output
  });

  try {
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

      readline.write(retryPrompt);
    }
  } finally {
    readline.close();
  }
}

export async function promptLineOrCancel({
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = createInterface,
  prompt,
  nonInteractiveError = "Interactive Archa setup requires a TTY."
}) {
  if (!canPromptInteractively({ input, output })) {
    throw new Error(nonInteractiveError);
  }

  const readline = createInterfaceFn({
    input,
    output
  });

  try {
    return supportsImmediateEscape(input)
      ? await promptLineOrCancelWithEscape(readline, {
          input,
          output,
          prompt
        })
      : await promptLineOrCancelWithReadline(readline, prompt);
  } finally {
    readline.close();
  }
}

async function promptLineOrCancelWithReadline(readline, prompt) {
  const answer = await readline.question(prompt);
  const normalizedAnswer = answer.trim().toLowerCase();

  if (answer.trim() === "\u001b"
    || normalizedAnswer === "esc"
    || normalizedAnswer === "escape"
    || normalizedAnswer === "cancel") {
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

async function promptEnterOrCancelWithEscape({
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

async function promptLineOrCancelWithEscape(readline, {
  input,
  output,
  prompt
}) {
  emitKeypressEvents(input);
  const previousRawMode = input.isRaw === true;
  input.setRawMode?.(true);
  input.resume?.();
  let handleKeypress = null;
  let cleanedUp = false;
  let settled = false;

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
    return await new Promise((resolve, reject) => {
      handleKeypress = (_, key) => {
        if (key?.name === "c" && key?.ctrl) {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          output.write("\n");
          readline.close();
          resolve(null);
          return;
        }

        if (key?.name === "escape") {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          output.write("\n");
          readline.close();
          resolve(null);
        }
      };

      input.on("keypress", handleKeypress);
      readline.question(prompt)
        .then(answer => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve(answer);
        })
        .catch(error => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          reject(error);
        });
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}
