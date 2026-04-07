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

  it("ignores empty messages and tolerates a missing callback", () => {
    const callback = vi.fn();
    const reporter = createCallbackStatusReporter(callback);
    const noOpReporter = createCallbackStatusReporter();

    reporter.info("");
    noOpReporter.info("still fine");

    expect(callback).not.toHaveBeenCalled();
  });
});
