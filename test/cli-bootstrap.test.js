import { describe, expect, it, vi } from "vitest";

import {
  canPromptInteractively,
  promptForGithubOwner,
  promptToContinueGithubDiscovery,
  promptToInitializeConfig
} from "../src/cli-bootstrap.js";

describe("cli-bootstrap", () => {
  it("detects whether interactive prompts are available", () => {
    expect(canPromptInteractively({
      input: { isTTY: true },
      output: { isTTY: true }
    })).toBe(true);
    expect(canPromptInteractively({
      input: { isTTY: true },
      output: { isTTY: false }
    })).toBe(false);
  });

  it("defaults config initialization prompts to yes", async () => {
    const readline = createReadline([""]);

    const result = await promptToInitializeConfig({
      configPath: "/tmp/archa-config.json",
      input: { isTTY: true },
      output: { isTTY: true },
      createInterfaceFn: () => readline
    });

    expect(result).toBe(true);
    expect(readline.question).toHaveBeenCalledWith(
      "Archa is not initialized yet: /tmp/archa-config.json is missing.\nInitialize it now? [Y/n]\n> "
    );
    expect(readline.close).toHaveBeenCalled();
  });

  it("re-prompts for discovery confirmation until a valid answer is given", async () => {
    const readline = createReadline(["wat", "no"]);

    const result = await promptToContinueGithubDiscovery({
      input: { isTTY: true },
      output: { isTTY: true },
      createInterfaceFn: () => readline
    });

    expect(result).toBe(false);
    expect(readline.write).toHaveBeenCalledWith('Please answer "yes" or "no".\n');
  });

  it("requires a non-empty GitHub owner", async () => {
    const readline = createReadline(["", " leanish "]);

    const result = await promptForGithubOwner({
      input: { isTTY: true },
      output: { isTTY: true },
      createInterfaceFn: () => readline
    });

    expect(result).toBe("leanish");
    expect(readline.write).toHaveBeenCalledWith("Please enter a value.\n");
  });
});

function createReadline(answers) {
  const queue = [...answers];

  return {
    question: vi.fn(async () => queue.shift() ?? ""),
    write: vi.fn(),
    close: vi.fn()
  };
}
