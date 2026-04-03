import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeConfig, loadConfig } from "../src/config.js";
import { getConfigPath, getDefaultManagedReposRoot } from "../src/config-paths.js";

describe("config", () => {
  let tempRoot;
  let env;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "archa-config-"));
    env = {
      XDG_CONFIG_HOME: path.join(tempRoot, "config"),
      XDG_DATA_HOME: path.join(tempRoot, "data")
    };
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("resolves config and managed repo paths from xdg defaults", () => {
    expect(getConfigPath(env)).toBe(path.join(tempRoot, "config", "archa", "config.json"));
    expect(getDefaultManagedReposRoot(env)).toBe(path.join(tempRoot, "data", "archa", "repos"));
  });

  it("prefers an explicit ARCHA_CONFIG_PATH override", () => {
    expect(getConfigPath({
      ...env,
      ARCHA_CONFIG_PATH: "/tmp/custom-archa-config.json"
    })).toBe("/tmp/custom-archa-config.json");
  });

  it("falls back to home-based paths when xdg env vars are absent", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue("/tmp/home");

    expect(getConfigPath({})).toBe("/tmp/home/.config/archa/config.json");
    expect(getDefaultManagedReposRoot({})).toBe("/tmp/home/.local/share/archa/repos");

    homedirSpy.mockRestore();
  });

  it("initializes an empty config with the default managed repos root", async () => {
    const result = await initializeConfig({ env });
    const loaded = await loadConfig(env);

    expect(result.configPath).toBe(path.join(tempRoot, "config", "archa", "config.json"));
    expect(result.managedReposRoot).toBe(path.join(tempRoot, "data", "archa", "repos"));
    expect(result.repoCount).toBe(0);
    expect(loaded.managedReposRoot).toBe(path.join(tempRoot, "data", "archa", "repos"));
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
      {
        name: "sqs-codec",
        url: "https://github.com/leanish/sqs-codec.git",
        defaultBranch: "main",
        description: "SQS execution interceptor with compression and checksum metadata",
        topics: ["aws", "sqs"],
        aliases: ["codec"],
        directory: "/workspace/managed-repos/sqs-codec"
      }
    ]);
  });

  it("throws a clear error when the config file is missing", async () => {
    await expect(loadConfig(env)).rejects.toThrow(
      `Archa config not found at ${path.join(tempRoot, "config", "archa", "config.json")}. Run "archa config init" or set ARCHA_CONFIG_PATH.`
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

    await expect(loadConfig(env)).rejects.toThrow(/Invalid Archa config/);
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
          topics: [],
          aliases: [],
          directory: path.join(tempRoot, "data", "archa", "repos", "sqs-codec")
        }
      ]
    });

    const loaded = await loadConfig(env);
    expect(loaded.repos[0]).not.toHaveProperty("unexpectedField");
  });
});
