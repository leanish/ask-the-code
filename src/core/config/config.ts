import fs from "node:fs/promises";
import path from "node:path";

import { getConfigPath, getDefaultManagedReposRoot } from "./config-paths.js";
import { getManagedRepoDirectory } from "../repos/repo-paths.js";
import type {
  ConfigMutationResult,
  Environment,
  InitializeConfigResult,
  LoadedConfig,
  ManagedRepo,
  ManagedRepoDefinition,
  RepoClassification
} from "../types.js";
import { REPO_CLASSIFICATIONS } from "../types.js";

type RawConfig = {
  managedReposRoot?: unknown;
  repos?: unknown;
};

type RawRepo = Record<string, unknown>;

const VALID_REPO_CLASSIFICATIONS = new Set<string>(REPO_CLASSIFICATIONS);

function isRepoClassification(value: string): value is RepoClassification {
  return VALID_REPO_CLASSIFICATIONS.has(value);
}

export async function loadConfig(env: Environment = process.env): Promise<LoadedConfig> {
  const configPath = getConfigPath(env);
  const raw = await readConfigFile(configPath);
  const parsed = parseConfigJson(configPath, raw);

  if (!Array.isArray(parsed.repos)) {
    throw new Error(`Invalid Archa config at ${configPath}: "repos" must be an array.`);
  }

  const managedReposRoot = typeof parsed.managedReposRoot === "string" && parsed.managedReposRoot.trim() !== ""
    ? parsed.managedReposRoot
    : getDefaultManagedReposRoot(env);
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
}: {
  env?: Environment;
  catalogPath?: string | null;
  managedReposRoot?: string | null;
  force?: boolean;
} = {}): Promise<InitializeConfigResult> {
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
}: {
  env?: Environment;
  repos: unknown[];
}): Promise<ConfigMutationResult> {
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
}: {
  env?: Environment;
  reposToAdd?: unknown[];
  reposToOverride?: unknown[];
} = {}): Promise<ConfigMutationResult> {
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

async function readConfigFile(configPath: string): Promise<string> {
  try {
    return await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Archa config not found at ${configPath}. Run "archa config init" or set ARCHA_CONFIG_PATH.`);
    }
    throw error;
  }
}

function parseConfigJson(configPath: string, raw: string): RawConfig {
  try {
    return JSON.parse(raw) as RawConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Archa config at ${configPath}: ${message}`);
  }
}

function normalizeRepo(repo: unknown, index: number, managedReposRoot: string, configPath: string): ManagedRepo {
  const normalizedRepo = normalizeRepoDefinition(repo, index, configPath);

  return {
    ...normalizedRepo,
    directory: getManagedRepoDirectory(managedReposRoot, normalizedRepo)
  };
}

function normalizeRepoDefinition(repo: unknown, index: number, sourcePath: string): ManagedRepoDefinition {
  if (!repo || typeof repo !== "object") {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo #${index + 1} must be an object.`);
  }

  const rawRepo = repo as RawRepo;

  if (!rawRepo.name || typeof rawRepo.name !== "string") {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo #${index + 1} is missing a string "name".`);
  }

  if (!rawRepo.url || typeof rawRepo.url !== "string") {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${rawRepo.name}" is missing a string "url".`);
  }

  if (rawRepo.alwaysSelect != null && typeof rawRepo.alwaysSelect !== "boolean") {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${rawRepo.name}" has non-boolean "alwaysSelect".`);
  }

  return {
    name: rawRepo.name,
    url: rawRepo.url,
    defaultBranch: typeof rawRepo.defaultBranch === "string"
      ? rawRepo.defaultBranch
      : typeof rawRepo.branch === "string"
        ? rawRepo.branch
        : "main",
    description: typeof rawRepo.description === "string" ? rawRepo.description : "",
    topics: Array.isArray(rawRepo.topics)
      ? rawRepo.topics.filter((topic): topic is string => typeof topic === "string")
      : [],
    classifications: normalizeClassifications(rawRepo.classifications, rawRepo.name, sourcePath),
    aliases: normalizeAliases(rawRepo.aliases, rawRepo.name, sourcePath),
    alwaysSelect: rawRepo.alwaysSelect === true
  };
}

function normalizeRepoDefinitions(repos: unknown[], sourcePath: string): ManagedRepoDefinition[] {
  return repos.map((repo, index) => normalizeRepoDefinition(repo, index, sourcePath));
}

function mergeDiscoveredRepo(
  existingRepo: ManagedRepoDefinition,
  discoveredRepo: ManagedRepoDefinition
): ManagedRepoDefinition {
  return {
    ...existingRepo,
    url: discoveredRepo.url,
    defaultBranch: discoveredRepo.defaultBranch,
    description: discoveredRepo.description,
    topics: discoveredRepo.topics,
    classifications: discoveredRepo.classifications
  };
}

async function importCatalog(catalogPath: string): Promise<ManagedRepoDefinition[]> {
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

function normalizeAliases(value: unknown, repoName: string, sourcePath: string): string[] {
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

function normalizeClassifications(value: unknown, repoName: string, sourcePath: string): RepoClassification[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${repoName}" has non-array "classifications".`);
  }

  if (!value.every(item => typeof item === "string" && item.trim() !== "")) {
    throw new Error(`Invalid Archa config at ${sourcePath}: repo "${repoName}" has non-string or empty classifications.`);
  }

  const normalizedClassifications = value.map(item => item.trim().toLowerCase());
  const invalidClassification = normalizedClassifications.find(classification => !isRepoClassification(classification));
  if (invalidClassification) {
    throw new Error(
      `Invalid Archa config at ${sourcePath}: repo "${repoName}" has unsupported classification "${invalidClassification}".`
    );
  }

  return normalizedClassifications.filter(isRepoClassification);
}

function validateUniqueRepoIdentifiers(repos: Array<Pick<ManagedRepoDefinition, "name" | "aliases">>, sourcePath: string): void {
  const seenIdentifiers = new Map<string, string>();

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

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
