import { EventEmitter } from "node:events";
import type { Key } from "node:readline";

import { describe, expect, it, vi } from "vitest";

import {
  canPromptInteractively,
  ensureInteractiveConfigSetup,
  promptForGithubOwner,
  promptToContinueGithubDiscovery,
  promptToInitializeConfig,
  renderConfigInit
} from "../src/cli/setup/bootstrap.js";
import type { CreateInterfaceFn, PromptInput, ReadlineLike } from "../src/cli/setup/interactive-prompts.js";
import { createInitializeConfigResult, createLoadedConfig, createManagedRepo } from "./test-helpers.js";

type TestRawKeypressInput = EventEmitter & PromptInput & {
  isTTY: true;
  isRaw: boolean;
  _paused: boolean;
  setRawMode(enabled: boolean): void;
  isPaused(): boolean;
  resume(): void;
  pause(): void;
  emit(event: "keypress", input: string, key: Key): boolean;
};

type PendingReadlineInstance = {
  resolveQuestion: ((value: string) => void) | null;
  readline: ReadlineLike;
};

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

  it("defaults config initialization prompts to Enter", async () => {
    const readline = createReadline([""]);

    const result = await promptToInitializeConfig({
      configPath: "/tmp/atc-config.json",
      input: { isTTY: true },
      output: { isTTY: true },
      createInterfaceFn: () => readline
    });

    expect(result).toBe(true);
    expect(readline.question).toHaveBeenCalledWith(
      "ask-the-code is not initialized yet: /tmp/atc-config.json is missing.\nPress Enter to initialize it now, or press Esc to cancel.\n> "
    );
    expect(readline.close).toHaveBeenCalled();
  });

  it("cancels immediately on Esc when raw keypress input is available", async () => {
    const input = createRawKeypressInput();
    const output = {
      isTTY: true,
      write: vi.fn()
    };
    const resultPromise = promptToInitializeConfig({
      configPath: "/tmp/atc-config.json",
      input,
      output
    });

    input.emit("keypress", "\u001b", {
      name: "escape"
    });

    const result = await resultPromise;

    expect(result).toBe(false);
    expect(output.write).toHaveBeenNthCalledWith(
      1,
      "ask-the-code is not initialized yet: /tmp/atc-config.json is missing.\nPress Enter to initialize it now, or press Esc to cancel.\n> "
    );
    expect(output.write).toHaveBeenNthCalledWith(2, "\n");
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(2, false);
    expect(input.resume).toHaveBeenCalledTimes(1);
    expect(input.pause).toHaveBeenCalledTimes(1);
  });

  it("cancels immediately on Ctrl+C when raw keypress input is available", async () => {
    const input = createRawKeypressInput();
    const output = {
      isTTY: true,
      write: vi.fn()
    };
    const resultPromise = promptToInitializeConfig({
      configPath: "/tmp/atc-config.json",
      input,
      output
    });

    input.emit("keypress", "\u0003", {
      name: "c",
      ctrl: true
    });

    const result = await resultPromise;

    expect(result).toBe(false);
    expect(output.write).toHaveBeenNthCalledWith(
      1,
      "ask-the-code is not initialized yet: /tmp/atc-config.json is missing.\nPress Enter to initialize it now, or press Esc to cancel.\n> "
    );
    expect(output.write).toHaveBeenNthCalledWith(2, "\n");
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(2, false);
    expect(input.resume).toHaveBeenCalledTimes(1);
    expect(input.pause).toHaveBeenCalledTimes(1);
  });

  it("does not pause raw keypress input that was already flowing", async () => {
    const input = createRawKeypressInput({
      paused: false
    });
    const output = {
      isTTY: true,
      write: vi.fn()
    };
    const resultPromise = promptToInitializeConfig({
      configPath: "/tmp/atc-config.json",
      input,
      output
    });

    input.emit("keypress", "\u001b", {
      name: "escape"
    });

    const result = await resultPromise;

    expect(result).toBe(false);
    expect(input.resume).toHaveBeenCalledTimes(1);
    expect(input.pause).toHaveBeenCalledTimes(1);
  });

  it("re-prompts for discovery confirmation until a valid answer is given", async () => {
    const readline = createReadline(["wat", "\u001b"]);

    const result = await promptToContinueGithubDiscovery({
      input: { isTTY: true },
      output: { isTTY: true },
      createInterfaceFn: () => readline
    });

    expect(result).toBe(false);
    expect(readline.write).toHaveBeenCalledWith("Press Enter to continue, or press Esc to cancel.\n");
  });

  it("defaults a blank GitHub owner prompt to accessible discovery", async () => {
    const readline = createReadline([""]);

    const result = await promptForGithubOwner({
      input: { isTTY: true },
      output: { isTTY: true },
      createInterfaceFn: () => readline
    });

    expect(result).toBe("@accessible");
    expect(readline.question).toHaveBeenCalledWith(
      "GitHub owner to discover from (user or org).\nPress Enter to use all accessible repos from your authenticated GitHub access.\n> "
    );
  });

  it("cancels the GitHub owner prompt immediately on Esc when raw keypress input is available", async () => {
    const input = createRawKeypressInput();
    const readlineFactory = createPendingReadlineFactory();

    const resultPromise = promptForGithubOwner({
      input,
      output: { isTTY: true },
      createInterfaceFn: readlineFactory.createInterfaceFn
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    input.emit("keypress", "\u001b", {
      name: "escape"
    });

    await expect(resultPromise).resolves.toBeNull();
    expect(readlineFactory.instances[0]!.readline.question).toHaveBeenCalledWith(
      "GitHub owner to discover from (user or org).\nPress Enter to use all accessible repos from your authenticated GitHub access.\n> "
    );
    expect(readlineFactory.instances[0]!.readline.close).toHaveBeenCalled();
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(2, false);
    expect(input.resume).toHaveBeenCalledTimes(1);
    expect(input.pause).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit GitHub owners when provided", async () => {
    const readline = createReadline([" leanish "]);

    const result = await promptForGithubOwner({
      input: { isTTY: true },
      output: { isTTY: true },
      createInterfaceFn: () => readline
    });

    expect(result).toBe("leanish");
  });

  it("initializes and continues into discovery when config is missing", async () => {
    const loadConfigFn = vi.fn()
      .mockRejectedValueOnce(new Error('ask-the-code config not found at /tmp/atc-config.json. Run "atc config init" or set ATC_CONFIG_PATH.'))
      .mockResolvedValueOnce(createLoadedConfig({ repos: [] }))
      .mockResolvedValueOnce(createLoadedConfig({ repos: [createManagedRepo({ name: "ask-the-code" })] }));
    const initializeConfigFn = vi.fn(async () => createInitializeConfigResult({
      configPath: "/tmp/atc-config.json",
      managedReposRoot: "/workspace/repos",
      repoCount: 0
    }));
    const runDiscoveryFn = vi.fn(async () => {});
    const output = { isTTY: true, write: vi.fn() };

    const result = await ensureInteractiveConfigSetup({
      env: process.env,
      input: { isTTY: true },
      output,
      loadConfigFn,
      initializeConfigFn,
      getConfigPathFn: () => "/tmp/atc-config.json",
      runDiscoveryFn,
      canPromptInteractivelyFn: () => true,
      promptToInitializeConfigFn: vi.fn(async () => true),
      promptToContinueGithubDiscoveryFn: vi.fn(async () => true),
      promptForGithubOwnerFn: vi.fn(async () => "leanish"),
      renderConfigInitFn: renderConfigInit
    });

    expect(result).toBe(true);
    expect(initializeConfigFn).toHaveBeenCalledWith({ env: process.env });
    expect(runDiscoveryFn).toHaveBeenCalledWith({
      owner: "leanish",
      includeForks: true,
      includeArchived: false,
      addRepoNames: [],
      overrideRepoNames: []
    });
    expect(output.write).toHaveBeenCalledWith(
      "Initialized config at /tmp/atc-config.json\nManaged repos root: /workspace/repos\nRepos imported: 0\n"
    );
  });

  it("stops when zero-repo discovery is declined and continuation is not allowed", async () => {
    const output = { isTTY: true, write: vi.fn() };

    const result = await ensureInteractiveConfigSetup({
      env: process.env,
      input: { isTTY: true },
      output,
      loadConfigFn: vi.fn(async () => createLoadedConfig({ repos: [] })),
      initializeConfigFn: vi.fn(),
      getConfigPathFn: () => "/tmp/atc-config.json",
      runDiscoveryFn: vi.fn(),
      canPromptInteractivelyFn: () => true,
      promptToContinueGithubDiscoveryFn: vi.fn(async () => false)
    });

    expect(result).toBe(false);
    expect(output.write).toHaveBeenCalledWith(
      'GitHub discovery skipped. Add repos manually or run "atc config discover-github" when you are ready.\n'
    );
  });

  it("skips discovery when the GitHub owner prompt is cancelled", async () => {
    const output = { isTTY: true, write: vi.fn() };
    const runDiscoveryFn = vi.fn();

    const result = await ensureInteractiveConfigSetup({
      env: process.env,
      input: { isTTY: true },
      output,
      loadConfigFn: vi.fn(async () => createLoadedConfig({ repos: [] })),
      initializeConfigFn: vi.fn(),
      getConfigPathFn: () => "/tmp/atc-config.json",
      runDiscoveryFn,
      canPromptInteractivelyFn: () => true,
      promptToContinueGithubDiscoveryFn: vi.fn(async () => true),
      promptForGithubOwnerFn: vi.fn(async () => null)
    });

    expect(result).toBe(false);
    expect(runDiscoveryFn).not.toHaveBeenCalled();
    expect(output.write).toHaveBeenCalledWith(
      'GitHub discovery skipped. Add repos manually or run "atc config discover-github" when you are ready.\n'
    );
  });
});

