import { describe, expect, it, vi } from "vitest";

import { createCallbackStatusReporter, createStreamStatusReporter } from "../src/core/status/status-reporter.js";

describe("status-reporter", () => {
  it("writes prefixed messages to a stream reporter", () => {
    const stream = {
      write: vi.fn()
    };
    const reporter = createStreamStatusReporter(stream, "[test] ");

    reporter.info("hello");

    expect(stream.write).toHaveBeenCalledWith("[test] hello\n");
  });

  it("rewrites codex progress in place on interactive streams", () => {
    const stream = {
      isTTY: true,
      write: vi.fn()
    };
    const reporter = createStreamStatusReporter(stream, "[test] ");

    reporter.info("Running Codex");
    reporter.info("Running Codex... (5s elapsed)");
    reporter.info("Job completed.");

    expect(stream.write.mock.calls).toEqual([
      ["[test] Running Codex"],
      ["\r\x1b[2K[test] Running Codex... (5s elapsed)"],
      ["\n"],
      ["[test] Job completed.\n"]
    ]);
  });

  it("flushes an interactive codex progress line", () => {
    const stream = {
      isTTY: true,
      write: vi.fn()
    };
    const reporter = createStreamStatusReporter(stream, "[test] ");

    reporter.info("Running Codex");
    reporter.flush();

    expect(stream.write.mock.calls).toEqual([
      ["[test] Running Codex"],
      ["\n"]
    ]);
  });

  it("ignores empty messages and tolerates a missing callback", () => {
    const callback = vi.fn();
    const reporter = createCallbackStatusReporter(callback);
    const noOpReporter = createCallbackStatusReporter();

    reporter.info("");
    noOpReporter.info("still fine");

    expect(callback).not.toHaveBeenCalled();
  });
});
