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
import { createSyncReportItem } from "./test-helpers.js";

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
  const resolvedSelection = {
    repos: selectedRepos,
    mode: "resolved",
    selection: null
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockResolvedValue(config);
    mocks.getCodexTimeoutMs.mockReturnValue(300_000);
    mocks.selectRepos.mockResolvedValue(resolvedSelection);
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
      selection: null,
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
      selection: null,
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
    mocks.selectRepos.mockResolvedValue({
      repos: [],
      mode: "resolved",
      selection: null
    });

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
    const selectReposFn = vi.fn().mockResolvedValue({
      repos: selectedRepos,
      mode: "resolved"
    });
    const syncReposFn = vi.fn(async (repos, callbacks) => {
      callbacks?.onRepoStart?.(repos[0], "update", "main");
      callbacks?.onRepoWait?.(repos[0], "main");
      callbacks?.onRepoResult?.(createSyncReportItem({
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "updated",
        detail: "main"
      }));

      return [createSyncReportItem({
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "updated",
        detail: "main"
      })];
    });
    const runCodexQuestionFn = vi.fn(async ({ onStatus }) => {
      onStatus("Synthesizing...");

      return {
        text: "Injected answer"
      };
    });
    const nowFn = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(6_000);

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
      runCodexQuestionFn,
      nowFn
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
      "Selecting repos...",
      "Resolved repos in 5s: sqs-codec",
      "Skip repo sync: no",
      "Updating sqs-codec (main)...",
      "Waiting for sqs-codec (main) sync already in progress...",
      "sqs-codec: updated (main)",
      "Synthesizing..."
    ]));
  });

  it("reports explicitly requested repos through the status reporter", async () => {
    const statusReporter = { info: vi.fn() };
    const nowFn = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0);

    mocks.selectRepos.mockResolvedValue({
      repos: selectedRepos,
      mode: "requested",
      selection: null
    });

    await answerQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      noSync: true,
      noSynthesis: true,
      repoNames: ["sqs-codec"]
    }, {
      env: process.env,
      statusReporter,
      loadConfigFn: mocks.loadConfig,
      selectReposFn: mocks.selectRepos,
      syncReposFn: mocks.syncRepos,
      existsSyncFn: mocks.existsSync,
      getCodexTimeoutMsFn: mocks.getCodexTimeoutMs,
      runCodexQuestionFn: mocks.runCodexQuestion,
      nowFn
    });

    expect(statusReporter.info.mock.calls.map(([message]) => message)).toEqual([
      "Selecting repos...",
      "Requested repos in 0s: sqs-codec",
      "Skip repo sync: yes"
    ]);
  });

  it("reports all repos when the final selection covers the whole config", async () => {
    const allReposConfig = {
      managedReposRoot: "/workspace/repos",
      repos: [
        {
          name: "sqs-codec",
          directory: "/workspace/repos/sqs-codec"
        },
        {
          name: "archa",
          directory: "/workspace/repos/archa"
        }
      ]
    };
    const statusReporter = { info: vi.fn() };
    const nowFn = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(2_500);

    mocks.loadConfig.mockResolvedValue(allReposConfig);
    mocks.selectRepos.mockResolvedValue({
      repos: allReposConfig.repos,
      mode: "all",
      selection: null
    });

    await answerQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      noSync: true,
      noSynthesis: true,
      repoNames: null
    }, {
      env: process.env,
      statusReporter,
      loadConfigFn: mocks.loadConfig,
      selectReposFn: mocks.selectRepos,
      syncReposFn: mocks.syncRepos,
      existsSyncFn: mocks.existsSync,
      getCodexTimeoutMsFn: mocks.getCodexTimeoutMs,
      runCodexQuestionFn: mocks.runCodexQuestion,
      nowFn
    });

    expect(statusReporter.info).toHaveBeenCalledWith("All repos in 2s: sqs-codec, archa");
    expect(statusReporter.info).toHaveBeenCalledWith("Skip repo sync: yes");
  });

  it("reports selection comparisons when background selector runs complete", async () => {
    const statusReporter = { info: vi.fn() };

    mocks.selectRepos.mockResolvedValue({
      repos: selectedRepos,
      mode: "resolved",
      selection: {
        mode: "single",
        shadowCompare: true,
        source: "codex",
        finalModel: "gpt-5.4",
        finalEffort: "low",
        finalRepoNames: ["sqs-codec"],
        runs: [
          {
            model: "gpt-5.4",
            effort: "low",
            repoNames: ["sqs-codec"],
            latencyMs: 9,
            confidence: 0.91,
            usage: {
              inputTokens: 1_250,
              cachedInputTokens: 320,
              outputTokens: 14
            },
            usedForFinal: true
          }
        ]
      },
      selectionPromise: Promise.resolve({
        mode: "single",
        shadowCompare: true,
        source: "codex",
        finalModel: "gpt-5.4",
        finalEffort: "low",
        finalRepoNames: ["sqs-codec"],
        runs: [
          {
            model: "gpt-5.4",
            effort: "low",
            repoNames: ["sqs-codec"],
            latencyMs: 9,
            confidence: 0.91,
            usage: {
              inputTokens: 1_250,
              cachedInputTokens: 320,
              outputTokens: 14
            },
            usedForFinal: true
          },
          {
            model: "gpt-5.4",
            effort: "none",
            repoNames: ["archa"],
            latencyMs: 5,
            confidence: 0.84,
            usage: {
              inputTokens: 980,
              cachedInputTokens: 120,
              outputTokens: 9
            },
            usedForFinal: false
          },
          {
            model: "gpt-5.4-mini",
            effort: "none",
            repoNames: ["search-kit"],
            latencyMs: 4,
            confidence: 0.79,
            usage: {
              inputTokens: 860,
              cachedInputTokens: 0,
              outputTokens: 11
            },
            usedForFinal: false
          }
        ]
      })
    });

    await answerQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      noSync: true,
      noSynthesis: true,
      repoNames: null
    }, {
      env: process.env,
      statusReporter,
      loadConfigFn: mocks.loadConfig,
      selectReposFn: mocks.selectRepos,
      syncReposFn: mocks.syncRepos,
      existsSyncFn: mocks.existsSync,
      getCodexTimeoutMsFn: mocks.getCodexTimeoutMs,
      runCodexQuestionFn: mocks.runCodexQuestion,
      nowFn: () => 0
    });

    expect(statusReporter.info).toHaveBeenCalledWith(
      [
        "Repo selection comparison:",
        "selector           conf  time  final  input  output  usd       repos",
        "gpt-5.4-mini/none  0.79  4ms   no     860    11      0.000695  search-kit",
        "gpt-5.4/none       0.84  5ms   no     980    9       0.002585  archa",
        "gpt-5.4/low        0.91  9ms   yes    1,250  14      0.003335  sqs-codec"
      ].join("\n")
    );
  });

  it("falls back to the immediate selection summary when background comparison does not finish in time", async () => {
    vi.useFakeTimers();
    const statusReporter = { info: vi.fn() };
    const immediateSelection = {
      mode: "single" as const,
      shadowCompare: true,
      source: "codex" as const,
      finalModel: "gpt-5.4" as const,
      finalEffort: "low" as const,
      finalRepoNames: ["sqs-codec"],
      runs: [
        {
          model: "gpt-5.4" as const,
          effort: "low" as const,
          repoNames: ["sqs-codec"],
          latencyMs: 5,
          confidence: 0.91,
          usedForFinal: true
        }
      ]
    };

    mocks.selectRepos.mockResolvedValue({
      repos: selectedRepos,
      mode: "resolved",
      selection: immediateSelection,
      selectionPromise: new Promise(() => {})
    });

    try {
      const resultPromise = answerQuestion({
        question: "How does x-codec-meta work?",
        model: "gpt-5.4",
        reasoningEffort: "low",
        noSync: true,
        noSynthesis: true,
        repoNames: null
      }, {
        env: process.env,
        statusReporter,
        loadConfigFn: mocks.loadConfig,
        selectReposFn: mocks.selectRepos,
        syncReposFn: mocks.syncRepos,
        existsSyncFn: mocks.existsSync,
        getCodexTimeoutMsFn: mocks.getCodexTimeoutMs,
        runCodexQuestionFn: mocks.runCodexQuestion,
        nowFn: () => 0
      });

      await vi.advanceTimersByTimeAsync(90_000);

      await expect(resultPromise).resolves.toMatchObject({
        selection: immediateSelection
      });
      expect(statusReporter.info).toHaveBeenCalledWith(
        "Repo selection comparison timed out; returning initial selection diagnostics."
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the legacy three-argument call shape when a status reporter is provided", async () => {
    const statusReporter = {
      info: vi.fn()
    };
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(0);

    try {
      await answerQuestion({
        question: "How does x-codec-meta work?",
        model: "gpt-5.4",
        reasoningEffort: "low",
        noSync: true,
        noSynthesis: true,
        repoNames: null
      }, {
        env: { ARCHA_CODEX_TIMEOUT_MS: "12345" },
        loadConfigFn: mocks.loadConfig,
        selectReposFn: mocks.selectRepos
      }, statusReporter);
    } finally {
      dateNowSpy.mockRestore();
    }

    expect(mocks.loadConfig).toHaveBeenCalledWith(process.env);
    expect(statusReporter.info).toHaveBeenCalledWith("Resolved repos in 0s: sqs-codec");
  });
});
