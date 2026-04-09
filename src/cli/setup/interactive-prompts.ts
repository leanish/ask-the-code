import { emitKeypressEvents, type Key } from "node:readline";
import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises";
import process from "node:process";

export type PromptInput = {
  isTTY?: boolean;
  isRaw?: boolean;
  on?(event: "keypress", listener: (input: string, key: Key) => void): unknown;
  off?(event: "keypress", listener: (input: string, key: Key) => void): unknown;
  setRawMode?(enabled: boolean): unknown;
  resume?(): unknown;
  pause?(): unknown;
};

export type PromptOutput = {
  isTTY?: boolean;
  write?(chunk: string): unknown;
};

export type ReadlineLike = Pick<ReadlineInterface, "question" | "write" | "close">;
export type CreateInterfaceFn = (options: { input: PromptInput; output: PromptOutput }) => ReadlineLike;

type RawKeypressPromptInput = PromptInput & {
  on(event: "keypress", listener: (input: string, key: Key) => void): unknown;
  off(event: "keypress", listener: (input: string, key: Key) => void): unknown;
  setRawMode(enabled: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
};

type PromptOptions = {
  input?: PromptInput;
  output?: PromptOutput;
  createInterfaceFn?: CreateInterfaceFn;
  prompt: string;
  nonInteractiveError?: string;
};

export const defaultCreateInterface: CreateInterfaceFn = ({ input, output }) => createInterface({
  input: input as NodeJS.ReadStream,
  output: output as NodeJS.WriteStream
});

export function canPromptInteractively({
  input = process.stdin,
  output = process.stdout
}: {
  input?: PromptInput;
  output?: PromptOutput;
} = {}): boolean {
  return Boolean(input?.isTTY && output?.isTTY);
}

export async function promptEnterOrCancel({
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = defaultCreateInterface,
  prompt,
  retryPrompt = "Press Enter to continue, or press Esc to cancel.\n",
  nonInteractiveError = "Interactive Archa setup requires a TTY."
}: PromptOptions & {
  retryPrompt?: string;
}): Promise<boolean> {
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
  createInterfaceFn = defaultCreateInterface,
  prompt,
  nonInteractiveError = "Interactive Archa setup requires a TTY."
}: PromptOptions): Promise<string | null> {
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

async function promptLineOrCancelWithReadline(readline: ReadlineLike, prompt: string): Promise<string | null> {
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

function supportsImmediateEscape(input: PromptInput | undefined): input is RawKeypressPromptInput {
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
}: {
  input: RawKeypressPromptInput;
  output: PromptOutput;
  prompt: string;
}): Promise<boolean> {
  output.write?.(prompt);
  emitKeypressEvents(input as NodeJS.ReadStream);
  const previousRawMode = input.isRaw === true;
  input.setRawMode?.(true);
  input.resume?.();
  let handleKeypress: ((input: string, key: Key) => void) | null = null;
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
    input.setRawMode(previousRawMode);
    input.pause();
  };

  try {
    return await new Promise<boolean>(resolve => {
      handleKeypress = (_: string, key: Key) => {
        if (key?.name === "c" && key?.ctrl) {
          cleanup();
      output.write?.("\n");
          resolve(false);
          return;
        }

        if (key?.name === "return" || key?.name === "enter") {
          cleanup();
          output.write?.("\n");
          resolve(true);
          return;
        }

        if (key?.name === "escape") {
          cleanup();
          output.write?.("\n");
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

async function promptLineOrCancelWithEscape(readline: ReadlineLike, {
  input,
  output,
  prompt
}: {
  input: RawKeypressPromptInput;
  output: PromptOutput;
  prompt: string;
}): Promise<string | null> {
  emitKeypressEvents(input as NodeJS.ReadStream);
  const previousRawMode = input.isRaw === true;
  input.setRawMode?.(true);
  input.resume?.();
  let handleKeypress: ((input: string, key: Key) => void) | null = null;
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
    input.setRawMode(previousRawMode);
    input.pause();
  };

  try {
    return await new Promise<string | null>((resolve, reject) => {
      handleKeypress = (_: string, key: Key) => {
        if (key?.name === "c" && key?.ctrl) {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          output.write?.("\n");
          resolve(null);
          return;
        }

        if (key?.name === "escape") {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          output.write?.("\n");
          resolve(null);
        }
      };

      input.on("keypress", handleKeypress);
      readline.question(prompt)
        .then((answer: string) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve(answer);
        })
        .catch((error: unknown) => {
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