function createReadline(answers: string[]): ReadlineLike {
  const queue = [...answers];

  return {
    question: vi.fn(async () => queue.shift() ?? ""),
    write: vi.fn(),
    close: vi.fn()
  };
}

function createPendingReadlineFactory() {
  const instances: PendingReadlineInstance[] = [];

  return {
    instances,
    createInterfaceFn: (() => {
      const instance: PendingReadlineInstance = {
        resolveQuestion: null,
        readline: {
          question: vi.fn((_: string) => new Promise<string>(resolve => {
            instance.resolveQuestion = resolve;
          })),
          write: vi.fn(),
          close: vi.fn()
        }
      };

      instances.push(instance);
      return instance.readline;
    }) satisfies CreateInterfaceFn
  };
}

function createRawKeypressInput({
  paused = true
}: {
  paused?: boolean;
} = {}): TestRawKeypressInput {
  const input = new EventEmitter() as TestRawKeypressInput;

  input.isTTY = true;
  input.isRaw = false;
  input._paused = paused;
  input.setRawMode = vi.fn(enabled => {
    input.isRaw = enabled;
  });
  input.isPaused = vi.fn(() => input._paused);
  input.resume = vi.fn(() => {
    input._paused = false;
  });
  input.pause = vi.fn(() => {
    input._paused = true;
  });

  return input;
}
