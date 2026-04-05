import process from "node:process";

export function createGithubDiscoveryProgressReporter({
  output = process.stderr,
  isInteractive = Boolean(output?.isTTY)
} = {}) {
  let hasActiveInlineProgress = false;

  return {
    start(owner) {
      output.write(`Discovering GitHub repos for ${owner}...\n`);
    },
    onProgress(event) {
      if (!event || typeof event !== "object") {
        return;
      }

      if (event.type === "discovery-listed") {
        output.write(
          `Found ${event.discoveredCount} repo(s); inspecting ${event.eligibleCount} eligible repo(s)...\n`
        );
        return;
      }

      if (event.type === "repo-processed") {
        const message = `Inspecting repos: ${event.processedCount}/${event.totalCount} (${event.repoName})`;
        if (isInteractive) {
          hasActiveInlineProgress = event.processedCount < event.totalCount;
          output.write(`\r${message}${event.processedCount === event.totalCount ? "\n" : ""}`);
          return;
        }

        output.write(`${message}\n`);
      }
    },
    finish() {
      if (!hasActiveInlineProgress) {
        return;
      }

      hasActiveInlineProgress = false;
      output.write("\n");
    }
  };
}
