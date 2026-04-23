import fs from "node:fs/promises";
import path from "node:path";

import { getConfigPath, getDefaultManagedReposRoot } from "./config-paths.js";
import { buildRepoRoutingDraft } from "../discovery/repo-routing-draft.js";
import { pathExists } from "../fs/path-exists.js";
import { getManagedRepoDirectory } from "../repos/repo-paths.js";
import { createEmptyRepoRouting, normalizeRepoRouting } from "../repos/repo-routing.js";
import { DEFAULT_REPO_TRUNK_BRANCH } from "../repos/constants.js";
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

type RawConfig = {
  managedReposRoot?: unknown;
  repos?: unknown;
};

type RawRepo = Record<string, unknown>;
const LEGACY_REPO_CLASSIFICATIONS = new Set<string>(REPO_CLASSIFICATIONS);
type ParsedConfigFile = {
  configPath: string;
  parsed: RawConfig;
  repos: unknown[];
};

export async function loadConfig(env: Environment = process.env): Promise<LoadedConfig> {
  const { configPath, parsed, repos: rawRepos } = await loadParsedConfigFile(env);
  const managedReposRoot = resolveManagedReposRoot(parsed.managedReposRoot, env);
  const repos = rawRepos.map((repo, index) => normalizeRepo(repo, index, managedReposRoot, configPath));
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

  if (!force && await pathExists(configPath)) {
    throw new Error(`ask-the-code config already exists at ${configPath}. Use --force to overwrite it.`);
  }

  const repos = catalogPath ? await importCatalog(catalogPath) : [];

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await writeJsonFile(configPath, {
    managedReposRoot: resolvedManagedReposRoot,
    repos
  });

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

  const { configPath, parsed, repos: rawRepos } = await loadParsedConfigFile(env);
  const normalizedExistingRepos = normalizeRepoDefinitions(rawRepos, configPath);
  const normalizedNewRepos = normalizeRepoDefinitions(repos, configPath);
  const nextRepos = [...normalizedExistingRepos, ...normalizedNewRepos];
  validateUniqueRepoIdentifiers(nextRepos, configPath);

  parsed.repos = nextRepos;
  await writeJsonFile(configPath, parsed);

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

  const { configPath, parsed, repos: rawRepos } = await loadParsedConfigFile(env);
  const normalizedExistingRepos = normalizeRepoDefinitions(rawRepos, configPath);
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
  await writeJsonFile(configPath, parsed);

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
      throw new Error(`ask-the-code config not found at ${configPath}. Run "atc config init" or set ATC_CONFIG_PATH.`);
    }
    throw error;
  }
}

function parseConfigJson(configPath: string, raw: string): RawConfig {
  try {
    return JSON.parse(raw) as RawConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ask-the-code config at ${configPath}: ${message}`);
  }
}

async function loadParsedConfigFile(env: Environment): Promise<ParsedConfigFile> {
  const configPath = getConfigPath(env);
  const raw = await readConfigFile(configPath);
  const parsed = parseConfigJson(configPath, raw);

  return {
    configPath,
    parsed,
    repos: getRawRepos(parsed, configPath, "ask-the-code config")
  };
}

function getRawRepos(parsed: RawConfig, sourcePath: string, sourceLabel: string): unknown[] {
  if (!Array.isArray(parsed.repos)) {
    throw new Error(`Invalid ${sourceLabel} at ${sourcePath}: "repos" must be an array.`);
  }

  return parsed.repos;
}

function resolveManagedReposRoot(value: unknown, env: Environment): string {
  return typeof value === "string" && value.trim() !== ""
    ? value
    : getDefaultManagedReposRoot(env);
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
    throw new Error(`Invalid ask-the-code config at ${sourcePath}: repo #${index + 1} must be an object.`);
  }

  const rawRepo = repo as RawRepo;

  if (!rawRepo.name || typeof rawRepo.name !== "string") {
    throw new Error(`Invalid ask-the-code config at ${sourcePath}: repo #${index + 1} is missing a string "name".`);
  }

  if (!rawRepo.url || typeof rawRepo.url !== "string") {
    throw new Error(`Invalid ask-the-code config at ${sourcePath}: repo "${rawRepo.name}" is missing a string "url".`);
  }

  if (rawRepo.alwaysSelect != null && typeof rawRepo.alwaysSelect !== "boolean") {
    throw new Error(`Invalid ask-the-code config at ${sourcePath}: repo "${rawRepo.name}" has non-boolean "alwaysSelect".`);
  }

  const description = typeof rawRepo.description === "string" ? rawRepo.description : "";

  return {
    name: rawRepo.name,
    url: rawRepo.url,
    defaultBranch: typeof rawRepo.defaultBranch === "string"
      ? rawRepo.defaultBranch
      : typeof rawRepo.branch === "string"
        ? rawRepo.branch
        : DEFAULT_REPO_TRUNK_BRANCH,
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
  const parsed = parseConfigJson(catalogPath, raw);
  const repos = normalizeRepoDefinitions(getRawRepos(parsed, catalogPath, "catalog"), catalogPath);

  validateUniqueRepoIdentifiers(repos, catalogPath);

  return repos;
}

function normalizeAliases(value: unknown, repoName: string, sourcePath: string): string[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid ask-the-code config at ${sourcePath}: repo "${repoName}" has non-array "aliases".`);
  }

  if (!value.every(alias => typeof alias === "string" && alias.trim() !== "")) {
    throw new Error(`Invalid ask-the-code config at ${sourcePath}: repo "${repoName}" has non-string or empty aliases.`);
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
          `Invalid ask-the-code config at ${sourcePath}: duplicate repo identifier "${identifier}" for "${existingOwner}" and "${repo.name}". Repo names and aliases must be unique case-insensitively.`
        );
      }

      seenIdentifiers.set(normalizedIdentifier, repo.name);
    }
  }
}
