import { describe, expect, it, vi } from "vitest";

import { discoverGithubOwnerRepos, planGithubRepoDiscovery } from "../src/github-catalog.js";

describe("github-catalog", () => {
  it("discovers user repos, keeping forks and filtering archived repos by default", async () => {
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
      fetchFn
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
          topics: ["cli", "codex", "qa", "archa"],
          classifications: ["cli"]
        },
        {
          name: "forked-repo",
          url: "https://github.com/leanish/forked-repo.git",
          defaultBranch: "main",
          description: "",
          topics: ["fork", "customized", "forked"],
          classifications: []
        }
      ],
      skippedForks: 0,
      skippedArchived: 1
    });
  });

  it("keeps inline repo topics without an extra topics request", async () => {
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
      fetchFn
    });

    expect(result.repos).toEqual([
      {
        name: "archa",
        url: "https://github.com/leanish/archa.git",
        defaultBranch: "main",
        description: "Repo-aware CLI for engineering Q&A with local Codex",
        topics: ["cli", "codex", "qa", "archa"],
        classifications: ["cli"]
      }
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("infers fallback topics from repo metadata when GitHub topics are empty", async () => {
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
      fetchFn
    });

    expect(result.repos).toEqual([
      {
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects",
        topics: ["java-conventions", "java", "conventions", "gradle", "jdk"],
        classifications: ["infra"]
      }
    ]);
  });

  it("uses fewer inferred topics for smaller repos", async () => {
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
      fetchFn
    });

    expect(result.repos).toEqual([
      {
        name: "tiny-cli",
        url: "https://github.com/leanish/tiny-cli.git",
        defaultBranch: "main",
        description: "Tiny command line helper for demos",
        topics: ["tiny-cli", "tiny", "cli"],
        classifications: ["cli"]
      }
    ]);
  });

  it("infers high-signal classifications separately from generic topics", async () => {
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
            description: "Internal billing microservice API",
            topics: ["payments"],
            size: 800,
            private: true,
            fork: false,
            archived: false
          }
        ]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn
    });

    expect(result.repos).toEqual([
      {
        name: "billing-service",
        url: "https://github.com/leanish/billing-service.git",
        defaultBranch: "main",
        description: "Internal billing microservice API",
        topics: ["payments", "billing", "service", "internal", "microservice", "api"],
        classifications: ["internal", "microservice", "backend"]
      }
    ]);
  });

  it("uses organization repo listing and forwards GitHub auth headers", async () => {
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
      fetchFn
    });

    expect(result.ownerType).toBe("Organization");
    expect(result.repos).toEqual([]);
  });

  it("throws a clear error when the owner does not exist", async () => {
    const fetchFn = vi.fn(async () => createJsonResponse(404, {
      message: "Not Found"
    }));

    await expect(discoverGithubOwnerRepos({
      owner: "missing-owner",
      fetchFn
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
