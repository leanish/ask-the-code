import { describe, expect, it, vi } from "vitest";

import { createGithubDiscoveryProgressReporter } from "../src/cli/setup/discovery-progress.js";

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
      type: "repo-hydrated",
      inspectRepos: false,
      processedCount: 1,
      totalCount: 2,
      repoName: "ask-the-code"
    });
    reporter.onProgress({
      type: "repo-hydrated",
      inspectRepos: false,
      processedCount: 2,
      totalCount: 2,
      repoName: "terminator"
    });
    reporter.finish();

    expect(output.write).toHaveBeenNthCalledWith(1, "Discovering GitHub repos for leanish...\n");
    expect(output.write).toHaveBeenNthCalledWith(2, "Found 3 repo(s); loading GitHub metadata for 2 eligible repo(s)...\n");
    expect(output.write).toHaveBeenNthCalledWith(3, "Loading repos: 1/2 (ask-the-code)\n");
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

    reporter.start("OtherCo");
    reporter.onProgress({
      type: "discovery-fetching",
      owner: "OtherCo"
    });
    reporter.onProgress({
      type: "discovery-page",
      page: 1,
      fetchedCount: 100,
      hasMorePages: true
    });
    reporter.onProgress({
      type: "discovery-page",
      page: 2,
      fetchedCount: 200,
      hasMorePages: true
    });
    reporter.onProgress({
      type: "discovery-page",
      page: 3,
      fetchedCount: 238,
      hasMorePages: false
    });
    reporter.onProgress({
      type: "discovery-listed",
      discoveredCount: 238,
      eligibleCount: 232,
      hydrateMetadata: false,
      inspectRepos: false
    });

    expect(output.write).toHaveBeenNthCalledWith(1, "Discovering GitHub repos for OtherCo...\n");
    expect(output.write).toHaveBeenNthCalledWith(2, "Fetching repos...\n");
    expect(output.write).toHaveBeenNthCalledWith(3, "Fetching repos... page 1 (100 fetched so far)\n");
    expect(output.write).toHaveBeenNthCalledWith(4, "Fetching repos... page 2 (200 fetched so far)\n");
    expect(output.write).toHaveBeenNthCalledWith(5, "238 repos fetched\n");
    expect(output.write).toHaveBeenNthCalledWith(6, "Found 238 repo(s); ready to choose from 232 eligible repo(s).\n");
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

    reporter.start("OtherCo");
    reporter.onProgress({
      type: "discovery-fetching",
      owner: "OtherCo"
    });
    reporter.onProgress({
      type: "discovery-page",
      page: 1,
      fetchedCount: 100,
      hasMorePages: true
    });
    reporter.onProgress({
      type: "discovery-page",
      page: 2,
      fetchedCount: 138,
      hasMorePages: false
    });
    reporter.onProgress({
      type: "discovery-listed",
      discoveredCount: 138,
      eligibleCount: 132,
      hydrateMetadata: false,
      inspectRepos: false
    });

    expect(output.write).toHaveBeenNthCalledWith(1, "Discovering GitHub repos for OtherCo...\n");
    expect(output.write).toHaveBeenNthCalledWith(2, "\rFetching repos...");
    expect(output.write).toHaveBeenNthCalledWith(3, "\rFetching repos... page 1 (100 fetched so far)");
    expect(output.write).toHaveBeenNthCalledWith(
      4,
      `\r${"138 repos fetched".padEnd("Fetching repos... page 1 (100 fetched so far)".length)}\n`
    );
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
      type: "repo-hydrated",
      inspectRepos: false,
      processedCount: 1,
      totalCount: 2,
      repoName: "ask-the-code"
    });
    reporter.finish();

    expect(output.write).toHaveBeenNthCalledWith(1, "Discovering GitHub repos for leanish...\n");
    expect(output.write).toHaveBeenNthCalledWith(2, "\rLoading repos: 1/2 (ask-the-code)");
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
      type: "repo-hydrated",
      inspectRepos: false,
      processedCount: 1,
      totalCount: 2,
      repoName: "java-conventions"
    });
    reporter.onProgress({
      type: "repo-hydrated",
      inspectRepos: false,
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
      type: "repo-hydrated",
      inspectRepos: true,
      processedCount: 1,
      totalCount: 1,
      repoName: "ask-the-code"
    });

    expect(output.write).toHaveBeenNthCalledWith(1, "Discovering GitHub repos for leanish...\n");
    expect(output.write).toHaveBeenNthCalledWith(2, "Found 1 repo(s); loading and curating metadata for 1 eligible repo(s)...\n");
    expect(output.write).toHaveBeenNthCalledWith(3, "Curating repos: 1/1 (ask-the-code)\n");
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

  it("uses a user-facing label for accessible discovery", () => {
    const output = {
      write: vi.fn(),
      isTTY: false
    };
    const reporter = createGithubDiscoveryProgressReporter({
      output,
      isInteractive: false
    });

    reporter.start("@accessible");
    reporter.onProgress({
      type: "discovery-listed",
      discoveredCount: 12,
      eligibleCount: 12,
      hydrateMetadata: false,
      inspectRepos: false
    });

    expect(output.write).toHaveBeenNthCalledWith(1, "Discovering accessible GitHub repos...\n");
    expect(output.write).toHaveBeenNthCalledWith(2, "Found 12 repo(s); ready to choose from 12 eligible repo(s).\n");
  });
});
