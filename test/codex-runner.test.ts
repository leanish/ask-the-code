import { beforeEach, describe, expect, it, vi } from "vitest";

type ChildResult = number | Error;
type StderrHandler = (chunk: Buffer) => void;
type CloseHandler = (code: number | null) => void;
type ErrorHandler = (error: Error) => void;
type ChildProcessDouble = {
  stdin: {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  kill: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
  stderr: {
    destroy: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
  close(code: number): void;
};

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  rm: vi.fn(),
  spawn: vi.fn(),
  tmpdir: vi.fn(() => "/tmp"),
  randomUUID: vi.fn(() => "uuid-fixed")
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mocks.readFile,
    rm: mocks.rm
  }
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn
}));

vi.mock("node:os", () => ({
  default: {
    tmpdir: mocks.tmpdir
  }
}));

vi.mock("node:crypto", () => ({
  randomUUID: mocks.randomUUID
}));

import {
  getCodexExecutionContext,
  getCodexTimeoutMs,
  runCodexPrompt,
  runCodexQuestion,
  summarizeCodexTimeoutStderr,
  summarizeCodexStderr
} from "../src/core/codex/codex-runner.js";

describe("codex-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.rm.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue("Final answer");
    mocks.randomUUID.mockReturnValue("uuid-fixed");
  });

  it("uses the selected repo as the working directory when only one repo is selected", () => {
    const question = [
      "For sqs-codec receive-side decoding:",
      "",
      "How does x-codec-meta tell the interceptor whether to decompress and validate a message?"
    ].join("\n");
    const context = getCodexExecutionContext({
      question,
      audience: "general",
      workspaceRoot: "/workspace/archa/repos",
      selectedRepos: [
        {
          name: "sqs-codec",
          description: "SQS execution interceptor with compression and checksum metadata",
          directory: "/workspace/archa/repos/sqs-codec",
          defaultBranch: "main"
        }
      ]
    });

    expect(context.workingDirectory).toBe("/workspace/archa/repos/sqs-codec");
    expect(context.prompt).toContain("Answer using the code in the current workspace.");
    expect(context.prompt).toContain("Write for a non-engineering reader. Keep the answer self-contained and do not assume the reader can inspect this workspace.");
    expect(context.prompt).toContain("Assume no knowledge or access to source code or implementation details.");
    expect(context.prompt).toContain("Explain the behavior in plain language, not as a code walkthrough.");
    expect(context.prompt).toContain("Avoid unnecessary references to files, symbols, and other analyzed-workspace code details unless they are needed for accuracy or explicitly requested.");
    expect(context.prompt).toContain("Service-interaction code, API payloads, and integration examples are allowed when they help explain usage or behavior.");
    expect(context.prompt).toContain("Translate implementation details into user-facing behavior and outcomes instead of citing analyzed-workspace source identifiers.");
    expect(context.prompt).toContain("Use code snippets only when they help explain integration or behavior.");
    expect(context.prompt).toContain("These repos are in scope for answering the question: sqs-codec.");
    expect(context.prompt).toContain("Before finalizing, remove unnecessary references to analyzed-workspace code.");
    expect(context.prompt).toContain("Answer the question directly and stop. Do not offer follow-up help or ask whether you should rewrite the answer.");
    expect(context.prompt).toContain('I got the question:\n"""\n');
    expect(context.prompt).toContain(question);
  });

  it("uses the workspace root when multiple repos are selected", () => {
    const context = getCodexExecutionContext({
      question: "How do sqs-codec and java-conventions relate?",
      audience: "codebase",
      workspaceRoot: "/workspace/archa/repos",
      selectedRepos: [
        {
          name: "sqs-codec",
          description: "SQS execution interceptor with compression and checksum metadata",
          directory: "/workspace/archa/repos/sqs-codec",
          defaultBranch: "main"
        },
        {
          name: "java-conventions",
          description: "Shared Gradle conventions for JDK-based projects",
          directory: "/workspace/archa/repos/java-conventions",
          defaultBranch: "main"
        }
      ]
    });

    expect(context.workingDirectory).toBe("/workspace/archa/repos");
    expect(context.prompt).toContain("Write for an engineer who can inspect this workspace. Be concrete about the implementation and mention relevant files, symbols, and execution flow when useful.");
    expect(context.prompt).toContain("Use code snippets when they help explain behavior or where to make changes.");
    expect(context.prompt).toContain("These repos are in scope for answering the question: sqs-codec, java-conventions.");
  });

  it("runs codex and returns the final answer text", async () => {
    const child = createChildProcess({ code: 0 });
    const onStatus = vi.fn();
    mocks.spawn.mockReturnValue(child);
    mocks.readFile.mockResolvedValue("  Final answer from Codex  ");

    const result = await runCodexQuestion({
      question: "How does x-codec-meta work?",
      audience: "codebase",
      model: "gpt-5.4",
      reasoningEffort: "low",
      selectedRepos: [
        {
          name: "sqs-codec",
          directory: "/workspace/archa/repos/sqs-codec",
          defaultBranch: "master"
        }
      ],
      workspaceRoot: "/workspace/archa/repos",
      onStatus
    });

    expect(result).toEqual({ text: "Final answer from Codex" });
    expect(onStatus).toHaveBeenCalledWith("Running Codex");
    expect(child.stdin.write).toHaveBeenCalledWith(expect.stringContaining(
      "Write for an engineer who can inspect this workspace."
    ));
    expect(child.stdin.write).toHaveBeenCalledWith(expect.stringContaining('I got the question:\n"""\nHow does x-codec-meta work?\n"""'));
    expect(child.stdin.end).toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "-c",
        'model_reasoning_effort="low"',
        "exec",
        "-C",
        "/workspace/archa/repos/sqs-codec",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--color",
        "never",
        "--output-last-message"
      ]),
      { stdio: ["pipe", "ignore", "pipe"] }
    );
    expect(mocks.readFile).toHaveBeenCalledWith(expect.stringContaining("/tmp/archa-codex-"), "utf8");
    expect(mocks.rm).toHaveBeenCalledWith(expect.stringContaining("/tmp/archa-codex-"), { force: true });
  });

  it("runs a generic Codex prompt in the provided working directory", async () => {
    const child = createChildProcess({ code: 0 });
    mocks.spawn.mockReturnValue(child);
    mocks.readFile.mockResolvedValue("  {\"topics\":[\"java\"]}  ");

    const result = await runCodexPrompt({
      prompt: "Return JSON only.",
      workingDirectory: "/workspace/archa/repos/java-conventions"
    });

    expect(result).toEqual({ text: "{\"topics\":[\"java\"]}" });
    expect(child.stdin.write).toHaveBeenCalledWith("Return JSON only.");
    expect(mocks.spawn).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "-C",
        "/workspace/archa/repos/java-conventions",
        "--model",
        "gpt-5.4-mini"
      ]),
      { stdio: ["pipe", "ignore", "pipe"] }
    );
  });

  it("adds a unique uuid suffix to the codex output file path", async () => {
    const child = createChildProcess({ code: 0 });
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1_234_567_890);
    mocks.spawn.mockReturnValue(child);
    mocks.readFile.mockResolvedValue("result");
    mocks.randomUUID.mockReturnValue("uuid-123");

    await runCodexPrompt({
      prompt: "Return JSON only.",
      workingDirectory: "/workspace/archa/repos/java-conventions"
    });

    const expectedPath = `/tmp/archa-codex-${process.pid}-1234567890-uuid-123.txt`;
    expect(mocks.readFile).toHaveBeenCalledWith(expectedPath, "utf8");
    expect(mocks.rm).toHaveBeenCalledWith(expectedPath, { force: true });

    dateNowSpy.mockRestore();
  });

  it("uses default codex settings when model and reasoning effort are omitted", async () => {
    mocks.spawn.mockReturnValue(createChildProcess({ code: 0 }));
    mocks.readFile.mockResolvedValue("   ");
    const onStatus = vi.fn();

    const result = await runCodexQuestion({
      question: "How does x-codec-meta work?",
      model: null,
      reasoningEffort: null,
      selectedRepos: [
        {
          name: "sqs-codec",
          directory: "/workspace/archa/repos/sqs-codec",
          defaultBranch: "master"
        }
      ],
      workspaceRoot: "/workspace/archa/repos",
      onStatus
    });

    expect(result).toEqual({ text: "Codex did not produce a final answer." });
    expect(onStatus).toHaveBeenCalledWith("Running Codex");
    expect(mocks.spawn).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "-c",
        'model_reasoning_effort="low"',
        "--model",
        "gpt-5.4-mini"
      ]),
      { stdio: ["pipe", "ignore", "pipe"] }
    );
  });

  it("waits 5 seconds before emitting elapsed codex progress updates", async () => {
    vi.useFakeTimers();
    const child = createChildProcess({ autoCloseOnEnd: false });
    const onStatus = vi.fn();
    mocks.spawn.mockReturnValue(child);

    const resultPromise = runCodexQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      selectedRepos: [
        {
          name: "sqs-codec",
          directory: "/workspace/archa/repos/sqs-codec",
          defaultBranch: "master"
        }
      ],
      workspaceRoot: "/workspace/archa/repos",
      onStatus
    });

    onStatus.mockClear();

    await vi.advanceTimersByTimeAsync(4_000);
    expect(onStatus).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onStatus).toHaveBeenCalledWith("Running Codex... (5s elapsed)");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(onStatus).toHaveBeenCalledWith("Running Codex... (10s elapsed)");

    await vi.advanceTimersByTimeAsync(55_000);
    expect(onStatus).toHaveBeenCalledWith("Running Codex... (1m 5s elapsed)");

    child.close(0);

    await expect(resultPromise).resolves.toEqual({ text: "Final answer" });
  });

  it("times out codex after the configured deadline", async () => {
    vi.useFakeTimers();
    const child = createChildProcess({ autoCloseOnEnd: false });
    const onStatus = vi.fn();
    mocks.spawn.mockReturnValue(child);

    const resultPromise = runCodexQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      selectedRepos: [
        {
          name: "sqs-codec",
          directory: "/workspace/archa/repos/sqs-codec",
          defaultBranch: "master"
        }
      ],
      workspaceRoot: "/workspace/archa/repos",
      onStatus,
      timeoutMs: 300_000
    });

    const rejection = expect(resultPromise).rejects.toThrow("codex exec timed out after 5m");

    await vi.advanceTimersByTimeAsync(300_000);
    await rejection;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.stdin.destroy).toHaveBeenCalled();
    expect(child.stderr.destroy).toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith("Codex timed out after 5m; stopping...");
    expect(mocks.rm).toHaveBeenCalledWith(expect.stringContaining("/tmp/archa-codex-"), { force: true });
    expect(mocks.readFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("summarizes codex stderr to the last meaningful lines", () => {
    const stderr = [
      "",
      "first",
      "second",
      "third",
      "fourth",
      "fifth",
      "sixth",
      "seventh",
      "eighth",
      "ninth"
    ].join("\n");

    expect(summarizeCodexStderr(stderr)).toBe([
      "second",
      "third",
      "fourth",
      "fifth",
      "sixth",
      "seventh",
      "eighth",
      "ninth"
    ].join("\n"));
  });

  it("returns an empty codex stderr summary when stderr is blank", () => {
    expect(summarizeCodexStderr("\n  \n")).toBe("");
  });

  it("filters timeout stderr down to relevant warning and error lines", () => {
    const stderr = [
      "public interface CompressionAlgorithm {",
      "NONE, GZIP, ZSTD",
      "2026-04-02T20:54:27.662393Z ERROR codex_api::endpoint::responses_websocket: failed to connect",
      "ERROR: Reconnecting... 4/5",
      "\"\"\"",
      "I have the feeling the checksum metadata is missing",
      "Caused by:",
      "Operation not permitted (os error 1)"
    ].join("\n");

    expect(summarizeCodexTimeoutStderr(stderr)).toBe([
      "2026-04-02T20:54:27.662393Z ERROR codex_api::endpoint::responses_websocket: failed to connect",
      "ERROR: Reconnecting... 4/5",
      "Caused by:",
      "Operation not permitted (os error 1)"
    ].join("\n"));
  });

  it("omits timeout stderr when nothing looks like a real warning or error", async () => {
    vi.useFakeTimers();
    const child = createChildProcess({
      autoCloseOnEnd: false,
      stderrChunks: [
        "public interface CompressionAlgorithm {\n",
        "\"\"\"\n",
        "I have the feeling the checksum metadata is missing\n"
      ]
    });
    mocks.spawn.mockReturnValue(child);

    const resultPromise = runCodexQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      selectedRepos: [
        {
          name: "sqs-codec",
          directory: "/workspace/archa/repos/sqs-codec",
          defaultBranch: "master"
        }
      ],
      workspaceRoot: "/workspace/archa/repos",
      timeoutMs: 5_000
    });

    const rejection = expect(resultPromise).rejects.toThrow(/^codex exec timed out after 5s$/);
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
  });

  it("returns the default codex timeout when no override is configured", () => {
    expect(getCodexTimeoutMs({})).toBe(300_000);
  });

  it("parses a custom codex timeout from the environment", () => {
    expect(getCodexTimeoutMs({
      ARCHA_CODEX_TIMEOUT_MS: "45000"
    })).toBe(45_000);
  });

  it("rejects invalid codex timeout overrides", () => {
    expect(() => getCodexTimeoutMs({
      ARCHA_CODEX_TIMEOUT_MS: "wat"
    })).toThrow("Invalid ARCHA_CODEX_TIMEOUT_MS: wat. Use a positive integer.");
  });

  it("rejects malformed codex timeout overrides instead of truncating them", () => {
    expect(() => getCodexTimeoutMs({
      ARCHA_CODEX_TIMEOUT_MS: "300s"
    })).toThrow("Invalid ARCHA_CODEX_TIMEOUT_MS: 300s. Use a positive integer.");
  });

  it("surfaces a summarized codex error and still cleans up the output file", async () => {
    mocks.spawn.mockReturnValue(createChildProcess({
      code: 2,
      stderrChunks: ["one\n", "two\n", "three\n", "four\n", "five\n", "six\n", "seven\n", "eight\n", "nine\n"]
    }));

    await expect(runCodexQuestion({
      question: "How does x-codec-meta work?",
      model: "gpt-5.4",
      reasoningEffort: "low",
      selectedRepos: [
        {
          name: "sqs-codec",
          directory: "/workspace/archa/repos/sqs-codec",
          defaultBranch: "master"
        }
      ],
      workspaceRoot: "/workspace/archa/repos"
    })).rejects.toThrow("codex exec failed with exit code 2: two\nthree\nfour\nfive\nsix\nseven\neight\nnine");

    expect(mocks.rm).toHaveBeenCalledWith(expect.stringContaining("/tmp/archa-codex-"), { force: true });
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("surfaces a friendly install hint when codex is missing", async () => {
    mocks.spawn.mockReturnValue(createChildProcess({
      code: Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })
    }));

    await expect(runCodexPrompt({
      prompt: "Return JSON only.",
      workingDirectory: "/workspace/archa/repos"
    })).rejects.toThrow(
      'Codex CLI is required but was not found on PATH. Install it with "brew install codex". If Codex is still not connected afterwards, complete the Codex connection/login flow and retry later.'
    );
  });
});

