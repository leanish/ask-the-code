import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendReposToConfig, applyGithubDiscoveryToConfig, initializeConfig, loadConfig } from "../src/core/config/config.js";
import { getConfigPath, getDefaultManagedReposRoot } from "../src/core/config/config-paths.js";
import { createEmptyRepoRouting } from "../src/core/repos/repo-routing.js";

describe("config", () => {
  let tempRoot: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ask-the-code-config-"));
    env = {
      XDG_CONFIG_HOME: path.join(tempRoot, "config"),
      XDG_DATA_HOME: path.join(tempRoot, "data")
    };
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("resolves config and managed repo paths from xdg defaults", () => {
    expect(getConfigPath(env)).toBe(path.join(tempRoot, "config", "atc", "config.json"));
    expect(getDefaultManagedReposRoot(env)).toBe(path.join(tempRoot, "data", "atc", "repos"));
  });

  it("prefers an explicit ATC_CONFIG_PATH override", () => {
    expect(getConfigPath({
      ...env,
      ATC_CONFIG_PATH: "/tmp/custom-atc-config.json"
    })).toBe("/tmp/custom-atc-config.json");
  });

  it("falls back to home-based paths when xdg env vars are absent", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue("/tmp/home");

    expect(getConfigPath({})).toBe("/tmp/home/.config/atc/config.json");
    expect(getDefaultManagedReposRoot({})).toBe("/tmp/home/.local/share/atc/repos");

    homedirSpy.mockRestore();
  });

  it("initializes an empty config with the default managed repos root", async () => {
    const result = await initializeConfig({ env });
    const loaded = await loadConfig(env);

    expect(result.configPath).toBe(path.join(tempRoot, "config", "atc", "config.json"));
    expect(result.managedReposRoot).toBe(path.join(tempRoot, "data", "atc", "repos"));
    expect(result.repoCount).toBe(0);
    expect(loaded.managedReposRoot).toBe(path.join(tempRoot, "data", "atc", "repos"));
    expect(loaded.repos).toEqual([]);
  });

  it("imports repo definitions from a catalog file", async () => {
    const catalogPath = path.join(tempRoot, "catalog.json");
    await fs.writeFile(catalogPath, JSON.stringify({
      repos: [
        {
          name: "sqs-codec",
          url: "https://github.com/leanish/sqs-codec.git",
          branch: "main",
          description: "SQS execution interceptor with compression and checksum metadata",
          topics: ["aws", "sqs"],
          aliases: ["codec"]
        }
      ]
    }, null, 2));

    await initializeConfig({
      env,
      catalogPath,
      managedReposRoot: "/workspace/managed-repos"
    });

    const loaded = await loadConfig(env);

    expect(loaded.managedReposRoot).toBe("/workspace/managed-repos");
    expect(loaded.repos).toEqual([
      expect.objectContaining({
        name: "sqs-codec",
        url: "https://github.com/leanish/sqs-codec.git",
        defaultBranch: "main",
        description: "SQS execution interceptor with compression and checksum metadata",
        routing: expect.objectContaining({
          owns: ["aws", "sqs"]
        }),
        aliases: ["codec"],
        alwaysSelect: false,
        directory: "/workspace/managed-repos/leanish/sqs-codec"
      })
    ]);
  });

  it("drops unknown repo fields when importing repo definitions from a catalog file", async () => {
    const catalogPath = path.join(tempRoot, "catalog.json");
    await fs.writeFile(catalogPath, JSON.stringify({
      repos: [
        {
          name: "sqs-codec",
          url: "https://github.com/leanish/sqs-codec.git",
          branch: "main",
          description: "SQS execution interceptor with compression and checksum metadata",
          aliases: ["codec"],
          alwaysSelect: true,
          sourceFullName: "leanish/sqs-codec",
          unexpectedField: "should-not-leak"
        }
      ]
    }, null, 2));

    await initializeConfig({
      env,
      catalogPath
    });

    const persistedConfig = JSON.parse(await fs.readFile(getConfigPath(env), "utf8")) as {
      repos: unknown[];
    };

    expect(persistedConfig.repos).toEqual([
      {
        name: "sqs-codec",
        url: "https://github.com/leanish/sqs-codec.git",
        defaultBranch: "main",
        description: "SQS execution interceptor with compression and checksum metadata",
        routing: createEmptyRepoRouting(),
        aliases: ["codec"],
        alwaysSelect: true
      }
    ]);
  });

  it("migrates legacy topics and classifications into a draft routing card when routing is missing", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      repos: [
        {
          name: "java-conventions",
          url: "https://github.com/leanish/java-conventions.git",
          defaultBranch: "main",
          description: "Shared Gradle conventions for Java builds",
          topics: ["gradle", "java"],
          classifications: ["library", "internal"]
        }
      ]
    }, null, 2));

    await expect(loadConfig(env)).resolves.toMatchObject({
      repos: [
        {
          name: "java-conventions",
          routing: {
            role: "shared-library",
            reach: ["shared-library", "internal-surface"],
            owns: ["gradle", "java"],
            boundaries: ["Do not select only because another repo depends on this library."]
          }
        }
      ]
    });
  });

  it("maps owner-qualified repo names to owner-scoped checkout directories", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      repos: [
        {
          name: "leanish/nullability",
          url: "https://github.com/leanish/nullability.git",
          defaultBranch: "main"
        }
      ]
    }, null, 2));

    const loaded = await loadConfig(env);

    expect(loaded.repos).toEqual([
      {
        name: "leanish/nullability",
        url: "https://github.com/leanish/nullability.git",
        defaultBranch: "main",
        description: "",
        routing: createEmptyRepoRouting(),
        aliases: [],
        alwaysSelect: false,
        directory: path.join(tempRoot, "data", "atc", "repos", "leanish", "nullability")
      }
    ]);
  });

  it("derives GitHub checkout directories from the GitHub owner without lowercasing it", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      repos: [
        {
          name: "dtv",
          url: "https://github.com/OtherCo/dtv.git",
          defaultBranch: "main"
        }
      ]
    }, null, 2));

    const loaded = await loadConfig(env);

    expect(loaded.repos).toEqual([
      {
        name: "dtv",
        url: "https://github.com/OtherCo/dtv.git",
        defaultBranch: "main",
        description: "",
        routing: createEmptyRepoRouting(),
        aliases: [],
        alwaysSelect: false,
        directory: path.join(tempRoot, "data", "atc", "repos", "OtherCo", "dtv")
      }
    ]);
  });

  it("throws a clear error when the config file is missing", async () => {
    await expect(loadConfig(env)).rejects.toThrow(
      `ask-the-code config not found at ${path.join(tempRoot, "config", "atc", "config.json")}. Run "atc config init" or set ATC_CONFIG_PATH.`
    );
  });

  it("rejects invalid config payloads", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ repos: [{}] }));

    await expect(loadConfig(env)).rejects.toThrow(/missing a string "name"/);
  });

  it("rejects configs where repos is not an array", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ repos: {} }));

    await expect(loadConfig(env)).rejects.toThrow(/"repos" must be an array/);
  });

  it("rejects invalid json config files", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, "{not-json");

    await expect(loadConfig(env)).rejects.toThrow(/Invalid ask-the-code config/);
  });

  it("rejects repos missing a url", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      repos: [
        {
          name: "sqs-codec"
        }
      ]
    }));

    await expect(loadConfig(env)).rejects.toThrow(/missing a string "url"/);
  });

  it("surfaces non-missing config read errors", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(configPath, { recursive: true });

    await expect(loadConfig(env)).rejects.toThrow();
  });

  it("refuses to overwrite an existing config without force", async () => {
    await initializeConfig({ env });

    await expect(initializeConfig({ env })).rejects.toThrow(/already exists/);
  });

  it("allows overwriting an existing config with force", async () => {
    await initializeConfig({ env });

    const result = await initializeConfig({
      env,
      force: true,
      managedReposRoot: "/workspace/override"
    });

    expect(result.managedReposRoot).toBe("/workspace/override");
  });

  it("rejects imported catalogs whose repos field is not an array", async () => {
    const catalogPath = path.join(tempRoot, "catalog.json");
    await fs.writeFile(catalogPath, JSON.stringify({ repos: {} }));

    await expect(initializeConfig({
      env,
      catalogPath
    })).rejects.toThrow(/Invalid catalog/);
  });

  it("rejects imported catalogs with invalid repo entries before writing config", async () => {
    const catalogPath = path.join(tempRoot, "catalog.json");
    const configPath = getConfigPath(env);
    await fs.writeFile(catalogPath, JSON.stringify({
      repos: [
        {
          url: "https://github.com/leanish/sqs-codec.git"
        }
      ]
    }));

    await expect(initializeConfig({
      env,
      catalogPath
    })).rejects.toThrow(/missing a string "name"/);

    await expect(fs.access(configPath)).rejects.toThrow();
  });

  it("drops unknown repo fields when loading config", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      repos: [
        {
          name: "sqs-codec",
          url: "https://github.com/leanish/sqs-codec.git",
          branch: "main",
          unexpectedField: "should-not-leak"
        }
      ]
    }));

    await expect(loadConfig(env)).resolves.toMatchObject({
      repos: [
        {
          name: "sqs-codec",
          url: "https://github.com/leanish/sqs-codec.git",
          defaultBranch: "main",
          description: "",
          routing: createEmptyRepoRouting(),
          aliases: [],
          alwaysSelect: false,
          directory: path.join(tempRoot, "data", "atc", "repos", "leanish", "sqs-codec")
        }
      ]
    });

    const loaded = await loadConfig(env);
    expect(loaded.repos[0]).not.toHaveProperty("unexpectedField");
  });

  it("preserves alwaysSelect when loading and importing repos", async () => {
    const catalogPath = path.join(tempRoot, "catalog.json");
    await fs.writeFile(catalogPath, JSON.stringify({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          alwaysSelect: true
        }
      ]
    }, null, 2));

    await initializeConfig({
      env,
      catalogPath
    });

    await expect(loadConfig(env)).resolves.toMatchObject({
      repos: [
        {
          name: "foundation",
          alwaysSelect: true
        }
      ]
    });
  });

  it("rejects non-boolean alwaysSelect values", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          alwaysSelect: "yes"
        }
      ]
    }));

    await expect(loadConfig(env)).rejects.toThrow(/non-boolean "alwaysSelect"/);
  });

  it("rejects aliases that are not arrays of non-empty strings", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          aliases: ["shared", 7]
        }
      ]
    }));

    await expect(loadConfig(env)).rejects.toThrow(/non-string or empty aliases/);
  });

  it("rejects routing values that are not objects", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          routing: ["infra"]
        }
      ]
    }));

    await expect(loadConfig(env)).rejects.toThrow(/non-object "routing"/);
  });

  it("rejects routing arrays with non-string entries", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          routing: {
            owns: ["platform", 7]
          }
        }
      ]
    }));

    await expect(loadConfig(env)).rejects.toThrow(/non-string or empty owns/);
  });

  it("rejects duplicate repo names case-insensitively", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git"
        },
        {
          name: "Foundation",
          url: "https://github.com/leanish/foundation-2.git"
        }
      ]
    }));

    await expect(loadConfig(env)).rejects.toThrow(/duplicate repo identifier "Foundation"/);
  });

  it("rejects alias collisions with another repo name", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          aliases: ["shared"]
        },
        {
          name: "shared",
          url: "https://github.com/leanish/shared.git"
        }
      ]
    }));

    await expect(loadConfig(env)).rejects.toThrow(/duplicate repo identifier "shared"/);
  });

  it("rejects imported catalogs with duplicate aliases before writing config", async () => {
    const catalogPath = path.join(tempRoot, "catalog.json");
    const configPath = getConfigPath(env);
    await fs.writeFile(catalogPath, JSON.stringify({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          aliases: ["shared"]
        },
        {
          name: "platform",
          url: "https://github.com/leanish/platform.git",
          aliases: ["Shared"]
        }
      ]
    }));

    await expect(initializeConfig({
      env,
      catalogPath
    })).rejects.toThrow(/duplicate repo identifier "Shared"/);

    await expect(fs.access(configPath)).rejects.toThrow();
  });

  it("appends discovered repos to an existing config", async () => {
    await initializeConfig({
      env,
      managedReposRoot: "/workspace/repos"
    });

    const result = await appendReposToConfig({
      env,
      repos: [
        {
          name: "ask-the-code",
          url: "https://github.com/leanish/ask-the-code.git",
          defaultBranch: "main",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          routing: {
            ...createEmptyRepoRouting(),
            role: "developer-cli",
            owns: ["repo selection", "question answering"],
            exposes: ["atc CLI", "atc-server"]
          }
        }
      ]
    });

    expect(result).toEqual({
      configPath: path.join(tempRoot, "config", "atc", "config.json"),
      addedCount: 1,
      totalCount: 1
    });
    await expect(loadConfig(env)).resolves.toMatchObject({
      managedReposRoot: "/workspace/repos",
      repos: [
        {
          name: "ask-the-code",
          url: "https://github.com/leanish/ask-the-code.git",
          defaultBranch: "main",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          routing: expect.objectContaining({
            role: "developer-cli",
            owns: ["repo selection", "question answering"],
            exposes: ["atc CLI", "atc-server"]
          })
        }
      ]
    });
  });

  it("normalizes existing repo definitions when appending discovered repos", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      managedReposRoot: "/workspace/repos",
      repos: [
        {
          name: "legacy-repo",
          url: "https://github.com/leanish/legacy-repo.git",
          branch: "master"
        }
      ]
    }, null, 2));

    await appendReposToConfig({
      env,
      repos: [
        {
          name: "ask-the-code",
          url: "https://github.com/leanish/ask-the-code.git",
          defaultBranch: "main",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          routing: {
            ...createEmptyRepoRouting(),
            role: "developer-cli",
            owns: ["repo selection", "question answering"],
            exposes: ["atc CLI", "atc-server"]
          }
        }
      ]
    });

    expect(JSON.parse(await fs.readFile(configPath, "utf8"))).toEqual({
      managedReposRoot: "/workspace/repos",
      repos: [
        {
          name: "legacy-repo",
          url: "https://github.com/leanish/legacy-repo.git",
          defaultBranch: "master",
          description: "",
          routing: createEmptyRepoRouting(),
          aliases: [],
          alwaysSelect: false
        },
        {
          name: "ask-the-code",
          url: "https://github.com/leanish/ask-the-code.git",
          defaultBranch: "main",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          routing: {
            ...createEmptyRepoRouting(),
            role: "developer-cli",
            owns: ["repo selection", "question answering"],
            exposes: ["atc CLI", "atc-server"]
          },
          aliases: [],
          alwaysSelect: false
        }
      ]
    });
  });

  it("applies selected GitHub discovery additions and overrides", async () => {
    await initializeConfig({
      env,
      managedReposRoot: "/workspace/repos"
    });

    await appendReposToConfig({
      env,
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          defaultBranch: "main",
          description: "",
          routing: {
            ...createEmptyRepoRouting(),
            role: "infra-stack"
          },
          aliases: ["shared"],
          alwaysSelect: true
        }
      ]
    });

    const result = await applyGithubDiscoveryToConfig({
      env,
      reposToAdd: [
        {
          name: "ask-the-code",
          url: "https://github.com/leanish/ask-the-code.git",
          defaultBranch: "main",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          routing: {
            ...createEmptyRepoRouting(),
            role: "developer-cli",
            owns: ["repo selection", "question answering"],
            exposes: ["atc CLI", "atc-server"]
          }
        }
      ],
      reposToOverride: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation-updated.git",
          defaultBranch: "trunk",
          description: "Shared base functionality",
          routing: {
            ...createEmptyRepoRouting(),
            role: "infra-stack",
            owns: ["shared platform base"],
            consumes: ["Gradle"]
          }
        }
      ]
    });

    expect(result).toEqual({
      configPath: path.join(tempRoot, "config", "atc", "config.json"),
      addedCount: 1,
      overriddenCount: 1,
      totalCount: 2
    });
    await expect(loadConfig(env)).resolves.toMatchObject({
      repos: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation-updated.git",
          defaultBranch: "trunk",
          description: "Shared base functionality",
          routing: expect.objectContaining({
            role: "infra-stack",
            owns: ["shared platform base"],
            consumes: ["Gradle"]
          }),
          aliases: ["shared"],
          alwaysSelect: true
        },
        {
          name: "ask-the-code",
          url: "https://github.com/leanish/ask-the-code.git",
          defaultBranch: "main",
          description: "Repo-aware CLI for engineering Q&A with local Codex",
          routing: expect.objectContaining({
            role: "developer-cli"
          })
        }
      ]
    });
  });

  it("normalizes untouched repo definitions when applying GitHub discovery changes", async () => {
    const configPath = getConfigPath(env);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      managedReposRoot: "/workspace/repos",
      repos: [
        {
          name: "legacy-repo",
          url: "https://github.com/leanish/legacy-repo.git",
          branch: "master",
          aliases: ["legacy"]
        },
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation.git",
          branch: "main",
          alwaysSelect: true
        }
      ]
    }, null, 2));

    await applyGithubDiscoveryToConfig({
      env,
      reposToAdd: [],
      reposToOverride: [
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation-updated.git",
          defaultBranch: "trunk",
          description: "Shared base functionality",
          routing: {
            ...createEmptyRepoRouting(),
            role: "infra-stack",
            owns: ["shared platform base"]
          }
        }
      ]
    });

    expect(JSON.parse(await fs.readFile(configPath, "utf8"))).toEqual({
      managedReposRoot: "/workspace/repos",
      repos: [
        {
          name: "legacy-repo",
          url: "https://github.com/leanish/legacy-repo.git",
          defaultBranch: "master",
          description: "",
          routing: createEmptyRepoRouting(),
          aliases: ["legacy"],
          alwaysSelect: false
        },
        {
          name: "foundation",
          url: "https://github.com/leanish/foundation-updated.git",
          defaultBranch: "trunk",
          description: "Shared base functionality",
          routing: {
            ...createEmptyRepoRouting(),
            role: "infra-stack",
            owns: ["shared platform base"]
          },
          aliases: [],
          alwaysSelect: true
        }
      ]
    });
  });
});
