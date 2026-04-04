import fs from "node:fs/promises";
import path from "node:path";

import { getConfigPath, getDefaultManagedReposRoot } from "./config-paths.js";

export async function loadConfig(env = process.env) {
  const configPath = getConfigPath(env);
  const raw = await readConfigFile(configPath);
  const parsed = parseConfigJson(configPath, raw);

  if (!Array.isArray(parsed.repos)) {
    throw new Error(`Invalid Archa config at ${configPath}: "repos" must be an array.`);
  }

  const managedReposRoot = parsed.managedReposRoot || getDefaultManagedReposRoot(env);

  return {
    configPath,
    managedReposRoot,
    repos: parsed.repos.map((repo, index) => normalizeRepo(repo, index, managedReposRoot, configPath))
  };
}

export async function initializeConfig({
  env = process.env,
  catalogPath = null,
  managedReposRoot = null,
  force = false
} = {}) {
  const configPath = getConfigPath(env);
  const resolvedManagedReposRoot = managedReposRoot || getDefaultManagedReposRoot(env);

  if (!force && await exists(configPath)) {
    throw new Error(`Archa config already exists at ${configPath}. Use --force to overwrite it.`);
  }

  const repos = catalogPath ? await importCatalog(catalogPath) : [];

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({
    managedReposRoot: resolvedManagedReposRoot,
    repos
  }, null, 2) + "\n");

  return {
    configPath,
    managedReposRoot: resolvedManagedReposRoot,
    repoCount: repos.length
  };
}

async function readConfigFile(configPath) {
  try {
    return await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Archa config not found at ${configPath}. Run "archa config init" or set ARCHA_CONFIG_PATH.`);
    }
    throw error;
  }
}

function parseConfigJson(configPath, raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Archa config at ${configPath}: ${message}`);
  }
}

function normalizeRepo(repo, index, managedReposRoot, configPath) {
  const normalizedRepo = normalizeRepoDefinition(repo, index, configPath);

  return {
    ...normalizedRepo,
    directory: path.join(managedReposRoot, normalizedRepo.name)
  };
}

function normalizeRepoDefinition(repo, index, sourcePath) {
  if (!repo || typeof repo !== "object") {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo #${index + 1} must be an object.`);
  }

  if (!repo.name || typeof repo.name !== "string") {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo #${index + 1} is missing a string "name".`);
  }

  if (!repo.url || typeof repo.url !== "string") {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${repo.name}" is missing a string "url".`);
  }

  if (repo.alwaysSelect != null && typeof repo.alwaysSelect !== "boolean") {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${repo.name}" has non-boolean "alwaysSelect".`);
  }

  return {
    name: repo.name,
    url: repo.url,
    defaultBranch: repo.defaultBranch || repo.branch || "main",
    description: repo.description || "",
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    aliases: Array.isArray(repo.aliases) ? repo.aliases : [],
    alwaysSelect: repo.alwaysSelect === true
  };
}

async function importCatalog(catalogPath) {
  const raw = await fs.readFile(catalogPath, "utf8");
  const parsed = parseConfigJson(catalogPath, raw);

  if (!Array.isArray(parsed.repos)) {
    throw new Error(`Invalid catalog at ${catalogPath}: "repos" must be an array.`);
  }

  return parsed.repos.map((repo, index) => {
    const normalizedRepo = normalizeRepoDefinition(repo, index, catalogPath);

    return {
      name: normalizedRepo.name,
      url: normalizedRepo.url,
      defaultBranch: normalizedRepo.defaultBranch,
      description: normalizedRepo.description,
      topics: normalizedRepo.topics,
      aliases: normalizedRepo.aliases,
      alwaysSelect: normalizedRepo.alwaysSelect
    };
  });
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
