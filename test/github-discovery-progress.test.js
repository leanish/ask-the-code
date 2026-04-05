import { describe, expect, it, vi } from "vitest";

import { createGithubDiscoveryProgressReporter } from "../src/github-discovery-progress.js";

describe("github-discovery-progress", () => {
  it("prints line-based progress updates for non-interactive output", () => {
    const output = {
      write: vi.fn(),
      isTTY: false
    };
    const reporter = createGithubDiscoveryProgressReporter({
      output,
      isInteractive: false
    });

    reporter.start("leanish");
    reporter.onProgress({
      type: "discovery-listed",
      discoveredCount: 3,
      eligibleCount: 2
    });
    reporter.onProgress({
      type: "repo-processed",
      processedCount: 1,
      totalCount: 2,
      repoName: "archa"
    });
    reporter.onProgress({
      type: "repo-processed",
      processedCount: 2,
      totalCount: 2,
      repoName: "terminator"
    });
    reporter.finish();

    expect(output.write).toHaveBeenNthCalledWith(1, "Discovering GitHub repos for leanish...\n");
    expect(output.write).toHaveBeenNthCalledWith(2, "Found 3 repo(s); inspecting 2 eligible repo(s)...\n");
    expect(output.write).toHaveBeenNthCalledWith(3, "Inspecting repos: 1/2 (archa)\n");
    expect(output.write).toHaveBeenNthCalledWith(4, "Inspecting repos: 2/2 (terminator)\n");
  });

  it("uses inline progress updates for interactive output and finishes with a newline", () => {
    const output = {
      write: vi.fn(),
      isTTY: true
    };
    const reporter = createGithubDiscoveryProgressReporter({
      output,
      isInteractive: true
    });

    reporter.start("leanish");
    reporter.onProgress({
      type: "repo-processed",
      processedCount: 1,
      totalCount: 2,
      repoName: "archa"
    });
    reporter.finish();

    expect(output.write).toHaveBeenNthCalledWith(1, "Discovering GitHub repos for leanish...\n");
    expect(output.write).toHaveBeenNthCalledWith(2, "\rInspecting repos: 1/2 (archa)");
    expect(output.write).toHaveBeenNthCalledWith(3, "\n");
  });
});
