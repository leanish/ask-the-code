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
            topics: ["cli", "codex", "qa"],
            fork: false,
            archived: false
          },
          {
            name: "archived-repo",
            clone_url: "https://github.com/leanish/archived-repo.git",
            default_branch: "main",
            description: "",
            topics: [],
            fork: false,
            archived: true
          },
          {
            name: "forked-repo",
            clone_url: "https://github.com/leanish/forked-repo.git",
            default_branch: "main",
            description: "",
            topics: [],
            fork: true,
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

    expect(result).toEqual({
      owner: "leanish",
      ownerType: "User",
      repos: [
        {
          name: "archa",
          url: "https://github.com/leanish/archa.git",
          defaultBranch: "main",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          topics: ["cli", "codex", "qa"]
        },
        {
          name: "forked-repo",
          url: "https://github.com/leanish/forked-repo.git",
          defaultBranch: "main",
          description: "",
          topics: []
        }
      ],
      skippedForks: 0,
      skippedArchived: 1
    });
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
          topics: ["java", "gradle"]
        },
        {
          name: "shared",
          url: "https://github.com/leanish/shared.git",
          defaultBranch: "main",
          description: "Shared utilities",
          topics: []
        },
        {
          name: "archa",
          url: "https://github.com/leanish/archa.git",
          defaultBranch: "main",
          description: "Repo-aware CLI",
          topics: ["cli"]
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
        "consider topics: java, gradle"
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
        topics: ["cli"]
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
