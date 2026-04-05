import { describe, expect, it, vi } from "vitest";

import {
  discoverGithubOwnerRepos,
  mergeGithubDiscoveryResults,
  planGithubRepoDiscovery
} from "../src/github-catalog.js";

describe("github-catalog", () => {
  it("discovers user repos, keeping forks and filtering archived repos by default", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, [
          {
            name: "archa",
            clone_url: "https://github.com/leanish/archa.git",
            default_branch: "main",
            description: "Repo-aware CLI for engineering Q&A with local Codex",
            topics: [],
            size: 6400,
            fork: false,
            archived: false
          },
          {
            name: "archived-repo",
            clone_url: "https://github.com/leanish/archived-repo.git",
            default_branch: "main",
            description: "",
            topics: [],
            size: 20,
            fork: false,
            archived: true
          },
          {
            name: "forked-repo",
            clone_url: "https://github.com/leanish/forked-repo.git",
            default_branch: "main",
            description: "",
            topics: [],
            size: 32,
            fork: true,
            archived: false
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/archa/topics") {
        return createJsonResponse(200, {
          names: ["cli", "codex", "qa"]
        });
      }

      if (url === "https://api.github.com/repos/leanish/forked-repo/topics") {
        return createJsonResponse(200, {
          names: ["fork", "customized"]
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result).toEqual({
      owner: "leanish",
      ownerType: "User",
      repos: [
        {
          name: "archa",
          url: "https://github.com/leanish/archa.git",
          defaultBranch: "main",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          topics: ["cli", "codex", "qa"],
          classifications: ["cli"]
        },
        {
          name: "forked-repo",
          url: "https://github.com/leanish/forked-repo.git",
          defaultBranch: "main",
          description: "",
          topics: ["fork", "customized"],
          classifications: []
        }
      ],
      skippedForks: 0,
      skippedArchived: 1
    });
  });

  it("emits progress updates while discovery inspects eligible repos", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const onProgress = vi.fn();
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, [
          {
            name: "archa",
            clone_url: "https://github.com/leanish/archa.git",
            default_branch: "main",
            description: "Repo-aware CLI for engineering Q&A with local Codex",
            topics: ["cli", "codex", "qa"],
            size: 6400,
            fork: false,
            archived: false
          }
        ]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      onProgress
    });

    expect(onProgress).toHaveBeenNthCalledWith(1, {
      type: "discovery-listed",
      owner: "leanish",
      discoveredCount: 1,
      eligibleCount: 1,
      skippedForks: 0,
      skippedArchived: 0
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      type: "repo-curated",
      owner: "leanish",
      repoName: "archa",
      processedCount: 1,
      totalCount: 1
    });
  });

  it("can skip local inspection during the initial discovery phase", async () => {
    const inspectRepoFn = vi.fn(async () => ({
      description: "Should not be used",
      topics: ["ignored"],
      classifications: ["library"]
    }));
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, [
          {
            name: "java-conventions",
            clone_url: "https://github.com/leanish/java-conventions.git",
            default_branch: "main",
            description: "Shared Gradle conventions for JDK-based projects",
            topics: [],
            size: 1800,
            fork: false,
            archived: false
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/java-conventions/topics") {
        return createJsonResponse(200, {
          names: []
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      inspectRepos: false,
      curateWithCodex: false
    });

    expect(result.repos).toEqual([
      {
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects",
        topics: ["gradle", "conventions", "jdk"],
        classifications: []
      }
    ]);
    expect(inspectRepoFn).not.toHaveBeenCalled();
  });

  it("can refine only a selected subset and merge it back into the preview", async () => {
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, [
          {
            name: "archa",
            clone_url: "https://github.com/leanish/archa.git",
            default_branch: "main",
            description: "Repo-aware CLI for engineering Q&A with local Codex",
            topics: ["cli"],
            size: 6400,
            fork: false,
            archived: false
          },
          {
            name: "terminator",
            clone_url: "https://github.com/leanish/terminator.git",
            default_branch: "main",
            description: "",
            topics: [],
            size: 175,
            fork: false,
            archived: false
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/terminator/topics") {
        return createJsonResponse(200, {
          names: []
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    const inspectRepoFn = vi.fn(async ({ repo }) => ({
      description: repo.name === "terminator"
        ? "Small Java library for orderly shutdown coordination."
        : "",
      topics: repo.name === "terminator" ? ["java", "shutdown"] : [],
      classifications: repo.name === "terminator" ? ["library"] : []
    }));

    const preview = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      inspectRepos: false,
      curateWithCodex: false
    });
    const refined = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      selectedRepoNames: ["terminator"]
    });
    const merged = mergeGithubDiscoveryResults(preview, refined);

    expect(merged.repos).toEqual([
      {
        name: "archa",
        url: "https://github.com/leanish/archa.git",
        defaultBranch: "main",
        description: "Repo-aware CLI for engineering Q&A with local Codex",
        topics: ["cli", "codex"],
        classifications: ["cli"]
      },
      {
        name: "terminator",
        url: "https://github.com/leanish/terminator.git",
        defaultBranch: "main",
        description: "Small Java library for orderly shutdown coordination.",
        topics: ["java", "shutdown"],
        classifications: ["library"]
      }
    ]);
    expect(inspectRepoFn).toHaveBeenCalledTimes(1);
    expect(inspectRepoFn).toHaveBeenCalledWith(expect.objectContaining({
      repo: expect.objectContaining({
        name: "terminator"
      })
    }));
  });

  it("keeps inline repo topics without an extra topics request", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, [
          {
            name: "archa",
            clone_url: "https://github.com/leanish/archa.git",
            default_branch: "main",
            description: "Repo-aware CLI for engineering Q&A with local Codex",
            topics: ["cli", "codex", "qa"],
            size: 6400,
            fork: false,
            archived: false
          }
        ]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      {
        name: "archa",
        url: "https://github.com/leanish/archa.git",
        defaultBranch: "main",
        description: "Repo-aware CLI for engineering Q&A with local Codex",
        topics: ["cli", "codex", "qa"],
        classifications: ["cli"]
      }
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("infers fallback topics from repo metadata when GitHub topics are empty", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, [
          {
            name: "java-conventions",
            clone_url: "https://github.com/leanish/java-conventions.git",
            default_branch: "main",
            description: "Shared Gradle conventions for JDK-based projects",
            topics: [],
            size: 1800,
            fork: false,
            archived: false
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/java-conventions/topics") {
        return createJsonResponse(200, {
          names: []
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      {
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects",
        topics: ["gradle", "conventions", "jdk"],
        classifications: []
      }
    ]);
  });

  it("does not misclassify Gradle conventions repos as infra or microservice when inspection identifies a library", async () => {
    const inspectRepoFn = vi.fn(async () => ({
      description: "",
      topics: [],
      classifications: ["library"]
    }));
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, [
          {
            name: "java-conventions",
            clone_url: "https://github.com/leanish/java-conventions.git",
            default_branch: "main",
            description: "Shared Gradle conventions for JDK-based projects",
            topics: [],
            size: 1800,
            fork: false,
            archived: false
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/java-conventions/topics") {
        return createJsonResponse(200, {
          names: []
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      {
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects",
        topics: ["gradle", "conventions", "jdk"],
        classifications: ["library"]
      }
    ]);
  });

  it("uses fewer inferred topics for smaller repos", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, [
          {
            name: "tiny-cli",
            clone_url: "https://github.com/leanish/tiny-cli.git",
            default_branch: "main",
            description: "Tiny command line helper for demos",
            topics: [],
            size: 40,
            fork: false,
            archived: false
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/tiny-cli/topics") {
        return createJsonResponse(200, {
          names: []
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      {
        name: "tiny-cli",
        url: "https://github.com/leanish/tiny-cli.git",
        defaultBranch: "main",
        description: "Tiny command line helper for demos",
        topics: ["tiny", "command", "line"],
        classifications: ["cli"]
      }
    ]);
  });

  it("merges classifications discovered from repository inspection", async () => {
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, [
          {
            name: "shop-app",
            clone_url: "https://github.com/leanish/shop-app.git",
            default_branch: "main",
            description: "Storefront frontend",
            topics: ["commerce"],
            size: 500,
            fork: false,
            archived: false
          }
        ]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    const inspectRepoFn = vi.fn(async () => ["frontend", "external"]);

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      {
        name: "shop-app",
        url: "https://github.com/leanish/shop-app.git",
        defaultBranch: "main",
        description: "Storefront frontend",
        topics: ["commerce", "storefront", "frontend"],
        classifications: ["frontend", "external"]
      }
    ]);
    expect(inspectRepoFn).toHaveBeenCalledWith(expect.objectContaining({
      repo: expect.objectContaining({
        name: "shop-app"
      })
    }));
  });

  it("fills missing description and topics from repository inspection metadata", async () => {
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, [
          {
            name: "terminator",
            clone_url: "https://github.com/leanish/terminator.git",
            default_branch: "main",
            description: "",
            topics: [],
            size: 175,
            fork: false,
            archived: false
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/terminator/topics") {
        return createJsonResponse(200, {
          names: []
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    const inspectRepoFn = vi.fn(async () => ({
      description: "Terminator is a small Java library that coordinates the orderly shutdown of heterogeneous services.",
      topics: ["java", "shutdown", "blocking"],
      classifications: ["library"]
    }));

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      {
        name: "terminator",
        url: "https://github.com/leanish/terminator.git",
        defaultBranch: "main",
        description: "Terminator is a small Java library that coordinates the orderly shutdown of heterogeneous services.",
        topics: ["java", "shutdown", "blocking"],
        classifications: ["library"]
      }
    ]);
  });

  it("does not infer external from generic graphql api wording alone", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, [
          {
            name: "billing-service",
            clone_url: "https://github.com/leanish/billing-service.git",
            default_branch: "main",
            description: "Billing microservice GraphQL API",
            topics: ["payments"],
            size: 800,
            fork: false,
            archived: false
          }
        ]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      {
        name: "billing-service",
        url: "https://github.com/leanish/billing-service.git",
        defaultBranch: "main",
        description: "Billing microservice GraphQL API",
        topics: ["payments", "billing", "microservice", "graphql", "api"],
        classifications: ["microservice", "backend"]
      }
    ]);
  });

  it("lets internal source inspection override outward-facing metadata cues", async () => {
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, [
          {
            name: "billing-platform",
            clone_url: "https://github.com/leanish/billing-platform.git",
            default_branch: "main",
            description: "Billing GraphQL API",
            topics: [],
            size: 800,
            fork: false,
            archived: false
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/billing-platform/topics") {
        return createJsonResponse(200, {
          names: []
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    const inspectRepoFn = vi.fn(async () => ["internal", "backend"]);

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      {
        name: "billing-platform",
        url: "https://github.com/leanish/billing-platform.git",
        defaultBranch: "main",
        description: "Billing GraphQL API",
        topics: ["billing", "graphql", "api"],
        classifications: ["backend", "internal"]
      }
    ]);
  });

  it("uses organization repo listing and forwards GitHub auth headers", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async (url, options) => {
      if (url === "https://api.github.com/users/openai") {
        expect(options.headers.Authorization).toBe("Bearer secret-token");
        return createJsonResponse(200, { login: "openai", type: "Organization" });
      }

      if (url === "https://api.github.com/orgs/openai/repos?per_page=100&page=1&sort=full_name&type=all") {
        expect(options.headers.Authorization).toBe("Bearer secret-token");
        return createJsonResponse(200, []);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerRepos({
      owner: "openai",
      env: { GH_TOKEN: "secret-token" },
      fetchFn,
      inspectRepoFn
    });

    expect(result.ownerType).toBe("Organization");
    expect(result.repos).toEqual([]);
  });

  it("throws a clear error when the owner does not exist", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async () => createJsonResponse(404, {
      message: "Not Found"
    }));

    await expect(discoverGithubOwnerRepos({
      owner: "missing-owner",
      fetchFn,
      inspectRepoFn
    })).rejects.toThrow("GitHub owner not found: missing-owner.");
  });

  it("plans additions, conflicts, and metadata suggestions against the current config", () => {
    const plan = planGithubRepoDiscovery({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          defaultBranch: "main",
          description: "",
          topics: [],
          classifications: [],
          aliases: ["shared"],
          directory: "/repos/foundation"
        }
      ]
    }, {
      owner: "leanish",
      ownerType: "User",
      skippedForks: 0,
      skippedArchived: 0,
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          defaultBranch: "main",
          description: "Shared base functionality",
          topics: ["java", "gradle"],
          classifications: ["infra"]
        },
        {
          name: "shared",
          url: "https://github.com/leanish/shared.git",
          defaultBranch: "main",
          description: "Shared utilities",
          topics: [],
          classifications: []
        },
        {
          name: "archa",
          url: "https://github.com/leanish/archa.git",
          defaultBranch: "main",
          description: "Repo-aware CLI",
          topics: ["cli"],
          classifications: ["cli"]
        }
      ]
    });

    expect(plan.counts).toEqual({
      discovered: 3,
      configured: 1,
      new: 1,
      conflicts: 1,
      withSuggestions: 1
    });
    expect(plan.entries.find(entry => entry.repo.name === "archa")).toMatchObject({
      status: "new",
      repo: {
        name: "archa"
      }
    });
    expect(plan.entries.find(entry => entry.repo.name === "foundation")).toMatchObject({
      status: "configured",
      repo: {
        name: "foundation"
      },
      suggestions: [
        "add description from GitHub",
        "consider topics: java, gradle",
        "consider classifications: infra"
      ]
    });
    expect(plan.entries.find(entry => entry.repo.name === "shared")).toMatchObject({
      status: "conflict",
      repo: {
        name: "shared"
      },
      configuredRepo: {
        name: "foundation"
      }
    });
    expect(plan.reposToAdd).toEqual([
      {
        name: "archa",
        url: "https://github.com/leanish/archa.git",
        defaultBranch: "main",
        description: "Repo-aware CLI",
        topics: ["cli"],
        classifications: ["cli"]
      }
    ]);
  });
});

function createJsonResponse(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
    async text() {
      return JSON.stringify(value);
    }
  };
}
