import { describe, expect, it, vi } from "vitest";

import {
  discoverGithubOwnerRepos,
  planGithubRepoDiscovery,
  refineDiscoveredGithubRepos
} from "../src/core/discovery/github-catalog.ts";
import { createEmptyRepoRouting } from "../src/core/repos/repo-routing.ts";
import { createLoadedConfig } from "./test-helpers.ts";

// Keep auth state explicit in this file so IDE and CLI test runs exercise the same code paths.
async function discoverGithubOwnerReposWithoutAuth(
  options: Parameters<typeof discoverGithubOwnerRepos>[0]
) {
  return await discoverGithubOwnerRepos({
    env: {},
    resolveGithubAuthTokenFn: async () => null,
    ...options
  });
}

async function discoverGithubOwnerReposWithToken(
  options: Parameters<typeof discoverGithubOwnerRepos>[0],
  token = "test-token"
) {
  return await discoverGithubOwnerRepos({
    env: {
      GH_TOKEN: token
    },
    ...options
  });
}

async function refineDiscoveredGithubReposWithoutAuth(
  options: Parameters<typeof refineDiscoveredGithubRepos>[0]
) {
  return await refineDiscoveredGithubRepos({
    env: {},
    resolveGithubAuthTokenFn: async () => null,
    ...options
  });
}

async function refineDiscoveredGithubReposWithToken(
  options: Parameters<typeof refineDiscoveredGithubRepos>[0],
  token = "test-token"
) {
  return await refineDiscoveredGithubRepos({
    env: {
      GH_TOKEN: token
    },
    ...options
  });
}

