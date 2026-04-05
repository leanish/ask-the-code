import { describe, expect, it, vi } from "vitest";

import {
  canPromptInteractively,
  ensureInteractiveConfigSetup,
  promptForGithubOwner,
  promptToContinueGithubDiscovery,
  promptToInitializeConfig,
  renderConfigInit
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

  it("initializes and continues into discovery when config is missing", async () => {
    const loadConfigFn = vi.fn()
      .mockRejectedValueOnce(new Error('Archa config not found at /tmp/archa-config.json. Run "archa config init" or set ARCHA_CONFIG_PATH.'))
      .mockResolvedValueOnce({ repos: [] })
      .mockResolvedValueOnce({ repos: [{ name: "archa" }] });
    const initializeConfigFn = vi.fn(async () => ({
      configPath: "/tmp/archa-config.json",
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
      getConfigPathFn: () => "/tmp/archa-config.json",
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
      apply: true,
      includeForks: true,
      includeArchived: false,
      addRepoNames: [],
      overrideRepoNames: []
    });
    expect(output.write).toHaveBeenCalledWith(
      "Initialized config at /tmp/archa-config.json\nManaged repos root: /workspace/repos\nRepos imported: 0\n"
    );
  });

  it("stops when zero-repo discovery is declined and continuation is not allowed", async () => {
    const output = { isTTY: true, write: vi.fn() };

    const result = await ensureInteractiveConfigSetup({
      env: process.env,
      input: { isTTY: true },
      output,
      loadConfigFn: vi.fn(async () => ({ repos: [] })),
      initializeConfigFn: vi.fn(),
      getConfigPathFn: () => "/tmp/archa-config.json",
      runDiscoveryFn: vi.fn(),
      canPromptInteractivelyFn: () => true,
      promptToContinueGithubDiscoveryFn: vi.fn(async () => false)
    });

    expect(result).toBe(false);
    expect(output.write).toHaveBeenCalledWith(
      'GitHub discovery skipped. Add repos manually or run "archa config discover-github --owner <github-user-or-org> --apply" when you are ready.\n'
    );
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
