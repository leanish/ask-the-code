import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  getCodexTimeoutMs: vi.fn(),
  loadConfig: vi.fn(),
  runCodexQuestion: vi.fn(),
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

vi.mock("../src/core/repos/repo-sync.js", () => ({
  syncRepos: mocks.syncRepos
}));

import { answerQuestion } from "../src/core/answer/question-answering.js";
import { createLoadedConfig, createManagedRepo, createSyncReportItem } from "./test-helpers.js";

describe("answerQuestion", () => {
  const config = createLoadedConfig({
    repos: [
      createManagedRepo({
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec"
      })
    ]
  });
  const selectedRepos = config.repos;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockResolvedValue(config);
    mocks.getCodexTimeoutMs.mockReturnValue(300_000);
    mocks.syncRepos.mockResolvedValue([
      createSyncReportItem({
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "updated",
        detail: "main"
      })
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
      repoCatalogPath: "/workspace/repos/config.json",
      timeoutMs: 300_000,
      onStatus: expect.any(Function)
    });
  });

  it("fails before codex when sync leaves a selected repo in failed state", async () => {
    mocks.syncRepos.mockResolvedValue([
      createSyncReportItem({
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "failed",
        detail: "git fetch failed"
      })
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
      createSyncReportItem({
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        action: "failed",
        detail: "git fetch failed"
      })
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

  it("fails when no managed repos are configured", async () => {
    mocks.loadConfig.mockResolvedValue(createLoadedConfig({
      repos: []
    }));

    await expect(answerQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      noSync: false,
      noSynthesis: false,
      repoNames: null
    })).rejects.toThrow(
      'No managed repos are configured. Run "archa config discover-github" or add repos to the repo catalog.'
    );
  });

  it("fails when an explicitly requested repo is unknown", async () => {
    await expect(answerQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      noSync: false,
      noSynthesis: false,
      repoNames: ["missing-repo"]
    })).rejects.toThrow("Unknown managed repo(s): missing-repo");
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
    const loadConfigFn = vi.fn().mockResolvedValue(createLoadedConfig({
      repos: [
        createManagedRepo({
          name: "sqs-codec",
          directory: "/workspace/repos/sqs-codec"
        })
      ]
    }));
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
    expect(syncReposFn).toHaveBeenCalled();
    expect(runCodexQuestionFn).toHaveBeenCalledWith(expect.objectContaining({
      audience: "general",
      timeoutMs: 12_345
    }));
    expect(statusReporter.info.mock.calls.map(([message]) => message)).toEqual(expect.arrayContaining([
      "Skip repo sync: no",
      "Updating sqs-codec (main)...",
      "Waiting for sqs-codec (main) sync already in progress...",
      "sqs-codec: updated (main)",
      "Synthesizing..."
    ]));
  });

  it("reports explicitly requested repos through the status reporter", async () => {
    const statusReporter = { info: vi.fn() };
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
      syncReposFn: mocks.syncRepos,
      existsSyncFn: mocks.existsSync,
      getCodexTimeoutMsFn: mocks.getCodexTimeoutMs,
      runCodexQuestionFn: mocks.runCodexQuestion
    });

    expect(statusReporter.info.mock.calls.map(([message]) => message)).toEqual([
      "Requested repos: sqs-codec -> sqs-codec",
      "Skip repo sync: yes"
    ]);
  });

  it("reports all repos when the implicit scope covers the whole config", async () => {
    const allReposConfig = createLoadedConfig({
      repos: [
        createManagedRepo({
          name: "sqs-codec",
          directory: "/workspace/repos/sqs-codec"
        }),
        createManagedRepo({
          name: "archa",
          directory: "/workspace/repos/archa"
        })
      ]
    });
    const statusReporter = { info: vi.fn() };

    mocks.loadConfig.mockResolvedValue(allReposConfig);

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
      syncReposFn: mocks.syncRepos,
      existsSyncFn: mocks.existsSync,
      getCodexTimeoutMsFn: mocks.getCodexTimeoutMs,
      runCodexQuestionFn: mocks.runCodexQuestion
    });

    expect(statusReporter.info).not.toHaveBeenCalledWith(expect.stringContaining("All repos"));
    expect(statusReporter.info).toHaveBeenCalledWith("Skip repo sync: yes");
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
        loadConfigFn: mocks.loadConfig
      }, statusReporter);
    } finally {
      dateNowSpy.mockRestore();
    }

    expect(mocks.loadConfig).toHaveBeenCalledWith(process.env);
    expect(statusReporter.info).not.toHaveBeenCalledWith(expect.stringContaining("repos"));
    expect(statusReporter.info).toHaveBeenCalledWith("Skip repo sync: yes");
  });
});
