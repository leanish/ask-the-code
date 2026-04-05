import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectRepoClassifications, inspectRepoMetadata } from "../src/repo-classification-inspector.js";

describe("repo-classification-inspector", () => {
  let tempRoot;
  let env;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "archa-inspect-"));
    env = {
      XDG_DATA_HOME: path.join(tempRoot, "data")
    };
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("detects external repos from local frontend signals", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "shop-app");
    await fs.mkdir(path.join(repoDirectory, "app"), { recursive: true });
    await fs.writeFile(path.join(repoDirectory, "package.json"), JSON.stringify({
      dependencies: {
        react: "^19.0.0",
        next: "^15.0.0"
      }
    }));
    await fs.writeFile(path.join(repoDirectory, "README.md"), "Checkout onboarding flow for shoppers.");

    const classifications = await inspectRepoClassifications({
      repo: {
        name: "shop-app",
        url: "https://github.com/leanish/shop-app.git",
        defaultBranch: "main",
        description: "Storefront web app",
        topics: []
      },
      sourceRepo: {
        private: false
      },
      env
    });

    expect(classifications).toEqual(["frontend", "external"]);
  });

  it("detects infra and internal repos from local source signals", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "platform-infra");
    await fs.mkdir(path.join(repoDirectory, "terraform"), { recursive: true });
    await fs.writeFile(path.join(repoDirectory, "README.md"), "Internal platform infrastructure modules.");

    const classifications = await inspectRepoClassifications({
      repo: {
        name: "platform-infra",
        url: "https://github.com/leanish/platform-infra.git",
        defaultBranch: "main",
        description: "Platform infra",
        topics: []
      },
      sourceRepo: {},
      env
    });

    expect(classifications).toEqual(["infra", "internal"]);
  });

  it("infers description and topics from the repo readme when metadata is missing", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "terminator");
    await fs.mkdir(repoDirectory, { recursive: true });
    await fs.writeFile(path.join(repoDirectory, "README.md"), [
      "# Terminator",
      "",
      "Terminator is a small Java library that coordinates the orderly shutdown of heterogeneous services.",
      "",
      "## Key features",
      "",
      "- Blocking and non-blocking termination",
      "- Timeout-aware awaitTermination support"
    ].join("\n"));
    await fs.writeFile(path.join(repoDirectory, "build.gradle"), "plugins { id 'java-library' }\n");

    const metadata = await inspectRepoMetadata({
      repo: {
        name: "terminator",
        url: "https://github.com/leanish/terminator.git",
        defaultBranch: "main",
        description: "",
        topics: []
      },
      env
    });

    expect(metadata).toEqual({
      description: "Terminator is a small Java library that coordinates the orderly shutdown of heterogeneous services.",
      topics: ["blocking", "termination", "java", "shutdown", "services"],
      classifications: ["library"]
    });
  });
});
