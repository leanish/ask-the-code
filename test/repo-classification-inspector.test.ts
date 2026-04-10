import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { inspectRepoClassifications, inspectRepoMetadata } from "../src/core/discovery/repo-classification-inspector.js";
import { createEmptyRepoRouting } from "../src/core/repos/repo-routing.js";

type CuratedMetadata = {
  description: string;
  routing: ReturnType<typeof createEmptyRepoRouting>;
};

describe("repo-classification-inspector", () => {
  let tempRoot: string;
  let env: NodeJS.ProcessEnv;
  let curateMetadataFn: Mock<(args: { inferredMetadata: CuratedMetadata }) => Promise<CuratedMetadata>>;

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

  it("detects external frontend repos from local source signals", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "leanish", "shop-app");
    await fs.mkdir(path.join(repoDirectory, "src", "pages"), { recursive: true });
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
      env,
      curateMetadataFn
    });

    expect(classifications).toEqual(["frontend", "external"]);
  });

  it("detects infra and internal repos from local source signals", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "leanish", "infra-live");
    await fs.mkdir(path.join(repoDirectory, "terraform"), { recursive: true });
    await fs.writeFile(path.join(repoDirectory, "README.md"), "Internal platform infrastructure modules.");

    const classifications = await inspectRepoClassifications({
      repo: {
        name: "infra-live",
        url: "https://github.com/leanish/infra-live.git",
        defaultBranch: "main",
        description: "Platform infra",
        topics: []
      },
      env,
      curateMetadataFn
    });

    expect(classifications).toEqual(["infra", "internal"]);
  });

  it("infers routing metadata from the repo readme and build files", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "leanish", "terminator");
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

    expect(metadata.description).toBe(
      "Terminator is a small Java library that coordinates the orderly shutdown of heterogeneous services."
    );
    expect(metadata.routing.role).toBe("shared-library");
    expect(metadata.routing.reach).toEqual(["shared-library"]);
    expect(metadata.routing.owns).toContain("java");
    expect(metadata.routing.owns).toContain("shutdown");
    expect(metadata.routing.boundaries).toContain("Do not select only because another repo depends on this library.");
  });

  it("feeds inferred routing into the Codex curation step", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "leanish", "java-conventions");
    await fs.mkdir(repoDirectory, { recursive: true });
    await fs.writeFile(path.join(repoDirectory, "README.md"), "Shared Gradle conventions for JDK-based projects.");
    await fs.writeFile(path.join(repoDirectory, "build.gradle"), "plugins { id 'java-library' }\n");
    curateMetadataFn.mockImplementation(async ({ inferredMetadata }) => ({
      ...inferredMetadata,
      routing: {
        ...inferredMetadata.routing,
        owns: ["Gradle conventions", "build defaults"],
        exposes: ["Gradle plugin"]
      }
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
        routing: expect.objectContaining({
          role: "shared-library"
        })
      })
    }));
    expect(metadata.routing.owns).toEqual(["Gradle conventions", "build defaults"]);
    expect(metadata.routing.exposes).toEqual(["Gradle plugin"]);
  });

  it("extracts route endpoints and consumed technologies into the routing draft", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "OtherCo", "dtv");
    await fs.mkdir(path.join(repoDirectory, "app", "controllers"), { recursive: true });
    await fs.mkdir(path.join(repoDirectory, "conf"), { recursive: true });
    await fs.writeFile(path.join(repoDirectory, "conf", "routes"), [
      "GET /api/ping controllers.HealthController.ping()",
      "POST /order/track controllers.OrderController.track()",
      "GET /admin/overview controllers.AdminController.index()"
    ].join("\n"));
    await fs.writeFile(path.join(repoDirectory, "build.gradle"), "implementation 'org.mongodb:mongodb-driver-sync:4.0.0'\n");
    await fs.writeFile(path.join(repoDirectory, "README.md"), [
      "# Dtv",
      "",
      "This is the main web application project for merchant backend, merchant frontend, and api services.",
      "",
      "It powers checkout, storefront, onboarding, pricing, personalization, and recommendations on connect.example.com."
    ].join("\n"));

    const metadata = await inspectRepoMetadata({
      repo: {
        name: "dtv",
        url: "https://github.com/OtherCo/dtv.git",
        defaultBranch: "master",
        description: "Play framework based commerce service",
        topics: []
      },
      sourceRepo: {
        size: 150_000
      },
      env,
      curateMetadataFn
    });

    expect(metadata.routing.role).toBe("service-application");
    expect(metadata.routing.exposes).toContain("GET /api/ping");
    expect(metadata.routing.exposes).toContain("POST /order/track");
    expect(metadata.routing.exposes).toContain("GET /admin/overview");
    expect(metadata.routing.consumes).toContain("MongoDB");
    expect(metadata.routing.consumes).not.toContain("GraphQL");
    expect(metadata.routing.consumes).not.toContain("Play");
  });

  it("falls back to heuristic routing when Codex curation fails", async () => {
    const repoDirectory = path.join(tempRoot, "data", "archa", "repos", "leanish", "terminator");
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

    expect(metadata.description).toBe("Terminator is a small Java library.");
    expect(metadata.routing.role).toBe("shared-library");
  });
});