function expectRepoRouting(partial: Record<string, unknown>, routing: unknown) {
  return expect.objectContaining({
    ...partial,
    routing: expect.objectContaining((routing ?? {}) as Record<string, unknown>)
  });
}

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
            name: "ask-the-code",
            clone_url: "https://github.com/leanish/ask-the-code.git",
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

      if (url === "https://api.github.com/repos/leanish/ask-the-code/topics") {
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

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result).toEqual(expect.objectContaining({
      owner: "leanish",
      ownerType: "User",
      repos: [
        expectRepoRouting({
          name: "ask-the-code",
          url: "https://github.com/leanish/ask-the-code.git",
          defaultBranch: "main",
          description: "Repo-aware CLI for engineering Q&A with local Codex"
        }, {
          role: "developer-cli",
          owns: ["cli", "codex", "qa"]
        }),
        expectRepoRouting({
          name: "forked-repo",
          url: "https://github.com/leanish/forked-repo.git",
          defaultBranch: "main",
          description: ""
        }, {
          role: "",
          owns: ["fork", "customized"]
        })
      ],
      skippedForks: 0,
      skippedArchived: 1
    }));
    expect(result.discoveryContext).toEqual(expect.objectContaining({
      includeSourceMetadata: false,
      sourceOwnerFallback: "leanish"
    }));
  });

  it("filters disabled repos by default", async () => {
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
            name: "active-repo",
            clone_url: "https://github.com/leanish/active-repo.git",
            default_branch: "main",
            description: "",
            topics: [],
            size: 20,
            fork: false,
            archived: false,
            disabled: false
          },
          {
            name: "disabled-repo",
            clone_url: "https://github.com/leanish/disabled-repo.git",
            default_branch: "main",
            description: "",
            topics: [],
            size: 20,
            fork: false,
            archived: false,
            disabled: true
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/active-repo/topics") {
        return createJsonResponse(200, {
          names: []
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result).toEqual(expect.objectContaining({
      owner: "leanish",
      ownerType: "User",
      repos: [
        expectRepoRouting({
          name: "active-repo",
          url: "https://github.com/leanish/active-repo.git",
          defaultBranch: "main",
          description: ""
        }, createEmptyRepoRouting())
      ],
      skippedForks: 0,
      skippedArchived: 0,
      skippedDisabled: 1
    }));
    expect(result.discoveryContext).toEqual(expect.objectContaining({
      includeSourceMetadata: false,
      sourceOwnerFallback: "leanish"
    }));
  });

  it("can refine a discovery result after a shallow object copy", async () => {
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
            name: "ask-the-code",
            clone_url: "https://github.com/leanish/ask-the-code.git",
            default_branch: "main",
            description: "Repo-aware CLI",
            topics: [],
            size: 6400,
            fork: false,
            archived: false
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/ask-the-code/topics") {
        return createJsonResponse(200, {
          names: ["cli"]
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const discovery = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    const refined = await refineDiscoveredGithubReposWithoutAuth({
      discovery: { ...discovery },
      fetchFn,
      inspectRepoFn,
      curateWithCodex: false,
      inspectRepos: false,
      selectedRepoNames: ["ask-the-code"]
    });

    expect(refined.repos).toHaveLength(1);
    expect(refined.repos[0]).toEqual(expectRepoRouting({
      name: "ask-the-code",
      description: "Repo-aware CLI"
    }, {
      role: "developer-cli",
      owns: ["cli"]
    }));
  });

  it("keeps discovery refinement context lean and out of JSON serialization", async () => {
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
            name: "ask-the-code",
            clone_url: "https://github.com/leanish/ask-the-code.git",
            default_branch: "main",
            description: "Repo-aware CLI",
            topics: [],
            size: 6400,
            fork: false,
            archived: false,
            disabled: false,
            private: true,
            visibility: "private",
            node_id: "R_kgDOTest",
            full_name: "leanish/ask-the-code",
            owner: {
              login: "leanish",
              id: 42
            }
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/ask-the-code/topics") {
        return createJsonResponse(200, {
          names: ["cli"]
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.discoveryContext?.discoveredRepos).toEqual([
      {
        name: "ask-the-code",
        clone_url: "https://github.com/leanish/ask-the-code.git",
        default_branch: "main",
        description: "Repo-aware CLI",
        topics: [],
        size: 6400,
        fork: false,
        archived: false,
        disabled: false,
        full_name: "leanish/ask-the-code",
        owner: {
          login: "leanish"
        }
      }
    ]);
    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty("discoveryContext");
  });

  it("includes private user repos when discovery is authenticated for the same owner", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/user") {
        return createJsonResponse(200, {
          login: "leanish"
        });
      }

      if (url === "https://api.github.com/user/repos?per_page=100&page=1&sort=full_name&affiliation=owner&visibility=all") {
        return createJsonResponse(200, [
          {
            name: "private-service",
            clone_url: "https://github.com/leanish/private-service.git",
            default_branch: "main",
            description: "Private service implementation",
            topics: [],
            size: 2400,
            fork: false,
            archived: false,
            private: true
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/private-service/topics") {
        return createJsonResponse(200, {
          names: ["service", "internal-api"]
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerReposWithToken({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.owner).toBe("leanish");
    expect(result.ownerType).toBe("User");
    expect(result.skippedForks).toBe(0);
    expect(result.skippedArchived).toBe(0);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]).toEqual(expect.objectContaining({
      name: "private-service",
      url: "https://github.com/leanish/private-service.git",
      defaultBranch: "main",
      description: "Private service implementation"
    }));
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token"
        })
      })
    );
  });

  it("can discover all accessible repos across personal and organization scopes", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/user") {
        return createJsonResponse(200, {
          login: "leanish"
        });
      }

      if (url === "https://api.github.com/user/repos?per_page=100&page=1&sort=full_name&affiliation=owner,organization_member&visibility=all") {
        return createJsonResponse(200, [
          {
            name: "ask-the-code",
            full_name: "leanish/ask-the-code",
            clone_url: "https://github.com/leanish/ask-the-code.git",
            default_branch: "main",
            description: "Repo-aware CLI",
            topics: ["cli"],
            size: 6400,
            fork: false,
            archived: false,
            owner: {
              login: "leanish"
            }
          },
          {
            name: "dtv",
            full_name: "OtherCo/dtv",
            clone_url: "https://github.com/OtherCo/dtv.git",
            default_branch: "master",
            description: "Storefront backend",
            topics: ["play"],
            size: 50200,
            fork: false,
            archived: false,
            owner: {
              login: "OtherCo"
            }
          }
        ]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerReposWithToken({
      owner: "@accessible",
      fetchFn,
      inspectRepoFn,
      hydrateMetadata: false,
      inspectRepos: false
    });

    expect(result).toEqual(expect.objectContaining({
      owner: "@accessible",
      ownerDisplay: "leanish + orgs",
      ownerType: "Accessible",
      repos: [
        expectRepoRouting({
          name: "ask-the-code",
          url: "https://github.com/leanish/ask-the-code.git",
          defaultBranch: "main",
          description: "Repo-aware CLI",
          sourceOwner: "leanish",
          sourceFullName: "leanish/ask-the-code"
        }, createEmptyRepoRouting()),
        expectRepoRouting({
          name: "dtv",
          url: "https://github.com/OtherCo/dtv.git",
          defaultBranch: "master",
          description: "Storefront backend",
          sourceOwner: "OtherCo",
          sourceFullName: "OtherCo/dtv"
        }, createEmptyRepoRouting())
      ],
      skippedForks: 0,
      skippedArchived: 0
    }));
    expect(result.discoveryContext).toEqual(expect.objectContaining({
      includeSourceMetadata: true,
      sourceOwnerFallback: "leanish"
    }));
  });

  it("falls back to gh auth when env tokens are absent", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const resolveGithubAuthTokenFn = vi.fn(async () => "gh-token");
    const fetchFn = vi.fn(async (url, options) => {
      if (url === "https://api.github.com/users/leanish") {
        expect(options.headers.Authorization).toBe("Bearer gh-token");
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/user") {
        expect(options.headers.Authorization).toBe("Bearer gh-token");
        return createJsonResponse(200, {
          login: "leanish"
        });
      }

      if (url === "https://api.github.com/user/repos?per_page=100&page=1&sort=full_name&affiliation=owner&visibility=all") {
        expect(options.headers.Authorization).toBe("Bearer gh-token");
        return createJsonResponse(200, []);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      env: {},
      fetchFn,
      inspectRepoFn,
      resolveGithubAuthTokenFn
    });

    expect(resolveGithubAuthTokenFn).toHaveBeenCalledTimes(1);
    expect(result.ownerType).toBe("User");
    expect(result.repos).toEqual([]);
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
            name: "ask-the-code",
            clone_url: "https://github.com/leanish/ask-the-code.git",
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

    await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      onProgress
    });

    expect(onProgress).toHaveBeenNthCalledWith(1, {
      type: "discovery-fetching",
      owner: "leanish"
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      type: "discovery-listed",
      owner: "leanish",
      discoveredCount: 1,
      eligibleCount: 1,
      inspectRepos: true,
      hydrateMetadata: true,
      curateWithCodex: true,
      skippedForks: 0,
      skippedArchived: 0
    });
    expect(onProgress).toHaveBeenNthCalledWith(3, {
      type: "repo-hydrated",
      inspectRepos: true,
      owner: "leanish",
      repoName: "ask-the-code",
      processedCount: 1,
      totalCount: 1
    });
  });

  it("emits listing progress while fetching paginated repo results", async () => {
    const onProgress = vi.fn();
    const inspectRepoFn = vi.fn();
    const firstPageRepos = Array.from({ length: 100 }, (_, index) => ({
      name: `repo-${index + 1}`,
      clone_url: `https://github.com/leanish/repo-${index + 1}.git`,
      default_branch: "main",
      description: "",
      topics: [],
      size: 1,
      fork: false,
      archived: false
    }));
    const secondPageRepo = {
      name: "repo-101",
      clone_url: "https://github.com/leanish/repo-101.git",
      default_branch: "main",
      description: "",
      topics: [],
      size: 1,
      fork: false,
      archived: false
    };
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/leanish") {
        return createJsonResponse(200, {
          login: "leanish",
          type: "User"
        });
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=1&sort=full_name&type=owner") {
        return createJsonResponse(200, firstPageRepos);
      }

      if (url === "https://api.github.com/users/leanish/repos?per_page=100&page=2&sort=full_name&type=owner") {
        return createJsonResponse(200, [secondPageRepo]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      hydrateMetadata: false,
      inspectRepos: false,
      onProgress
    });

    expect(onProgress).toHaveBeenNthCalledWith(1, {
      type: "discovery-fetching",
      owner: "leanish"
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      type: "discovery-page",
      owner: "leanish",
      page: 1,
      fetchedCount: 100,
      hasMorePages: true
    });
    expect(onProgress).toHaveBeenNthCalledWith(3, {
      type: "discovery-page",
      owner: "leanish",
      page: 2,
      fetchedCount: 101,
      hasMorePages: false
    });
    expect(onProgress).toHaveBeenNthCalledWith(4, {
      type: "discovery-listed",
      owner: "leanish",
      discoveredCount: 101,
      eligibleCount: 101,
      inspectRepos: false,
      hydrateMetadata: false,
      curateWithCodex: true,
      skippedForks: 0,
      skippedArchived: 0
    });
    expect(inspectRepoFn).not.toHaveBeenCalled();
  });

  it("processes repo inspection sequentially during discovery", async () => {
    let resolveFirstStarted: () => void = () => {
      throw new Error("First-start resolver was not initialized.");
    };
    const firstStarted = new Promise<void>(resolve => {
      resolveFirstStarted = resolve;
    });
    let resolveFirstInspection: () => void = () => {
      throw new Error("First-inspection resolver was not initialized.");
    };
    const firstInspection = new Promise<void>(resolve => {
      resolveFirstInspection = resolve;
    });
    const inspectRepoFn = vi.fn(async ({ repo }) => {
      if (repo.name === "ask-the-code") {
        resolveFirstStarted();
        await firstInspection;
      }

      return [];
    });
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
            name: "ask-the-code",
            clone_url: "https://github.com/leanish/ask-the-code.git",
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
            description: "Small Java library for orderly shutdown coordination.",
            topics: ["java"],
            size: 175,
            fork: false,
            archived: false
          }
        ]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const discoveryPromise = discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    await firstStarted;

    expect(inspectRepoFn).toHaveBeenCalledTimes(1);
    expect(inspectRepoFn).toHaveBeenNthCalledWith(1, expect.objectContaining({
      repo: expect.objectContaining({
        name: "ask-the-code"
      })
    }));

    resolveFirstInspection();
    await discoveryPromise;

    expect(inspectRepoFn).toHaveBeenCalledTimes(2);
    expect(inspectRepoFn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      repo: expect.objectContaining({
        name: "terminator"
      })
    }));
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

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      inspectRepos: false,
      curateWithCodex: false
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects"
      }, {
        role: "",
        owns: ["gradle", "jdk"]
      })
    ]);
    expect(inspectRepoFn).not.toHaveBeenCalled();
  });

  it("can skip metadata hydration entirely during pre-selection discovery", async () => {
    const inspectRepoFn = vi.fn(async () => {
      throw new Error("inspectRepoFn should not be called");
    });
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

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      inspectRepos: false,
      curateWithCodex: false,
      hydrateMetadata: false
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects"
      }, createEmptyRepoRouting())
    ]);
    expect(inspectRepoFn).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("can refine only a selected repo subset", async () => {
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
            name: "ask-the-code",
            clone_url: "https://github.com/leanish/ask-the-code.git",
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

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      selectedRepoNames: ["terminator"]
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "terminator",
        url: "https://github.com/leanish/terminator.git",
        defaultBranch: "main",
        description: "Small Java library for orderly shutdown coordination."
      }, {
        role: "shared-library",
        reach: ["shared-library"]
      })
    ]);
    expect(inspectRepoFn).toHaveBeenCalledTimes(1);
    expect(inspectRepoFn).toHaveBeenCalledWith(expect.objectContaining({
      repo: expect.objectContaining({
        name: "terminator"
      })
    }));
  });

  it("can refine a selected repo subset without refetching owner pages", async () => {
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
            name: "ask-the-code",
            clone_url: "https://github.com/leanish/ask-the-code.git",
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

    const discovery = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      hydrateMetadata: false,
      inspectRepos: false
    });

    fetchFn.mockClear();

    const result = await refineDiscoveredGithubReposWithoutAuth({
      discovery,
      fetchFn,
      inspectRepoFn,
      selectedRepoNames: ["terminator"]
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "terminator",
        url: "https://github.com/leanish/terminator.git",
        defaultBranch: "main",
        description: "Small Java library for orderly shutdown coordination."
      }, {
        role: "shared-library",
        reach: ["shared-library"]
      })
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.github.com/repos/leanish/terminator/topics",
      expect.any(Object)
    );
  });

  it("uses the repo owner instead of @accessible when refining selected repo topics", async () => {
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/user") {
        return createJsonResponse(200, {
          login: "leanish"
        });
      }

      if (url === "https://api.github.com/user/repos?per_page=100&page=1&sort=full_name&affiliation=owner,organization_member&visibility=all") {
        return createJsonResponse(200, [
          {
            name: "nullability",
            full_name: "leanish/nullability",
            clone_url: "https://github.com/leanish/nullability.git",
            default_branch: "main",
            description: "",
            topics: [],
            size: 50,
            fork: false,
            archived: false,
            owner: {
              login: "leanish"
            }
          }
        ]);
      }

      if (url === "https://api.github.com/repos/leanish/nullability/topics") {
        return createJsonResponse(200, {
          names: ["null-safety"]
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    const inspectRepoFn = vi.fn(async () => ({
      description: "",
      topics: [],
      classifications: []
    }));

    const discovery = await discoverGithubOwnerReposWithToken({
      owner: "@accessible",
      fetchFn,
      inspectRepoFn,
      hydrateMetadata: false,
      inspectRepos: false
    });

    fetchFn.mockClear();

    const result = await refineDiscoveredGithubReposWithToken({
      discovery,
      fetchFn,
      inspectRepoFn,
      selectedRepoNames: ["leanish/nullability"]
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "nullability"
      }, {
        owns: ["null-safety"]
      })
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.github.com/repos/leanish/nullability/topics",
      expect.any(Object)
    );
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
            name: "ask-the-code",
            clone_url: "https://github.com/leanish/ask-the-code.git",
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

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "ask-the-code",
        url: "https://github.com/leanish/ask-the-code.git",
        defaultBranch: "main",
        description: "Repo-aware CLI for engineering Q&A with local Codex"
      }, {
        role: "developer-cli",
        owns: ["cli", "codex", "qa"]
      })
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

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects"
      }, {
        owns: ["gradle", "jdk"]
      })
    ]);
  });

  it("uses a larger fallback topic budget for massive repos and filters weak tokens", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/otherco") {
        return createJsonResponse(200, {
          login: "OtherCo",
          type: "Organization"
        });
      }

      if (url === "https://api.github.com/orgs/otherco/repos?per_page=100&page=1&sort=full_name&type=all") {
        return createJsonResponse(200, [
          {
            name: "dtv",
            clone_url: "https://github.com/OtherCo/dtv.git",
            default_branch: "master",
            description: "Checkout storefront onboarding pricing personalization recommendations search analytics sessions campaigns catalogs products can setup https implementation",
            topics: [],
            size: 150000,
            fork: false,
            archived: false
          }
        ]);
      }

      if (url === "https://api.github.com/repos/otherco/dtv/topics") {
        return createJsonResponse(200, {
          names: []
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "otherco",
      fetchFn,
      inspectRepoFn,
      inspectRepos: false,
      curateWithCodex: false
    });

    const firstRepo = result.repos[0];
    expect(firstRepo).toBeDefined();
    expect(firstRepo?.routing).toBeDefined();
    expect(firstRepo?.routing?.owns).toEqual([
      "checkout",
      "storefront",
      "onboarding",
      "pricing",
      "personalization",
      "recommendations",
      "search",
      "analytics"
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

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects"
      }, {
        owns: ["gradle", "jdk"]
      })
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

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "tiny-cli",
        url: "https://github.com/leanish/tiny-cli.git",
        defaultBranch: "main",
        description: "Tiny command line helper for demos"
      }, {
        role: "developer-cli",
        owns: ["command", "line", "helper"]
      })
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

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "shop-app",
        url: "https://github.com/leanish/shop-app.git",
        defaultBranch: "main",
        description: "Storefront frontend"
      }, {
        role: "frontend-application",
        owns: ["commerce", "storefront", "frontend"]
      })
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

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "terminator",
        url: "https://github.com/leanish/terminator.git",
        defaultBranch: "main",
        description: "Terminator is a small Java library that coordinates the orderly shutdown of heterogeneous services."
      }, {
        role: "shared-library",
        reach: ["shared-library"]
      })
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

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "billing-service",
        url: "https://github.com/leanish/billing-service.git",
        defaultBranch: "main",
        description: "Billing microservice GraphQL API"
      }, {
        role: "microservice",
        owns: ["payments", "microservice", "graphql", "api"]
      })
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

    const result = await discoverGithubOwnerReposWithoutAuth({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    expect(result.repos).toEqual([
      expectRepoRouting({
        name: "billing-platform",
        url: "https://github.com/leanish/billing-platform.git",
        defaultBranch: "main",
        description: "Billing GraphQL API"
      }, {
        role: "service-application",
        owns: ["graphql", "api"],
        reach: ["service-api", "internal-surface"]
      })
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

    const result = await discoverGithubOwnerReposWithToken({
      owner: "openai",
      fetchFn,
      inspectRepoFn
    }, "secret-token");

    expect(result.ownerType).toBe("Organization");
    expect(result.repos).toEqual([]);
  });

  it("throws a clear error when the owner does not exist", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async () => createJsonResponse(404, {
      message: "Not Found"
    }));

    await expect(discoverGithubOwnerReposWithoutAuth({
      owner: "missing-owner",
      fetchFn,
      inspectRepoFn
    })).rejects.toThrow("GitHub owner not found: missing-owner.");
  });

  it("throws an actionable error when GitHub rate limits discovery", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async () => createJsonResponse(403, {
      message: "API rate limit exceeded for 84.251.57.8."
    }));

    await expect(discoverGithubOwnerReposWithoutAuth({
      owner: "otherco",
      fetchFn,
      inspectRepoFn
    })).rejects.toThrow(
      "GitHub API rate limit exceeded while requesting /users/otherco. Authenticate discovery with GH_TOKEN or GITHUB_TOKEN, or retry later."
    );
  });

  it("plans additions, conflicts, and metadata suggestions against the current config", () => {
    const plan = planGithubRepoDiscovery(createLoadedConfig({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          defaultBranch: "main",
          description: "",
          routing: createEmptyRepoRouting(),
          aliases: ["shared"],
          alwaysSelect: false,
          directory: "/repos/foundation"
        }
      ]
    }), {
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
          routing: {
            ...createEmptyRepoRouting(),
            role: "infra-stack",
            owns: ["java", "gradle"]
          }
        },
        {
          name: "shared",
          url: "https://github.com/leanish/shared.git",
          defaultBranch: "main",
          description: "Shared utilities",
          routing: createEmptyRepoRouting()
        },
        {
          name: "ask-the-code",
          url: "https://github.com/leanish/ask-the-code.git",
          defaultBranch: "main",
          description: "Repo-aware CLI",
          routing: {
            ...createEmptyRepoRouting(),
            role: "developer-cli",
            owns: ["cli"]
          }
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
    expect(plan.entries.find(entry => entry.repo.name === "ask-the-code")).toMatchObject({
      status: "new",
      repo: {
        name: "ask-the-code"
      }
    });
    expect(plan.entries.find(entry => entry.repo.name === "foundation")).toMatchObject({
      status: "configured",
      repo: {
        name: "foundation"
      },
      suggestions: [
        "add description from GitHub",
        "review routing"
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
      expectRepoRouting({
        name: "ask-the-code",
        url: "https://github.com/leanish/ask-the-code.git",
        defaultBranch: "main",
        description: "Repo-aware CLI"
      }, {
        role: "developer-cli",
        owns: ["cli"]
      })
    ]);
  });

  it("does not suggest a url review when configured SSH and GitHub HTTPS URLs point to the same repo", () => {
    const plan = planGithubRepoDiscovery(createLoadedConfig({
      repos: [
        {
          name: "foundation",
          url: "git@github.com:leanish/foundation.git",
          defaultBranch: "main",
          description: "",
          routing: createEmptyRepoRouting(),
          aliases: [],
          alwaysSelect: false,
          directory: "/repos/foundation"
        }
      ]
    }), {
      owner: "leanish",
      ownerType: "User",
      skippedForks: 0,
      skippedArchived: 0,
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          defaultBranch: "main",
          description: "",
          routing: createEmptyRepoRouting()
        }
      ]
    });

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]!.status).toBe("configured");
    expect(plan.entries[0]!.suggestions).not.toContain(
      "review url (git@github.com:leanish/foundation.git -> https://github.com/leanish/foundation.git)"
    );
  });

  it("does not suggest routing review when configured and discovered routing match", () => {
    const plan = planGithubRepoDiscovery(createLoadedConfig({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          defaultBranch: "main",
          description: "",
          routing: {
            ...createEmptyRepoRouting(),
            role: "frontend-application",
            owns: ["React"]
          },
          aliases: [],
          alwaysSelect: false,
          directory: "/repos/foundation"
        }
      ]
    }), {
      owner: "leanish",
      ownerType: "User",
      skippedForks: 0,
      skippedArchived: 0,
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          defaultBranch: "main",
          description: "",
          routing: {
            ...createEmptyRepoRouting(),
            role: "frontend-application",
            owns: ["React"]
          }
        }
      ]
    });

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]!.status).toBe("configured");
    expect(plan.entries[0]!.suggestions).not.toContain("review routing");
  });

  it("does not suggest routing review when routing field order differs", () => {
    const plan = planGithubRepoDiscovery(createLoadedConfig({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          defaultBranch: "main",
          description: "",
          routing: {
            role: "frontend-application",
            reach: [],
            responsibilities: [],
            owns: ["React"],
            exposes: [],
            consumes: [],
            workflows: [],
            boundaries: [],
            selectWhen: [],
            selectWithOtherReposWhen: []
          },
          aliases: [],
          alwaysSelect: false,
          directory: "/repos/foundation"
        }
      ]
    }), {
      owner: "leanish",
      ownerType: "User",
      skippedForks: 0,
      skippedArchived: 0,
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          defaultBranch: "main",
          description: "",
          routing: {
            owns: ["React"],
            role: "frontend-application",
            selectWhen: [],
            boundaries: [],
            exposes: [],
            consumes: [],
            workflows: [],
            responsibilities: [],
            reach: [],
            selectWithOtherReposWhen: []
          }
        }
      ]
    });

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]!.status).toBe("configured");
    expect(plan.entries[0]!.suggestions).not.toContain("review routing");
  });

  it("qualifies owner-colliding repo names so they can coexist", () => {
    const plan = planGithubRepoDiscovery(createLoadedConfig({
      repos: [
        {
          name: "nullability",
          url: "https://github.com/leanish/nullability.git",
          defaultBranch: "main",
          description: "",
          routing: createEmptyRepoRouting(),
          aliases: [],
          alwaysSelect: false,
          directory: "/repos/nullability"
        }
      ]
    }), {
      owner: "@accessible",
      ownerDisplay: "leanish + orgs",
      ownerType: "Accessible",
      skippedForks: 0,
      skippedArchived: 0,
      repos: [
        {
          name: "nullability",
          sourceOwner: "leanish",
          sourceFullName: "leanish/nullability",
          url: "https://github.com/leanish/nullability.git",
          defaultBranch: "main",
          description: "",
          routing: createEmptyRepoRouting()
        },
        {
          name: "nullability",
          sourceOwner: "OtherCo",
          sourceFullName: "OtherCo/nullability",
          url: "https://github.com/OtherCo/nullability.git",
          defaultBranch: "main",
          description: "",
          routing: createEmptyRepoRouting()
        }
      ]
    });

    expect(plan.counts).toEqual({
      discovered: 2,
      configured: 1,
      new: 1,
      conflicts: 0,
      withSuggestions: 0
    });
    expect(plan.entries.find(entry => entry.repo.sourceFullName === "leanish/nullability")).toMatchObject({
      status: "configured",
      configuredRepo: {
        name: "nullability",
        url: "https://github.com/leanish/nullability.git"
      }
    });
    expect(plan.entries.find(entry => entry.repo.sourceFullName === "OtherCo/nullability")).toMatchObject({
      status: "new",
      repo: {
        name: "otherco/nullability",
        sourceFullName: "OtherCo/nullability",
        url: "https://github.com/OtherCo/nullability.git"
      }
    });
  });
});

function createJsonResponse(status: number, value: unknown) {
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
