import fs from "node:fs/promises";
import path from "node:path";

import {
  getConfigPath,
  getDefaultManagedReposRoot,
  getDefaultRepoCatalogPath
} from "./config-paths.js";
import { buildRepoRoutingDraft } from "../discovery/repo-routing-draft.js";
import { getManagedRepoDirectory } from "../repos/repo-paths.js";
import { createEmptyRepoRouting, normalizeRepoRouting } from "../repos/repo-routing.js";
import { REPO_CLASSIFICATIONS } from "../types.js";
import type {
  ConfigMutationResult,
  Environment,
  InitializeConfigResult,
  LoadedConfig,
  ManagedRepo,
  ManagedRepoDefinition,
  RepoClassification
} from "../types.js";

type RawControlConfig = {
  repoCatalogPath?: unknown;
  managedReposRoot?: unknown;
  repos?: unknown;
};

type RawRepoCatalog = {
  managedReposRoot?: unknown;
  repos?: unknown;
};

type RawRepo = Record<string, unknown>;

type ResolvedRepoCatalog = {
  managedReposRoot: string;
  repoCatalogPath: string;
  repoSourcePath: string;
  repos: unknown[];
};

const LEGACY_REPO_CLASSIFICATIONS = new Set<string>(REPO_CLASSIFICATIONS);

