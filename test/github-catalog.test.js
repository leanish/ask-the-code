import { describe, expect, it, vi } from "vitest";

import {
  discoverGithubOwnerRepos,
  planGithubRepoDiscovery,
  refineDiscoveredGithubRepos
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
          name: "active-repo",
          url: "https://github.com/leanish/active-repo.git",
          defaultBranch: "main",
          description: "",
          topics: [],
          classifications: []
        }
      ],
      skippedForks: 0,
      skippedArchived: 0,
      skippedDisabled: 1
    });
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

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      env: {
        GH_TOKEN: "test-token"
      },
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
            name: "archa",
            full_name: "leanish/archa",
            clone_url: "https://github.com/leanish/archa.git",
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
            name: "playcart",
            full_name: "Nosto/playcart",
            clone_url: "https://github.com/Nosto/playcart.git",
            default_branch: "master",
            description: "Storefront backend",
            topics: ["play"],
            size: 50200,
            fork: false,
            archived: false,
            owner: {
              login: "Nosto"
            }
          }
        ]);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerRepos({
      owner: "@accessible",
      env: {
        GH_TOKEN: "test-token"
      },
      fetchFn,
      inspectRepoFn,
      hydrateMetadata: false,
      inspectRepos: false
    });

    expect(result).toEqual({
      owner: "@accessible",
      ownerDisplay: "leanish + orgs",
      ownerType: "Accessible",
      repos: [
        {
          name: "archa",
          url: "https://github.com/leanish/archa.git",
          defaultBranch: "main",
          description: "Repo-aware CLI",
          topics: ["cli"],
          classifications: [],
          sourceOwner: "leanish",
          sourceFullName: "leanish/archa"
        },
        {
          name: "playcart",
          url: "https://github.com/Nosto/playcart.git",
          defaultBranch: "master",
          description: "Storefront backend",
          topics: ["play"],
          classifications: [],
          sourceOwner: "Nosto",
          sourceFullName: "Nosto/playcart"
        }
      ],
      skippedForks: 0,
      skippedArchived: 0
    });
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
      type: "repo-curated",
      owner: "leanish",
      repoName: "archa",
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

    await discoverGithubOwnerRepos({
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
    let resolveFirstStarted;
    const firstStarted = new Promise(resolve => {
      resolveFirstStarted = resolve;
    });
    let resolveFirstInspection;
    const firstInspection = new Promise(resolve => {
      resolveFirstInspection = resolve;
    });
    const inspectRepoFn = vi.fn(async ({ repo }) => {
      if (repo.name === "archa") {
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

    const discoveryPromise = discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn
    });

    await firstStarted;

    expect(inspectRepoFn).toHaveBeenCalledTimes(1);
    expect(inspectRepoFn).toHaveBeenNthCalledWith(1, expect.objectContaining({
      repo: expect.objectContaining({
        name: "archa"
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
        topics: ["gradle", "jdk"],
        classifications: []
      }
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

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      inspectRepos: false,
      curateWithCodex: false,
      hydrateMetadata: false
    });

    expect(result.repos).toEqual([
      {
        name: "java-conventions",
        url: "https://github.com/leanish/java-conventions.git",
        defaultBranch: "main",
        description: "Shared Gradle conventions for JDK-based projects",
        topics: [],
        classifications: []
      }
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

    const result = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      selectedRepoNames: ["terminator"]
    });

    expect(result.repos).toEqual([
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

    const discovery = await discoverGithubOwnerRepos({
      owner: "leanish",
      fetchFn,
      inspectRepoFn,
      hydrateMetadata: false,
      inspectRepos: false
    });

    fetchFn.mockClear();

    const result = await refineDiscoveredGithubRepos({
      discovery,
      fetchFn,
      inspectRepoFn,
      selectedRepoNames: ["terminator"]
    });

    expect(result.repos).toEqual([
      {
        name: "terminator",
        url: "https://github.com/leanish/terminator.git",
        defaultBranch: "main",
        description: "Small Java library for orderly shutdown coordination.",
        topics: ["java", "shutdown"],
        classifications: ["library"]
      }
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

    const discovery = await discoverGithubOwnerRepos({
      owner: "@accessible",
      env: {
        GH_TOKEN: "test-token"
      },
      fetchFn,
      inspectRepoFn,
      hydrateMetadata: false,
      inspectRepos: false
    });

    fetchFn.mockClear();

    const result = await refineDiscoveredGithubRepos({
      discovery,
      env: {
        GH_TOKEN: "test-token"
      },
      fetchFn,
      inspectRepoFn,
      selectedRepoNames: ["leanish/nullability"]
    });

    expect(result.repos).toEqual([
      expect.objectContaining({
        name: "nullability",
        topics: ["null-safety"]
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
        topics: ["gradle", "jdk"],
        classifications: []
      }
    ]);
  });

  it("uses a larger fallback topic budget for massive repos and filters weak tokens", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async url => {
      if (url === "https://api.github.com/users/nosto") {
        return createJsonResponse(200, {
          login: "Nosto",
          type: "Organization"
        });
      }

      if (url === "https://api.github.com/orgs/nosto/repos?per_page=100&page=1&sort=full_name&type=all") {
        return createJsonResponse(200, [
          {
            name: "playcart",
            clone_url: "https://github.com/Nosto/playcart.git",
            default_branch: "master",
            description: "Nosto checkout storefront onboarding pricing personalization recommendations search analytics sessions campaigns catalogs products can setup https implementation",
            topics: [],
            size: 150000,
            fork: false,
            archived: false
          }
        ]);
      }

      if (url === "https://api.github.com/repos/nosto/playcart/topics") {
        return createJsonResponse(200, {
          names: []
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverGithubOwnerRepos({
      owner: "nosto",
      fetchFn,
      inspectRepoFn,
      inspectRepos: false,
      curateWithCodex: false
    });

    expect(result.repos[0].topics).toEqual([
      "checkout",
      "storefront",
      "onboarding",
      "pricing",
      "personalization",
      "recommendations",
      "search",
      "analytics",
      "sessions",
      "campaigns",
      "catalogs",
      "products"
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
        topics: ["gradle", "jdk"],
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
        topics: ["command", "line", "helper"],
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
        topics: ["payments", "microservice", "graphql", "api"],
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
        topics: ["graphql", "api"],
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

  it("throws an actionable error when GitHub rate limits discovery", async () => {
    const inspectRepoFn = vi.fn(async () => []);
    const fetchFn = vi.fn(async () => createJsonResponse(403, {
      message: "API rate limit exceeded for 84.251.57.8."
    }));

    await expect(discoverGithubOwnerRepos({
      owner: "nosto",
      fetchFn,
      inspectRepoFn
    })).rejects.toThrow(
      "GitHub API rate limit exceeded while requesting /users/nosto. Authenticate discovery with GH_TOKEN or GITHUB_TOKEN, or retry later."
    );
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

  it("qualifies owner-colliding repo names so they can coexist", () => {
    const plan = planGithubRepoDiscovery({
      repos: [
        {
          name: "nullability",
          url: "https://github.com/leanish/nullability.git",
          defaultBranch: "main",
          description: "",
          topics: [],
          classifications: [],
          aliases: [],
          directory: "/repos/nullability"
        }
      ]
    }, {
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
          topics: [],
          classifications: []
        },
        {
          name: "nullability",
          sourceOwner: "Nosto",
          sourceFullName: "Nosto/nullability",
          url: "https://github.com/Nosto/nullability.git",
          defaultBranch: "main",
          description: "",
          topics: [],
          classifications: []
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
    expect(plan.entries.find(entry => entry.repo.sourceFullName === "Nosto/nullability")).toMatchObject({
      status: "new",
      repo: {
        name: "nosto/nullability",
        sourceFullName: "Nosto/nullability",
        url: "https://github.com/Nosto/nullability.git"
      }
    });
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
