import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inspectRepoClassifications, inspectRepoMetadata } from "../src/repo-classification-inspector.js";

describe("repo-classification-inspector", () => {
  let tempRoot;
  let env;
  let curateMetadataFn;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "archa-inspect-"));
    env = {
      XDG_DATA_HOME: path.join(tempRoot, "data")
    };
    curateMetadataFn = vi.fn(async ({ inferredMetadata }) => inferredMetadata);
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
      env,
      curateMetadataFn
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
      env,
      curateMetadataFn
    });

    expect(classifications).toEqual(["infra", "internal"]);
  });

  it("allows infra and library classifications to coexist when both have evidence", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "terraform-modules");
    await fs.mkdir(path.join(repoDirectory, "terraform"), { recursive: true });
    await fs.writeFile(path.join(repoDirectory, "README.md"), "Reusable Terraform module package for shared platform infrastructure.");
    await fs.writeFile(path.join(repoDirectory, "build.gradle"), "plugins { id 'java-library' }\n");

    const classifications = await inspectRepoClassifications({
      repo: {
        name: "terraform-modules",
        url: "https://github.com/leanish/terraform-modules.git",
        defaultBranch: "main",
        description: "Shared infrastructure modules",
        topics: []
      },
      sourceRepo: {},
      env,
      curateMetadataFn
    });

    expect(classifications).toEqual(["infra", "library"]);
  });

  it("does not infer microservice from generic service wording in conventions docs", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "java-conventions");
    await fs.mkdir(repoDirectory, { recursive: true });
    await fs.writeFile(path.join(repoDirectory, "README.md"), [
      "# java-conventions",
      "",
      "Shared Gradle conventions for JDK-based projects.",
      "",
      "The plugin applies shared defaults for service and library builds."
    ].join("\n"));
    await fs.writeFile(path.join(repoDirectory, "build.gradle"), "plugins { id 'java-library' }\n");

    const classifications = await inspectRepoClassifications({
      repo: {
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects",
        topics: []
      },
      sourceRepo: {},
      env,
      curateMetadataFn
    });

    expect(classifications).toEqual(["library"]);
  });

  it("does not infer external from api integration wording in shared libraries", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "sqs-codec");
    await fs.mkdir(repoDirectory, { recursive: true });
    await fs.writeFile(path.join(repoDirectory, "README.md"), [
      "# sqs-codec",
      "",
      "Shared Java library for SQS message encoding.",
      "",
      "It is used by GraphQL and REST services to encode compression and checksum metadata."
    ].join("\n"));
    await fs.writeFile(path.join(repoDirectory, "build.gradle"), "plugins { id 'java-library' }\n");

    const classifications = await inspectRepoClassifications({
      repo: {
        name: "sqs-codec",
        url: "https://github.com/leanish/sqs-codec.git",
        defaultBranch: "main",
        description: "SQS execution interceptor with compression and checksum metadata",
        topics: []
      },
      sourceRepo: {},
      env,
      curateMetadataFn
    });

    expect(classifications).toEqual(["library"]);
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
      env,
      curateMetadataFn
    });

    expect(metadata).toEqual({
      description: "Terminator is a small Java library that coordinates the orderly shutdown of heterogeneous services.",
      topics: ["blocking", "termination", "java", "shutdown", "services"],
      classifications: ["library"]
    });
  });

  it("lets Codex curation refine the inferred metadata", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "java-conventions");
    await fs.mkdir(repoDirectory, { recursive: true });
    await fs.writeFile(path.join(repoDirectory, "README.md"), "Shared Gradle conventions for JDK-based projects.");
    await fs.writeFile(path.join(repoDirectory, "build.gradle"), "plugins { id 'java-library' }\n");
    curateMetadataFn.mockImplementation(async ({ inferredMetadata }) => ({
      ...inferredMetadata,
      topics: ["gradle-plugin", "conventions", "java"],
      classifications: ["library"]
    }));

    const metadata = await inspectRepoMetadata({
      repo: {
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects",
        topics: []
      },
      sourceRepo: {
        size: 245
      },
      env,
      curateMetadataFn
    });

    expect(curateMetadataFn).toHaveBeenCalledWith(expect.objectContaining({
      directory: repoDirectory,
      inferredMetadata: expect.objectContaining({
        classifications: ["library"]
      })
    }));
    expect(metadata).toEqual({
      description: "Shared Gradle conventions for JDK-based projects.",
      topics: ["gradle-plugin", "conventions", "java"],
      classifications: ["library"]
    });
  });

  it("falls back to heuristic metadata when Codex curation fails", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "terminator");
    await fs.mkdir(repoDirectory, { recursive: true });
    await fs.writeFile(path.join(repoDirectory, "README.md"), "Terminator is a small Java library.");
    await fs.writeFile(path.join(repoDirectory, "build.gradle"), "plugins { id 'java-library' }\n");
    curateMetadataFn.mockRejectedValue(new Error("codex unavailable"));

    const metadata = await inspectRepoMetadata({
      repo: {
        name: "terminator",
        url: "https://github.com/leanish/terminator.git",
        defaultBranch: "main",
        description: "",
        topics: []
      },
      env,
      curateMetadataFn
    });

    expect(metadata.classifications).toEqual(["library"]);
    expect(metadata.description).toBe("Terminator is a small Java library.");
  });
});