export async function loadConfig(env: Environment = process.env): Promise<LoadedConfig> {
  const configPath = getConfigPath(env);
  const rawControl = await readConfigFile(configPath);
  const parsedControl = parseConfigJson<RawControlConfig>(configPath, rawControl);
  const repoCatalog = await resolveRepoCatalog({
    env,
    configPath,
    parsedControl
  });
  const repos = repoCatalog.repos.map((repo, index) =>
    normalizeRepo(repo, index, repoCatalog.managedReposRoot, repoCatalog.repoSourcePath)
  );

  validateUniqueRepoIdentifiers(repos, repoCatalog.repoSourcePath);

  return {
    configPath,
    managedReposRoot: repoCatalog.managedReposRoot,
    repoCatalogPath: repoCatalog.repoCatalogPath,
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
  const repoCatalogPath = getDefaultRepoCatalogPath(env, resolvedManagedReposRoot);

  if (!force && await exists(configPath)) {
    throw new Error(`Archa config already exists at ${configPath}. Use --force to overwrite it.`);
  }

  if (!force && await exists(repoCatalogPath)) {
    throw new Error(`Archa repo catalog already exists at ${repoCatalogPath}. Use --force to overwrite it.`);
  }

  const repos = catalogPath ? await importCatalog(catalogPath) : [];

  await writeConfigControlFile(configPath, repoCatalogPath);
  await writeRepoCatalogFile(repoCatalogPath, {
    managedReposRoot: resolvedManagedReposRoot,
    repos
  });

  return {
    configPath,
    managedReposRoot: resolvedManagedReposRoot,
    repoCatalogPath,
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

  const context = await loadConfigMutationContext(env);
  const normalizedExistingRepos = normalizeRepoDefinitions(context.repos, context.repoSourcePath);
  const normalizedNewRepos = normalizeRepoDefinitions(repos, context.repoSourcePath);
  const nextRepos = [...normalizedExistingRepos, ...normalizedNewRepos];

  validateUniqueRepoIdentifiers(nextRepos, context.repoSourcePath);
  await persistRepoCatalog(context, nextRepos);

  return {
    configPath: context.configPath,
    repoCatalogPath: context.repoCatalogPath,
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

  const context = await loadConfigMutationContext(env);
  const normalizedExistingRepos = normalizeRepoDefinitions(context.repos, context.repoSourcePath);
  const normalizedAdditions = normalizeRepoDefinitions(reposToAdd, context.repoSourcePath);
  const normalizedOverrides = normalizeRepoDefinitions(reposToOverride, context.repoSourcePath);
  const overridesByName = new Map(
    normalizedOverrides.map(repo => [repo.name.toLowerCase(), repo])
  );

  for (const repoToOverride of normalizedOverrides) {
    if (!normalizedExistingRepos.some(existingRepo => existingRepo.name.toLowerCase() === repoToOverride.name.toLowerCase())) {
      throw new Error(`Cannot override missing repo "${repoToOverride.name}" in ${context.repoSourcePath}.`);
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

  validateUniqueRepoIdentifiers(nextRepos, context.repoSourcePath);
  await persistRepoCatalog(context, nextRepos);

  return {
    configPath: context.configPath,
    repoCatalogPath: context.repoCatalogPath,
    addedCount: normalizedAdditions.length,
    overriddenCount: normalizedOverrides.length,
    totalCount: nextRepos.length
  };
}

async function loadConfigMutationContext(env: Environment): Promise<{
  configPath: string;
  managedReposRoot: string;
  repoCatalogPath: string;
  repoSourcePath: string;
  repos: unknown[];
}> {
  const configPath = getConfigPath(env);
  const rawControl = await readConfigFile(configPath);
  const parsedControl = parseConfigJson<RawControlConfig>(configPath, rawControl);
  const repoCatalog = await resolveRepoCatalog({
    env,
    configPath,
    parsedControl
  });

  return {
    configPath,
    managedReposRoot: repoCatalog.managedReposRoot,
    repoCatalogPath: repoCatalog.repoCatalogPath,
    repoSourcePath: repoCatalog.repoSourcePath,
    repos: repoCatalog.repos
  };
}

async function persistRepoCatalog(
  context: {
    configPath: string;
    managedReposRoot: string;
    repoCatalogPath: string;
  },
  repos: ManagedRepoDefinition[]
): Promise<void> {
  await writeConfigControlFile(context.configPath, context.repoCatalogPath);
  await writeRepoCatalogFile(context.repoCatalogPath, {
    managedReposRoot: context.managedReposRoot,
    repos
  });
}

async function resolveRepoCatalog({
  env,
  configPath,
  parsedControl
}: {
  env: Environment;
  configPath: string;
  parsedControl: RawControlConfig;
}): Promise<ResolvedRepoCatalog> {
  if (hasInlineRepoCatalog(parsedControl)) {
    const managedReposRoot = resolveManagedReposRoot(parsedControl.managedReposRoot, env);

    return {
      managedReposRoot,
      repoCatalogPath: resolveRepoCatalogPath(parsedControl.repoCatalogPath, env, managedReposRoot),
      repoSourcePath: configPath,
      repos: expectReposArray(parsedControl.repos, configPath, "Invalid Archa config")
    };
  }

  const repoCatalogPath = resolveRepoCatalogPath(parsedControl.repoCatalogPath, env);
  const rawRepoCatalog = await readRepoCatalogFile(repoCatalogPath);
  const parsedRepoCatalog = parseConfigJson<RawRepoCatalog>(repoCatalogPath, rawRepoCatalog);

  return {
    managedReposRoot: resolveManagedReposRoot(parsedRepoCatalog.managedReposRoot, env),
    repoCatalogPath,
    repoSourcePath: repoCatalogPath,
    repos: expectReposArray(parsedRepoCatalog.repos, repoCatalogPath, "Invalid Archa repo catalog")
  };
}

function hasInlineRepoCatalog(value: RawControlConfig): boolean {
  return "repos" in value || value.managedReposRoot != null;
}

function resolveManagedReposRoot(value: unknown, env: Environment): string {
  return typeof value === "string" && value.trim() !== ""
    ? value
    : getDefaultManagedReposRoot(env);
}

function resolveRepoCatalogPath(
  value: unknown,
  env: Environment,
  managedReposRoot: string = getDefaultManagedReposRoot(env)
): string {
  return typeof value === "string" && value.trim() !== ""
    ? value
    : getDefaultRepoCatalogPath(env, managedReposRoot);
}

function expectReposArray(
  value: unknown,
  sourcePath: string,
  label: string
): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} at ${sourcePath}: "repos" must be an array.`);
  }

  return value;
}

async function writeConfigControlFile(configPath: string, repoCatalogPath: string): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({
    repoCatalogPath
  }, null, 2) + "\n");
}

async function writeRepoCatalogFile(
  repoCatalogPath: string,
  {
    managedReposRoot,
    repos
  }: {
    managedReposRoot: string;
    repos: ManagedRepoDefinition[];
  }
): Promise<void> {
  await fs.mkdir(path.dirname(repoCatalogPath), { recursive: true });
  await fs.writeFile(repoCatalogPath, JSON.stringify({
    managedReposRoot,
    repos
  }, null, 2) + "\n");
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

async function readRepoCatalogFile(repoCatalogPath: string): Promise<string> {
  try {
    return await fs.readFile(repoCatalogPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Archa repo catalog not found at ${repoCatalogPath}. Run "archa config init" to recreate it.`);
    }
    throw error;
  }
}