function createChildProcess({
  code = 0,
  stderrChunks = [],
  autoCloseOnEnd = true
}: {
  code?: ChildResult;
  stderrChunks?: string[];
  autoCloseOnEnd?: boolean;
}): ChildProcessDouble {
  const stderrHandlers: StderrHandler[] = [];
  const closeHandlers: CloseHandler[] = [];
  const errorHandlers: ErrorHandler[] = [];

  const child: ChildProcessDouble = {
    stdin: {
      write: vi.fn(),
      end: vi.fn(() => {
        if (!autoCloseOnEnd) {
          return;
        }
        emitResult(code);
      }),
      destroy: vi.fn()
    },
    kill: vi.fn(),
    unref: vi.fn(),
    stderr: {
      destroy: vi.fn(),
      on: vi.fn((event: "data", handler: StderrHandler) => {
        if (event === "data") {
          stderrHandlers.push(handler);
        }
      })
    },
    on: vi.fn((event: "close" | "error", handler: CloseHandler | ErrorHandler) => {
      if (event === "close") {
        closeHandlers.push(handler as CloseHandler);
      }
      if (event === "error") {
        errorHandlers.push(handler as ErrorHandler);
      }
    }),
    close(closeCode: number) {
      emitResult(closeCode);
    }
  };

  return child;

  function emitResult(resultCode: ChildResult): void {
    queueMicrotask(() => {
      stderrChunks.forEach(chunk => {
        stderrHandlers.forEach(handler => handler(Buffer.from(chunk)));
      });

      if (resultCode instanceof Error) {
        errorHandlers.forEach(handler => handler(resultCode));
        return;
      }

      closeHandlers.forEach(handler => handler(resultCode));
    });
  }
}
