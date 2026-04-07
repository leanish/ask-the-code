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
  const repos = parsed.repos.map((repo, index) => normalizeRepo(repo, index, managedReposRoot, configPath));
  validateUniqueRepoIdentifiers(repos, configPath);

  return {
    configPath,
    managedReposRoot,
    repos
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

export async function appendReposToConfig({
  env = process.env,
  repos
}) {
  if (!Array.isArray(repos)) {
    throw new Error('appendReposToConfig requires a "repos" array.');
  }

  const configPath = getConfigPath(env);
  const raw = await readConfigFile(configPath);
  const parsed = parseConfigJson(configPath, raw);

  if (!Array.isArray(parsed.repos)) {
    throw new Error(`Invalid Archa config at ${configPath}: "repos" must be an array.`);
  }

  const normalizedExistingRepos = normalizeRepoDefinitions(parsed.repos, configPath);
  const normalizedNewRepos = normalizeRepoDefinitions(repos, configPath);
  const nextRepos = [...normalizedExistingRepos, ...normalizedNewRepos];
  validateUniqueRepoIdentifiers(nextRepos, configPath);

  parsed.repos = nextRepos;
  await fs.writeFile(configPath, JSON.stringify(parsed, null, 2) + "\n");

  return {
    configPath,
    addedCount: normalizedNewRepos.length,
    totalCount: nextRepos.length
  };
}

export async function applyGithubDiscoveryToConfig({
  env = process.env,
  reposToAdd = [],
  reposToOverride = []
}) {
  if (!Array.isArray(reposToAdd)) {
    throw new Error('applyGithubDiscoveryToConfig requires a "reposToAdd" array.');
  }

  if (!Array.isArray(reposToOverride)) {
    throw new Error('applyGithubDiscoveryToConfig requires a "reposToOverride" array.');
  }

  const configPath = getConfigPath(env);
  const raw = await readConfigFile(configPath);
  const parsed = parseConfigJson(configPath, raw);

  if (!Array.isArray(parsed.repos)) {
    throw new Error(`Invalid Archa config at ${configPath}: "repos" must be an array.`);
  }

  const normalizedExistingRepos = normalizeRepoDefinitions(parsed.repos, configPath);
  const normalizedAdditions = normalizeRepoDefinitions(reposToAdd, configPath);
  const normalizedOverrides = normalizeRepoDefinitions(reposToOverride, configPath);
  const overridesByName = new Map(
    normalizedOverrides.map(repo => [repo.name.toLowerCase(), repo])
  );

  for (const repoToOverride of normalizedOverrides) {
    if (!normalizedExistingRepos.some(existingRepo => existingRepo.name.toLowerCase() === repoToOverride.name.toLowerCase())) {
      throw new Error(`Cannot override missing repo "${repoToOverride.name}" in ${configPath}.`);
    }
  }

  const nextRepos = normalizedExistingRepos.map(existingRepo => {
    const overrideRepo = overridesByName.get(existingRepo.name.toLowerCase());

    if (!overrideRepo) {
      return existingRepo;
    }

    return mergeDiscoveredRepo(existingRepo, overrideRepo);
  });

  nextRepos.push(...normalizedAdditions);

  validateUniqueRepoIdentifiers(nextRepos, configPath);

  parsed.repos = nextRepos;
  await fs.writeFile(configPath, JSON.stringify(parsed, null, 2) + "\n");

  return {
    configPath,
    addedCount: normalizedAdditions.length,
    overriddenCount: normalizedOverrides.length,
    totalCount: nextRepos.length
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
    classifications: normalizeClassifications(repo.classifications, repo.name, sourcePath),
    aliases: normalizeAliases(repo.aliases, repo.name, sourcePath),
    alwaysSelect: repo.alwaysSelect === true
  };
}

function normalizeRepoDefinitions(repos, sourcePath) {
  return repos.map((repo, index) => normalizeRepoDefinition(repo, index, sourcePath));
}

function mergeDiscoveredRepo(existingRepo, discoveredRepo) {
  return {
    ...existingRepo,
    url: discoveredRepo.url,
    defaultBranch: discoveredRepo.defaultBranch,
    description: discoveredRepo.description,
    topics: discoveredRepo.topics,
    classifications: discoveredRepo.classifications
  };
}

async function importCatalog(catalogPath) {
  const raw = await fs.readFile(catalogPath, "utf8");
  const parsed = parseConfigJson(catalogPath, raw);

  if (!Array.isArray(parsed.repos)) {
    throw new Error(`Invalid catalog at ${catalogPath}: "repos" must be an array.`);
  }

  const repos = parsed.repos.map((repo, index) => {
    const normalizedRepo = normalizeRepoDefinition(repo, index, catalogPath);

    return {
      name: normalizedRepo.name,
      url: normalizedRepo.url,
      defaultBranch: normalizedRepo.defaultBranch,
      description: normalizedRepo.description,
      topics: normalizedRepo.topics,
      classifications: normalizedRepo.classifications,
      aliases: normalizedRepo.aliases,
      alwaysSelect: normalizedRepo.alwaysSelect
    };
  });

  validateUniqueRepoIdentifiers(repos, catalogPath);

  return repos;
}

function normalizeAliases(value, repoName, sourcePath) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${repoName}" has non-array "aliases".`);
  }

  if (!value.every(alias => typeof alias === "string" && alias.trim() !== "")) {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${repoName}" has non-string or empty aliases.`);
  }

  return value.map(alias => alias.trim());
}

function normalizeClassifications(value, repoName, sourcePath) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${repoName}" has non-array "classifications".`);
  }

  if (!value.every(item => typeof item === "string" && item.trim() !== "")) {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${repoName}" has non-string or empty classifications.`);
  }

  return value.map(item => item.trim().toLowerCase());
}

function validateUniqueRepoIdentifiers(repos, sourcePath) {
  const seenIdentifiers = new Map();

  for (const repo of repos) {
    for (const identifier of [repo.name, ...repo.aliases]) {
      const normalizedIdentifier = identifier.toLowerCase();
      const existingOwner = seenIdentifiers.get(normalizedIdentifier);

      if (existingOwner) {
        throw new Error(
          `Invalid Archa config at ${sourcePath}: duplicate repo identifier "${identifier}" for "${existingOwner}" and "${repo.name}". Repo names and aliases must be unique case-insensitively.`
        );
      }

      seenIdentifiers.set(normalizedIdentifier, repo.name);
    }
  }
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
