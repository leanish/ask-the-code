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
      eligibleCount: 2,
      hydrateMetadata: true,
      inspectRepos: false
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
    expect(output.write).toHaveBeenNthCalledWith(2, "Found 3 repo(s); loading GitHub metadata for 2 eligible repo(s)...\n");
    expect(output.write).toHaveBeenNthCalledWith(3, "Loading repos: 1/2 (archa)\n");
    expect(output.write).toHaveBeenNthCalledWith(4, "Loading repos: 2/2 (terminator)\n");
  });

  it("shows paginated listing progress before the discovery summary", () => {
    const output = {
      write: vi.fn(),
      isTTY: false
    };
    const reporter = createGithubDiscoveryProgressReporter({
      output,
      isInteractive: false
    });

    reporter.start("Nosto");
    reporter.onProgress({
      type: "discovery-fetching"
    });
    reporter.onProgress({
      type: "discovery-page",
      nextPage: 2,
      fetchedCount: 100
    });
    reporter.onProgress({
      type: "discovery-page",
      nextPage: 3,
      fetchedCount: 200
    });
    reporter.onProgress({
      type: "discovery-listed",
      discoveredCount: 238,
      eligibleCount: 232,
      hydrateMetadata: false,
      inspectRepos: false
    });

    expect(output.write).toHaveBeenNthCalledWith(1, "Discovering GitHub repos for Nosto...\n");
    expect(output.write).toHaveBeenNthCalledWith(2, "Fetching repos...\n");
    expect(output.write).toHaveBeenNthCalledWith(3, "Fetching repos, page 2...\n");
    expect(output.write).toHaveBeenNthCalledWith(4, "Fetching repos, page 3...\n");
    expect(output.write).toHaveBeenNthCalledWith(5, "Found 238 repo(s); ready to choose from 232 eligible repo(s).\n");
  });

  it("closes inline listing progress before writing the discovery summary", () => {
    const output = {
      write: vi.fn(),
      isTTY: true
    };
    const reporter = createGithubDiscoveryProgressReporter({
      output,
      isInteractive: true
    });

    reporter.start("Nosto");
    reporter.onProgress({
      type: "discovery-fetching"
    });
    reporter.onProgress({
      type: "discovery-page",
      nextPage: 2,
      fetchedCount: 100
    });
    reporter.onProgress({
      type: "discovery-listed",
      discoveredCount: 138,
      eligibleCount: 132,
      hydrateMetadata: false,
      inspectRepos: false
    });

    expect(output.write).toHaveBeenNthCalledWith(1, "Discovering GitHub repos for Nosto...\n");
    expect(output.write).toHaveBeenNthCalledWith(2, "\rFetching repos...");
    expect(output.write).toHaveBeenNthCalledWith(3, "\rFetching repos, page 2...");
    expect(output.write).toHaveBeenNthCalledWith(4, "\n");
    expect(output.write).toHaveBeenNthCalledWith(5, "Found 138 repo(s); ready to choose from 132 eligible repo(s).\n");
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
    expect(output.write).toHaveBeenNthCalledWith(2, "\rLoading repos: 1/2 (archa)");
    expect(output.write).toHaveBeenNthCalledWith(3, "\n");
  });

  it("clears leftover characters when a shorter repo name overwrites a longer one", () => {
    const output = {
      write: vi.fn(),
      isTTY: true
    };
    const reporter = createGithubDiscoveryProgressReporter({
      output,
      isInteractive: true
    });
    const firstMessage = "Loading repos: 1/2 (java-conventions)";
    const finalMessage = "Loading repos: 2/2 (terminator)";

    reporter.onProgress({
      type: "repo-processed",
      processedCount: 1,
      totalCount: 2,
      repoName: "java-conventions"
    });
    reporter.onProgress({
      type: "repo-processed",
      processedCount: 2,
      totalCount: 2,
      repoName: "terminator"
    });

    expect(output.write).toHaveBeenNthCalledWith(1, `\r${firstMessage}`);
    expect(output.write).toHaveBeenNthCalledWith(2, `\r${finalMessage.padEnd(firstMessage.length)}\n`);
  });

  it("shows curated discovery progress when repo inspection is enabled", () => {
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
      discoveredCount: 1,
      eligibleCount: 1,
      hydrateMetadata: true,
      inspectRepos: true
    });
    reporter.onProgress({
      type: "repo-curated",
      processedCount: 1,
      totalCount: 1,
      repoName: "archa"
    });
    reporter.onProgress({
      type: "repo-applied",
      processedCount: 1,
      totalCount: 1,
      repoName: "archa"
    });

    expect(output.write).toHaveBeenNthCalledWith(1, "Discovering GitHub repos for leanish...\n");
    expect(output.write).toHaveBeenNthCalledWith(2, "Found 1 repo(s); loading and curating metadata for 1 eligible repo(s)...\n");
    expect(output.write).toHaveBeenNthCalledWith(3, "Curating repos: 1/1 (archa)\n");
    expect(output.write).toHaveBeenNthCalledWith(4, "Saving repos: 1/1 (archa)\n");
  });

  it("shows immediate selection readiness when metadata hydration is skipped", () => {
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
      discoveredCount: 8,
      eligibleCount: 8,
      hydrateMetadata: false,
      inspectRepos: false
    });

    expect(output.write).toHaveBeenNthCalledWith(1, "Discovering GitHub repos for leanish...\n");
    expect(output.write).toHaveBeenNthCalledWith(2, "Found 8 repo(s); ready to choose from 8 eligible repo(s).\n");
  });
});