function parseConfigJson<T>(configPath: string, raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Archa config at ${configPath}: ${message}`);
  }
}

function normalizeRepo(repo: unknown, index: number, managedReposRoot: string, sourcePath: string): ManagedRepo {
  const normalizedRepo = normalizeRepoDefinition(repo, index, sourcePath);

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

  const description = typeof rawRepo.description === "string" ? rawRepo.description : "";

  return {
    name: rawRepo.name,
    url: rawRepo.url,
    defaultBranch: typeof rawRepo.defaultBranch === "string"
      ? rawRepo.defaultBranch
      : typeof rawRepo.branch === "string"
        ? rawRepo.branch
        : "main",
    description,
    routing: normalizeRepoRoutingWithLegacyFallback(rawRepo, {
      repoName: rawRepo.name,
      description,
      sourcePath
    }),
    aliases: normalizeAliases(rawRepo.aliases, rawRepo.name, sourcePath),
    alwaysSelect: rawRepo.alwaysSelect === true
  };
}

function normalizeRepoRoutingWithLegacyFallback(
  rawRepo: RawRepo,
  {
    repoName,
    description,
    sourcePath
  }: {
    repoName: string;
    description: string;
    sourcePath: string;
  }
) {
  if (rawRepo.routing != null) {
    return normalizeRepoRouting(rawRepo.routing, {
      repoName,
      sourcePath
    });
  }

  const legacyTopics = normalizeLegacyTopics(rawRepo.topics);
  const legacyClassifications = normalizeLegacyClassifications(rawRepo.classifications);
  if (legacyTopics.length === 0 && legacyClassifications.length === 0) {
    return createEmptyRepoRouting();
  }

  return buildRepoRoutingDraft({
    repoName,
    description,
    topics: legacyTopics,
    classifications: legacyClassifications
  });
}

function normalizeLegacyTopics(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();
    if (trimmed === "") {
      continue;
    }

    const normalizedKey = trimmed.toLowerCase();
    if (seen.has(normalizedKey)) {
      continue;
    }

    seen.add(normalizedKey);
    normalized.push(trimmed);
  }

  return normalized;
}

function normalizeLegacyClassifications(value: unknown): RepoClassification[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: RepoClassification[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim().toLowerCase();
    if (!LEGACY_REPO_CLASSIFICATIONS.has(trimmed) || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed as RepoClassification);
  }

  return normalized;
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
    routing: discoveredRepo.routing
  };
}

async function importCatalog(catalogPath: string): Promise<ManagedRepoDefinition[]> {
  const raw = await fs.readFile(catalogPath, "utf8");
  const parsed = parseConfigJson<RawRepoCatalog>(catalogPath, raw);
  const repos = expectReposArray(parsed.repos, catalogPath, "Invalid catalog").map((repo, index) => {
    const normalizedRepo = normalizeRepoDefinition(repo, index, catalogPath);

    return {
      name: normalizedRepo.name,
      url: normalizedRepo.url,
      defaultBranch: normalizedRepo.defaultBranch,
      description: normalizedRepo.description,
      routing: normalizedRepo.routing,
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
