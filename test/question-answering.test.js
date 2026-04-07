import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  getCodexTimeoutMs: vi.fn(),
  loadConfig: vi.fn(),
  runCodexQuestion: vi.fn(),
  selectRepos: vi.fn(),
  syncRepos: vi.fn()
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: mocks.existsSync
  }
}));

vi.mock("../src/core/config/config.js", () => ({
  loadConfig: mocks.loadConfig
}));

vi.mock("../src/core/codex/codex-runner.js", () => ({
  getCodexTimeoutMs: mocks.getCodexTimeoutMs,
  runCodexQuestion: mocks.runCodexQuestion
}));

vi.mock("../src/core/repos/repo-selection.js", () => ({
  selectRepos: mocks.selectRepos
}));

vi.mock("../src/core/repos/repo-sync.js", () => ({
  syncRepos: mocks.syncRepos
}));

import { answerQuestion } from "../src/core/answer/question-answering.js";

describe("answerQuestion", () => {
  const config = {
    managedReposRoot: "/workspace/repos",
    repos: [
      {
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec"
      }
    ]
  };
  const selectedRepos = [
    {
      name: "sqs-codec",
      directory: "/workspace/repos/sqs-codec"
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockResolvedValue(config);
    mocks.getCodexTimeoutMs.mockReturnValue(300_000);
    mocks.selectRepos.mockReturnValue(selectedRepos);
    mocks.syncRepos.mockResolvedValue([
      {
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "updated",
        detail: "main"
      }
    ]);
    mocks.existsSync.mockReturnValue(true);
    mocks.runCodexQuestion.mockResolvedValue({
      text: "Final answer"
    });
  });

  it("runs codex after a successful sync", async () => {
    const statusReporter = { info: vi.fn() };

    const result = await answerQuestion({
      question: "How does x-codec-meta work?",
      audience: "codebase",
      model: "gpt-5.4",
      reasoningEffort: "low",
      noSync: false,
      noSynthesis: false,
      repoNames: null
    }, process.env, statusReporter);

    expect(result.mode).toBe("answer");
    expect(mocks.runCodexQuestion).toHaveBeenCalledWith({
      question: "How does x-codec-meta work?",
      audience: "codebase",
      model: "gpt-5.4",
      reasoningEffort: "low",
      selectedRepos,
      workspaceRoot: "/workspace/repos",
      timeoutMs: 300_000,
      onStatus: expect.any(Function)
    });
  });

  it("fails before codex when sync leaves a selected repo in failed state", async () => {
    mocks.syncRepos.mockResolvedValue([
      {
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "failed",
        detail: "git fetch failed"
      }
    ]);

    await expect(answerQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      noSync: false,
      noSynthesis: false,
      repoNames: null
    })).rejects.toThrow("Failed to sync managed repo(s): sqs-codec (git fetch failed)");

    expect(mocks.runCodexQuestion).not.toHaveBeenCalled();
  });

  it("skips sync and marks repos as skipped when requested", async () => {
    const result = await answerQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      noSync: true,
      noSynthesis: true,
      repoNames: null
    });

    expect(result).toEqual({
      mode: "retrieval-only",
      question: "How does x-codec-meta work?",
      selectedRepos,
      syncReport: [
        {
          name: "sqs-codec",
          directory: "/workspace/repos/sqs-codec",
          action: "skipped"
        }
      ]
    });
    expect(mocks.syncRepos).not.toHaveBeenCalled();
  });

  it("returns retrieval-only results even when sync reports failures", async () => {
    mocks.syncRepos.mockResolvedValue([
      {
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "failed",
        detail: "git fetch failed"
      }
    ]);

    const result = await answerQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      noSync: false,
      noSynthesis: true,
      repoNames: null
    });

    expect(result).toEqual({
      mode: "retrieval-only",
      question: "How does x-codec-meta work?",
      selectedRepos,
      syncReport: [
        {
          name: "sqs-codec",
          directory: "/workspace/repos/sqs-codec",
          action: "failed",
          detail: "git fetch failed"
        }
      ]
    });
    expect(mocks.runCodexQuestion).not.toHaveBeenCalled();
  });

  it("fails when no managed repositories are selected", async () => {
    mocks.selectRepos.mockReturnValue([]);

    await expect(answerQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      noSync: false,
      noSynthesis: false,
      repoNames: null
    })).rejects.toThrow(
      "No managed repositories matched the question. Use --repo <name> or update the Archa config."
    );
  });

  it("fails when repos are still unavailable locally after sync", async () => {
    mocks.existsSync.mockReturnValue(false);

    await expect(answerQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      noSync: false,
      noSynthesis: false,
      repoNames: null
    })).rejects.toThrow(
      "Managed repo(s) unavailable locally after sync: sqs-codec"
    );

    expect(mocks.runCodexQuestion).not.toHaveBeenCalled();
  });

  it("supports injected execution options and relays sync plus codex status messages", async () => {
    const statusReporter = {
      info: vi.fn()
    };
    const loadConfigFn = vi.fn().mockResolvedValue({
      managedReposRoot: "/workspace/repos",
      repos: [
        {
          name: "sqs-codec",
          directory: "/workspace/repos/sqs-codec"
        }
      ]
    });
    const selectReposFn = vi.fn().mockReturnValue(selectedRepos);
    const syncReposFn = vi.fn(async (repos, callbacks) => {
      callbacks.onRepoStart(repos[0], "update", "main");
      callbacks.onRepoWait(repos[0], "main");
      callbacks.onRepoResult({
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "updated",
        detail: "main"
      });

      return [
        {
          name: "sqs-codec",
          directory: "/workspace/repos/sqs-codec",
          action: "updated",
          detail: "main"
        }
      ];
    });
    const runCodexQuestionFn = vi.fn(async ({ onStatus }) => {
      onStatus("Synthesizing...");

      return {
        text: "Injected answer"
      };
    });

    const result = await answerQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      noSync: false,
      noSynthesis: false,
      repoNames: null
    }, {
      env: { ARCHA_CODEX_TIMEOUT_MS: "12345" },
      statusReporter,
      loadConfigFn,
      selectReposFn,
      syncReposFn,
      existsSyncFn: vi.fn(() => true),
      getCodexTimeoutMsFn: vi.fn(() => 12_345),
      runCodexQuestionFn
    });

    expect(result).toMatchObject({
      mode: "answer",
      synthesis: {
        text: "Injected answer"
      }
    });
    expect(loadConfigFn).toHaveBeenCalledWith({ ARCHA_CODEX_TIMEOUT_MS: "12345" });
    expect(selectReposFn).toHaveBeenCalled();
    expect(syncReposFn).toHaveBeenCalled();
    expect(runCodexQuestionFn).toHaveBeenCalledWith(expect.objectContaining({
      audience: "general",
      timeoutMs: 12_345
    }));
    expect(statusReporter.info.mock.calls.map(([message]) => message)).toEqual(expect.arrayContaining([
      "Selected repos: sqs-codec",
      "Updating sqs-codec (main)...",
      "Waiting for sqs-codec (main) sync already in progress...",
      "sqs-codec: updated (main)",
      "Synthesizing..."
    ]));
  });
});
