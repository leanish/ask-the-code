import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { getDefaultManagedReposRoot } from "../config/config-paths.js";
import { normalizeGitExecutionError } from "../git/git-installation.js";
import { getManagedRepoDirectory, getManagedRepoRelativePath } from "../repos/repo-paths.js";
import {
  chooseRepoRoutingDescription,
  createEmptyRepoRouting,
  filterRepoRoutingConsumes
} from "../repos/repo-routing.js";
import { EXTERNAL_FACING_PHRASES, getMaxInferredTopics } from "./inference-constants.js";
import { buildRepoRoutingDraft } from "./repo-routing-draft.js";
import { curateRepoMetadataWithCodex } from "./repo-metadata-codex-curator.js";
import type { Environment, RepoClassification, RepoRecord, RepoRoutingMetadata } from "../types.js";

const FRONTEND_CONFIG_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "nuxt.config.js",
  "nuxt.config.ts",
  "angular.json",
  "svelte.config.js",
  "svelte.config.ts"
];
const FRONTEND_DIRECTORIES = [
  "pages",
  "components",
  "src/pages",
  "src/routes",
  "src/components"
];
const MOBILE_DIRECTORIES = ["android", "ios"];
const BACKEND_SURFACE_PATHS = [
  "conf/routes",
  "routes",
  "app/controllers",
  "src/main/java/controllers",
  "src/main/kotlin/controllers",
  "src/main/scala/controllers",
  "src/main/resources/routes"
];
const INFRA_DIRECTORIES = ["terraform", "charts", "helm", "k8s"];
const INFRA_FILE_SUFFIXES = [".tf", ".tfvars"];
const INFRA_FILENAMES = ["kustomization.yaml", "kustomization.yml"];
const README_CANDIDATES = ["README.md", "README.mdx", "README.txt", "readme.md"];
const FRONTEND_DEPENDENCIES = new Set(["react", "next", "vue", "nuxt", "svelte", "@angular/core", "react-native", "expo"]);
const BACKEND_DEPENDENCIES = new Set(["express", "fastify", "koa", "@nestjs/core", "hono", "graphql-yoga", "apollo-server"]);
const CLI_DEPENDENCIES = new Set(["commander", "yargs", "oclif", "clipanion", "cac"]);
const DESCRIPTION_MAX_LENGTH = 180;
// Deep inspection derives topics from README text, manifests, and dependency names,
// so this stop-word set is intentionally broader than the lightweight catalog one.
const TOPIC_STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "any",
  "application",
  "applications",
  "before",
  "based",
  "both",
  "build",
  "can",
  "called",
  "change",
  "changes",
  "client",
  "code",
  "com",
  "contributing",
  "coordinate",
  "coordinates",
  "distributed",
  "embedded",
  "feature",
  "features",
  "finish",
  "for",
  "from",
  "guide",
  "helper",
  "helpers",
  "heterogeneous",
  "how",
  "http",
  "https",
  "include",
  "includes",
  "implementation",
  "internally",
  "into",
  "issue",
  "issues",
  "its",
  "key",
  "license",
  "log",
  "once",
  "only",
  "orderly",
  "package",
  "project",
  "quick",
  "register",
  "run",
  "running",
  "same",
  "see",
  "setup",
  "small",
  "start",
  "suite",
  "test",
  "testing",
  "service",
  "services",
  "that",
  "the",
  "their",
  "them",
  "this",
  "through",
  "aware",
  "awaittermination",
  "main",
  "most",
  "non",
  "online",
  "stores",
  "support",
  "supports",
  "use",
  "used",
  "uses",
  "using",
  "views",
  "what",
  "with",
  "web",
  "where",
  "without",
  "you",
  "your"
]);
// These richer term lists intentionally go beyond the lightweight catalog keywords,
// because inspection has access to repository content and framework-specific signals.
const INTERNAL_TERMS = ["internal", "employee", "backoffice", "admin-only", "private"];
const LIBRARY_TERMS = ["library", "sdk", "module", "plugin", "package"];
const SERVICE_TERMS = ["microservice", "worker", "daemon"];
const PLAY_FRAMEWORK_TERMS = ["playframework", "com.typesafe.play", "play.mvc", "play.api"];
const NOISY_README_DOMAINS = ["img.shields.io"];
const TOOLCHAIN_ONLY_DESCRIPTION_TOKENS = new Set([
  "angular",
  "aws",
  "docker",
  "eslint",
  "go",
  "gradle",
  "java",
  "javascript",
  "kotlin",
  "node",
  "npm",
  "python",
  "scala",
  "semantic",
  "semantic-release",
  "semanticrelease",
  "terraform",
  "turborepo",
  "typescript",
  "vite",
  "yarn"
]);
type RepoMetadata = {
  description: string;
  routing: RepoRoutingMetadata;
};
type LegacyRepoMetadata = {
  description: string;
  topics: string[];
  classifications: RepoClassification[];
  routeEndpoints: string[];
  consumedTechnologies: string[];
  packageSurfaceNames: string[];
  readmeLeadText: string;
  readmeDomains: string[];
};
type RunCommandFn = (command: string, args: string[]) => Promise<void>;
type FsModule = typeof fs;
type PackageJsonLike = {
  name?: unknown;
  description?: unknown;
  keywords?: unknown;
  bin?: unknown;
  exports?: unknown;
  module?: unknown;
  main?: unknown;
  workspaces?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
};
type InspectionDirectory = {
  directory: string;
  cleanup: (() => Promise<void>) | null;
};
type InspectRepoMetadataOptions = {
  repo: RepoRecord;
  sourceRepo?: Partial<RepoRecord>;
  env?: Environment;
  runCommandFn?: RunCommandFn;
  fsModule?: FsModule;
  tempDirRoot?: string;
  curateMetadataFn?: typeof curateRepoMetadataWithCodex;
  useCodexCleanup?: boolean;
};
type InferMetadataFromDirectoryOptions = {
  directory: string;
  repo: RepoRecord;
  sourceRepo: Partial<RepoRecord>;
  fsModule: FsModule;
};

export async function inspectRepoClassifications({
  repo,
  sourceRepo = {},
  env = process.env,
  runCommandFn = runCommand,
  fsModule = fs,
  tempDirRoot = os.tmpdir(),
  curateMetadataFn = curateRepoMetadataWithCodex,
  useCodexCleanup = true
}: InspectRepoMetadataOptions): Promise<RepoClassification[]> {
  const metadata = await inspectLegacyRepoMetadata({
    repo,
    sourceRepo,
    env,
    runCommandFn,
    fsModule,
    tempDirRoot,
    curateMetadataFn,
    useCodexCleanup
  });

  return metadata.classifications;
}

export async function inspectRepoMetadata({
  repo,
  sourceRepo = {},
  env = process.env,
  runCommandFn = runCommand,
  fsModule = fs,
  tempDirRoot = os.tmpdir(),
  curateMetadataFn = curateRepoMetadataWithCodex,
  useCodexCleanup = true
}: InspectRepoMetadataOptions): Promise<RepoMetadata> {
  const inspection = await prepareInspectionDirectory({
    repo,
    env,
    fsModule,
    runCommandFn,
    tempDirRoot
  });

  try {
    const inferredDraft = await inferMetadataFromDirectory({
      directory: inspection.directory,
      repo,
      sourceRepo,
      fsModule
    });
    const inferredMetadata = toRepoMetadata(repo, inferredDraft);
    if (useCodexCleanup) {
      try {
        return await curateMetadataFn({
          directory: inspection.directory,
          repo,
          sourceRepo,
          inferredMetadata
        });
      } catch {
        return inferredMetadata;
      }
    }

    return inferredMetadata;
  } catch {
    return {
      description: "",
      routing: createEmptyRepoRouting()
    };
  } finally {
    await inspection.cleanup?.();
  }
}

async function inspectLegacyRepoMetadata({
  repo,
  sourceRepo = {},
  env = process.env,
  runCommandFn = runCommand,
  fsModule = fs,
  tempDirRoot = os.tmpdir()
}: InspectRepoMetadataOptions): Promise<LegacyRepoMetadata> {
  const inspection = await prepareInspectionDirectory({
    repo,
    env,
    fsModule,
    runCommandFn,
    tempDirRoot
  });

  try {
    return await inferMetadataFromDirectory({
      directory: inspection.directory,
      repo,
      sourceRepo,
      fsModule
    });
  } catch {
    return {
      description: "",
      topics: [],
      classifications: [],
      routeEndpoints: [],
      consumedTechnologies: [],
      packageSurfaceNames: [],
      readmeLeadText: "",
      readmeDomains: []
    };
  } finally {
    await inspection.cleanup?.();
  }
}

async function prepareInspectionDirectory({
  repo,
  env,
  fsModule,
  runCommandFn,
  tempDirRoot
}: Required<Pick<InspectRepoMetadataOptions, "repo" | "env" | "fsModule" | "runCommandFn" | "tempDirRoot">>): Promise<InspectionDirectory> {
  const managedRepoDirectory = getManagedRepoDirectory(getDefaultManagedReposRoot(env), repo);
  if (await exists(fsModule, managedRepoDirectory)) {
    return {
      directory: managedRepoDirectory,
      cleanup: null
    };
  }

  const tempRoot = await fsModule.mkdtemp(path.join(tempDirRoot, "archa-discovery-"));
  const cloneDirectory = path.join(tempRoot, getManagedRepoRelativePath(repo));
  const cloneUrl = repo.url;

  if (typeof cloneUrl !== "string" || cloneUrl.trim() === "") {
    return {
      directory: managedRepoDirectory,
      cleanup: null
    };
  }

  try {
    await fsModule.mkdir(path.dirname(cloneDirectory), { recursive: true });
    await runCommandFn("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      repo.defaultBranch || "main",
      "--single-branch",
      cloneUrl,
      cloneDirectory
    ]);
  } catch {
    await fsModule.rm(tempRoot, { recursive: true, force: true });
    return {
      directory: managedRepoDirectory,
      cleanup: null
    };
  }

  return {
    directory: cloneDirectory,
    cleanup: () => fsModule.rm(tempRoot, { recursive: true, force: true })
  };
}

async function inferMetadataFromDirectory({
  directory,
  repo,
  sourceRepo,
  fsModule
}: InferMetadataFromDirectoryOptions): Promise<LegacyRepoMetadata> {
  if (!(await exists(fsModule, directory))) {
    return {
      description: "",
      topics: [],
      classifications: [],
      routeEndpoints: [],
      consumedTechnologies: [],
      packageSurfaceNames: [],
      readmeLeadText: "",
      readmeDomains: []
    };
  }

  const signals = new Set<string>();
  const topicCandidates: string[] = [];
  const classifications: RepoClassification[] = [];
  const hasFrontend = await hasAnyPath(fsModule, directory, FRONTEND_DIRECTORIES)
    || await hasAnyFile(fsModule, directory, FRONTEND_CONFIG_FILES);
  const hasMobile = await hasAnyPath(fsModule, directory, MOBILE_DIRECTORIES);
  const hasBackendSurface = await hasAnyPath(fsModule, directory, BACKEND_SURFACE_PATHS);
  const hasInfra = await hasAnyPath(fsModule, directory, INFRA_DIRECTORIES)
    || await hasAnyFile(fsModule, directory, INFRA_FILENAMES)
    || await hasRootFileWithSuffix(fsModule, directory, INFRA_FILE_SUFFIXES);
  const packageJson = await readJson(fsModule, path.join(directory, "package.json"));
  const workspacePackageJsons = await readWorkspacePackageJsons(fsModule, directory, packageJson);
  const gradleText = await readTextIfExists(fsModule, path.join(directory, "build.gradle"));
  const gradleKtsText = await readTextIfExists(fsModule, path.join(directory, "build.gradle.kts"));
  const pomText = await readTextIfExists(fsModule, path.join(directory, "pom.xml"));
  const goModText = await readTextIfExists(fsModule, path.join(directory, "go.mod"));
  const readmeText = await readFirstExisting(fsModule, directory, README_CANDIDATES);
  const readmeLeadText = extractReadmeLeadText(readmeText);
  const routeEndpoints = await collectRouteEndpoints(fsModule, directory);
  const packageSurfaceNames = collectPackageSurfaceNames(packageJson, workspacePackageJsons);
  const packageManifests = [packageJson, ...workspacePackageJsons].filter(
    (manifest): manifest is PackageJsonLike => manifest != null
  );

  addWords(signals, repo.name);
  addWords(signals, repo.description);
  addWords(signals, readmeLeadText);
  addWords(signals, packageSurfaceNames);
  for (const manifest of packageManifests) {
    addWords(signals, manifest.name);
    addWords(signals, manifest.keywords || []);
  }
  collectWords(topicCandidates, repo.description);
  collectWords(topicCandidates, readmeLeadText);
  collectWords(topicCandidates, packageSurfaceNames);
  for (const manifest of packageManifests) {
    collectWords(topicCandidates, manifest.name);
    collectWords(topicCandidates, manifest.keywords || []);
  }

  const dependencyNames = packageManifests.flatMap(collectPackageDependencies);
  for (const dependencyName of dependencyNames) {
    signals.add(dependencyName.toLowerCase());
    collectWords(topicCandidates, dependencyName);
  }

  const gradleSource = `${gradleText}\n${gradleKtsText}`.toLowerCase();
  const pomSource = pomText.toLowerCase();
  const goSource = goModText.toLowerCase();
  const readmeSource = readmeText.toLowerCase();
  const hasFrontendDependency = hasMatchingDependency(dependencyNames, FRONTEND_DEPENDENCIES);
  const hasPlayFramework = PLAY_FRAMEWORK_TERMS.some(term =>
    gradleSource.includes(term) || pomSource.includes(term) || readmeSource.includes(term)
  );
  const hasFrontendSignals = hasFrontend || hasFrontendDependency;
  const hasBackendFramework = hasMatchingDependency(dependencyNames, BACKEND_DEPENDENCIES)
    || hasBackendSurface
    || hasPlayFramework
    || gradleSource.includes("spring-boot")
    || pomSource.includes("spring-boot")
    || goSource.includes("gin-gonic") || goSource.includes("chi");
  const hasCliFramework = hasMatchingDependency(dependencyNames, CLI_DEPENDENCIES)
    || packageManifests.some(manifest => typeof manifest.bin === "string" || (manifest.bin && typeof manifest.bin === "object"))
    || goSource.includes("spf13/cobra");
  const hasLibraryPackaging = hasFrontendDependency && !hasFrontendSignals
    ? true
    : (LIBRARY_TERMS.some(term => signals.has(term)) && !hasBackendFramework)
      || gradleSource.includes("java-library")
      || (!hasBackendFramework && pomSource.includes("<packaging>jar</packaging>"))
      || (!hasBackendFramework && (
        packageManifests.some(manifest =>
          typeof manifest.exports === "object"
          || typeof manifest.module === "string"
          || typeof manifest.main === "string"
        )
      ));
  const hasMicroserviceSignal = signals.has("microservice")
    || ((signals.has("worker") || signals.has("daemon")) && (hasBackendFramework || hasCliFramework));

  if (hasInfra) {
    classifications.push("infra");
  }

  if (hasLibraryPackaging) {
    classifications.push("library");
  }

  if (hasAnyTerm(signals, INTERNAL_TERMS)) {
    classifications.push("internal");
  }

  if (hasCliFramework) {
    classifications.push("cli");
  }

  if (hasFrontendSignals || hasMobile) {
    classifications.push("frontend");
  }

  if (hasBackendFramework) {
    classifications.push("backend");
  }

  if (hasMicroserviceSignal) {
    classifications.push("microservice");
  }

  if ((hasFrontendSignals || hasMobile || (hasBackendFramework && hasBackendSurface) || hasExternalFacingEvidence([
    repo.name,
    repo.description,
    readmeLeadText,
    Array.isArray(packageJson?.keywords) ? packageJson.keywords : []
  ])) && !classifications.includes("internal")) {
    classifications.push("external");
  }

  const normalizedClassifications = Array.from(new Set(classifications));
  const consumedTechnologies = inferConsumedTechnologies({
    gradleSource,
    pomSource,
    goSource,
    readmeSource,
    repoDescription: repo.description,
    readmeLeadText,
    routeEndpoints
  });

  return {
    description: inferRepoDescription({
      readmeLeadText,
      fallbackDescription: repo.description
    }),
    topics: inferTopicsFromSignals(
      topicCandidates,
      normalizedClassifications,
      buildExcludedTopicTokens(repo),
      sourceRepo.size
    ),
    classifications: normalizedClassifications,
    routeEndpoints,
    consumedTechnologies,
    packageSurfaceNames,
    readmeLeadText,
    readmeDomains: extractDomains(readmeLeadText)
  };
}

function toRepoMetadata(repo: RepoRecord, metadata: LegacyRepoMetadata): RepoMetadata {
  const routing = buildRepoRoutingDraft({
    repoName: repo.name,
    description: metadata.description,
    topics: metadata.topics,
    classifications: metadata.classifications,
    routeEndpoints: metadata.routeEndpoints,
    consumedTechnologies: metadata.consumedTechnologies,
    packageSurfaceNames: metadata.packageSurfaceNames,
    readmeLeadText: metadata.readmeLeadText,
    readmeDomains: metadata.readmeDomains
  });

  return {
    description: chooseRepoRoutingDescription(metadata.description, routing),
    routing
  };
}

function hasExternalFacingEvidence(values: Array<string | string[] | undefined>): boolean {
  const haystack = values
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => typeof value === "string" && value.trim() !== "")
    .join("\n")
    .toLowerCase();

  return EXTERNAL_FACING_PHRASES.some(phrase => haystack.includes(phrase));
}

function inferRepoDescription({
  readmeLeadText,
  fallbackDescription
}: {
  readmeLeadText: string;
  fallbackDescription: string | undefined;
}): string {
  const readmeDescription = normalizeDescriptionCandidate(readmeLeadText);
  if (readmeDescription !== "") {
    return readmeDescription;
  }

  return normalizeDescriptionCandidate(fallbackDescription);
}

function normalizeDescriptionCandidate(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = stripMarkdown(value).replace(/\s+/gu, " ").trim();
  if (normalized === "" || isNoisyMetadataText(value, normalized)) {
    return "";
  }

  if (normalized.length <= DESCRIPTION_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, DESCRIPTION_MAX_LENGTH - 3).trimEnd()}...`;
}

function inferTopicsFromSignals(
  tokens: string[],
  classifications: RepoClassification[],
  excludedTokens: string[] = [],
  sizeKb: number | undefined
): string[] {
  const classificationSet = new Set<string>(classifications);
  const excluded = new Set<string>(excludedTokens);
  const ranked = new Map<string, { count: number; firstIndex: number }>();
  let index = 0;

  for (const token of tokens) {
    const normalizedToken = token.trim().toLowerCase();

    if (
      normalizedToken.length < 3
      || classificationSet.has(normalizedToken)
      || excluded.has(normalizedToken)
      || TOPIC_STOP_WORDS.has(normalizedToken)
    ) {
      continue;
    }

    const current = ranked.get(normalizedToken);
    ranked.set(normalizedToken, {
      count: (current?.count || 0) + 1,
      firstIndex: current?.firstIndex ?? index
    });
    index += 1;
  }

  return [...ranked.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[1].firstIndex - right[1].firstIndex)
    .slice(0, getMaxInferredTopics(sizeKb))
    .map(([token]) => token);
}

async function hasAnyPath(fsModule: FsModule, rootDirectory: string, relativePaths: string[]): Promise<boolean> {
  for (const relativePath of relativePaths) {
    if (await exists(fsModule, path.join(rootDirectory, relativePath))) {
      return true;
    }
  }

  return false;
}

async function hasAnyFile(fsModule: FsModule, rootDirectory: string, filenames: string[]): Promise<boolean> {
  for (const filename of filenames) {
    const candidatePath = path.join(rootDirectory, filename);
    if (await exists(fsModule, candidatePath)) {
      return true;
    }
  }

  return false;
}

async function hasRootFileWithSuffix(fsModule: FsModule, rootDirectory: string, suffixes: string[]): Promise<boolean> {
  let entries: Array<{ isFile(): boolean; name: string }> = [];
  try {
    entries = await fsModule.readdir(rootDirectory, { withFileTypes: true, encoding: "utf8" }) as Array<{
      isFile(): boolean;
      name: string;
    }>;
  } catch {
    return false;
  }

  return entries.some(entry => entry.isFile() && suffixes.some((suffix: string) => entry.name.endsWith(suffix)));
}

async function readFirstExisting(fsModule: FsModule, rootDirectory: string, filenames: string[]): Promise<string> {
  for (const filename of filenames) {
    const text = await readTextIfExists(fsModule, path.join(rootDirectory, filename));
    if (text) {
      return text;
    }
  }

  return "";
}

async function collectRouteEndpoints(fsModule: FsModule, rootDirectory: string): Promise<string[]> {
  const endpoints: string[] = [];

  for (const relativePath of BACKEND_SURFACE_PATHS) {
    const routeText = await readTextIfExists(fsModule, path.join(rootDirectory, relativePath));
    if (!routeText) {
      continue;
    }

    for (const endpoint of extractRouteEndpoints(routeText)) {
      endpoints.push(endpoint);
      if (endpoints.length >= 12) {
        return endpoints;
      }
    }
  }

  return endpoints;
}

async function readTextIfExists(fsModule: FsModule, targetPath: string): Promise<string> {
  try {
    return await fsModule.readFile(targetPath, "utf8");
  } catch {
    return "";
  }
}

async function readJson(fsModule: FsModule, targetPath: string): Promise<PackageJsonLike | null> {
  try {
    return JSON.parse(await fsModule.readFile(targetPath, "utf8")) as PackageJsonLike;
  } catch {
    return null;
  }
}

function collectPackageDependencies(packageJson: PackageJsonLike | null): string[] {
  if (!packageJson || typeof packageJson !== "object") {
    return [];
  }

  return [
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {})
  ];
}

async function readWorkspacePackageJsons(
  fsModule: FsModule,
  rootDirectory: string,
  rootPackageJson: PackageJsonLike | null
): Promise<PackageJsonLike[]> {
  const manifests: PackageJsonLike[] = [];
  const seenPaths = new Set<string>();

  for (const relativePath of await expandWorkspacePackageJsonPaths(fsModule, rootDirectory, rootPackageJson)) {
    if (seenPaths.has(relativePath)) {
      continue;
    }

    seenPaths.add(relativePath);
    const manifest = await readJson(fsModule, path.join(rootDirectory, relativePath));
    if (manifest) {
      manifests.push(manifest);
    }
  }

  return manifests;
}

async function expandWorkspacePackageJsonPaths(
  fsModule: FsModule,
  rootDirectory: string,
  rootPackageJson: PackageJsonLike | null
): Promise<string[]> {
  const patterns = normalizeWorkspacePatterns(rootPackageJson?.workspaces);
  const paths: string[] = [];

  for (const pattern of patterns) {
    const normalizedPattern = pattern.replace(/\\/g, "/").trim();
    if (normalizedPattern === "") {
      continue;
    }

    // Keep workspace expansion intentionally narrow for now: support the common
    // one-level suffix glob form like "packages/*". Deeper glob shapes such as
    // "**" or "apps/*/packages/*" are treated as literal paths until a real
    // repo needs broader workspace matching.
    if (normalizedPattern.endsWith("/*")) {
      const baseDirectory = normalizedPattern.slice(0, -2);
      if (baseDirectory === "") {
        continue;
      }

      const absoluteBaseDirectory = path.join(rootDirectory, baseDirectory);
      let entries: Array<{ isDirectory(): boolean; name: string }> = [];
      try {
        entries = await fsModule.readdir(absoluteBaseDirectory, {
          withFileTypes: true,
          encoding: "utf8"
        }) as Array<{ isDirectory(): boolean; name: string }>;
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        paths.push(path.posix.join(baseDirectory, entry.name, "package.json"));
      }
      continue;
    }

    paths.push(path.posix.join(normalizedPattern, "package.json"));
  }

  return paths;
}

function normalizeWorkspacePatterns(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const packages = (value as { packages?: unknown }).packages;
  return Array.isArray(packages)
    ? packages.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function collectPackageSurfaceNames(
  rootPackageJson: PackageJsonLike | null,
  workspacePackageJsons: PackageJsonLike[]
): string[] {
  const names: string[] = [];

  for (const manifest of [rootPackageJson, ...workspacePackageJsons]) {
    if (!manifest) {
      continue;
    }

    addPackageSurfaceNames(names, manifest);
  }

  return dedupeEntries(names, 12);
}

function addPackageSurfaceNames(target: string[], packageJson: PackageJsonLike): void {
  const packageName = typeof packageJson.name === "string" ? packageJson.name.trim() : "";
  if (packageName !== "") {
    target.push(packageName);
  }

  if (typeof packageJson.bin === "string" && packageName !== "") {
    target.push(packageName);
  } else if (packageJson.bin && typeof packageJson.bin === "object") {
    for (const commandName of Object.keys(packageJson.bin as Record<string, unknown>)) {
      target.push(commandName);
    }
  }

  addPackageExportSurfaceNames(target, packageName, packageJson.exports);
}

function addPackageExportSurfaceNames(target: string[], packageName: string, exportsValue: unknown): void {
  if (packageName === "") {
    return;
  }

  if (typeof exportsValue === "string") {
    target.push(packageName);
    return;
  }

  if (!exportsValue || typeof exportsValue !== "object" || Array.isArray(exportsValue)) {
    return;
  }

  for (const key of Object.keys(exportsValue as Record<string, unknown>)) {
    if (key === ".") {
      target.push(packageName);
      continue;
    }

    if (key.startsWith("./")) {
      target.push(`${packageName}/${key.slice(2)}`);
    }
  }
}

function dedupeEntries(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.replace(/\s+/gu, " ").trim();
    if (trimmed === "") {
      continue;
    }

    const normalizedKey = trimmed.toLowerCase();
    if (seen.has(normalizedKey)) {
      continue;
    }

    seen.add(normalizedKey);
    normalized.push(trimmed);

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}

function inferConsumedTechnologies({
  gradleSource,
  pomSource,
  goSource,
  readmeSource,
  repoDescription,
  readmeLeadText,
  routeEndpoints
}: {
  gradleSource: string;
  pomSource: string;
  goSource: string;
  readmeSource: string;
  repoDescription: string | undefined;
  readmeLeadText: string;
  routeEndpoints: string[];
}): string[] {
  const technologies = new Set<string>();

  for (const source of [gradleSource, pomSource, goSource, readmeSource]) {
    if (source.includes("redis")) {
      technologies.add("Redis");
    }
    if (source.includes("mongo")) {
      technologies.add("MongoDB");
    }
    if (source.includes("postgres")) {
      technologies.add("Postgres");
    }
    if (source.includes("kafka")) {
      technologies.add("Kafka");
    }
    if (source.includes("sqs")) {
      technologies.add("SQS");
    }
    if (source.includes("s3")) {
      technologies.add("S3");
    }
    if (source.includes("elasticsearch")) {
      technologies.add("Elasticsearch");
    }
    if (source.includes("cassandra")) {
      technologies.add("Cassandra");
    }
    if (source.includes("kinesis")) {
      technologies.add("Kinesis");
    }
  }

  const consumeDomain = inferSpecificConsumeDomain({
    repoDescription,
    readmeLeadText,
    routeEndpoints
  });

  return filterRepoRoutingConsumes(
    [...technologies]
      .map(technology => describeConsumedSurface(technology, consumeDomain))
      .filter((technology): technology is string => technology != null)
  ).slice(0, 8);
}

function inferSpecificConsumeDomain({
  repoDescription,
  readmeLeadText,
  routeEndpoints
}: {
  repoDescription: string | undefined;
  readmeLeadText: string;
  routeEndpoints: string[];
}): string | null {
  const haystack = [
    repoDescription || "",
    readmeLeadText,
    ...routeEndpoints
  ].join("\n").toLowerCase();

  const labels: string[] = [];
  const domainSignals: Array<{ label: string; pattern: RegExp }> = [
    { label: "search", pattern: /\b(search|serp|autocomplete|keyword|index(?:er|ing)?)\b/u },
    { label: "product", pattern: /\b(product|products|catalog|catalogue|collection|collections|sku|skus|metafield)\b/u },
    { label: "customer", pattern: /\b(customer|customers|visitor|visitors|user|users)\b/u },
    { label: "order", pattern: /\b(order|orders|checkout)\b/u },
    { label: "cart", pattern: /\bcart\b/u },
    { label: "recommendation", pattern: /\b(recommendation|recommendations|recs?)\b/u },
    { label: "template", pattern: /\b(template|templates|editor|vscode)\b/u },
    { label: "analytics", pattern: /\b(analytics|tracking|attribution|conversion|event|events)\b/u },
    { label: "assistant", pattern: /\b(assistant|agent|huginn)\b/u },
    { label: "email widget", pattern: /\b(email ?widget|emailwidget|campaign|popup|klaviyo)\b/u },
    { label: "image", pattern: /\b(image|images|thumbnail|thumbnails|vector)\b/u },
    { label: "bulk export", pattern: /\b(bulk|jsonl|full-catalogue|full-catalog|catalogue sync)\b/u }
  ];

  for (const signal of domainSignals) {
    if (signal.pattern.test(haystack)) {
      labels.push(signal.label);
    }
  }

  return labels.length === 1 ? (labels[0] ?? null) : null;
}

function describeConsumedSurface(technology: string, consumeDomain: string | null): string | null {
  switch (technology) {
    case "MongoDB":
    case "Postgres":
    case "Cassandra":
      return consumeDomain ? `${consumeDomain} data DB` : null;
    case "Redis":
      return consumeDomain ? `${consumeDomain} cache` : null;
    case "Elasticsearch":
      return consumeDomain ? `${consumeDomain} index` : null;
    case "Kafka":
    case "Kinesis":
    case "SQS":
      return consumeDomain ? `${consumeDomain} queue` : null;
    case "S3":
      return consumeDomain ? `${consumeDomain} file storage` : null;
    default:
      return technology;
  }
}

function hasMatchingDependency(dependencyNames: string[], knownNames: Set<string>): boolean {
  return dependencyNames.some(name => knownNames.has(name.toLowerCase()));
}

function addWords(target: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      addWords(target, item);
    }
    return;
  }

  if (typeof value !== "string") {
    return;
  }

  for (const token of value.toLowerCase().match(/[a-z0-9-]+/g) || []) {
    target.add(token);
    if (token.includes("-")) {
      for (const part of token.split("-")) {
        target.add(part);
      }
    }
  }
}

function collectWords(target: string[], value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectWords(target, item);
    }
    return;
  }

  if (typeof value !== "string") {
    return;
  }

  for (const token of tokenizeTerms(value)) {
    target.push(token);
  }
}

function tokenizeTerms(value: string): string[] {
  return (value.match(/[A-Za-z0-9-]+/g) || [])
    .flatMap(token => token.split("-"))
    .flatMap(token => token.split(/(?=[A-Z])/))
    .map(token => token.toLowerCase())
    .filter(Boolean);
}

function buildExcludedTopicTokens(repo: Pick<RepoRecord, "name" | "url">): string[] {
  return [
    ...tokenizeTerms(repo.name),
    ...parseRepoOwnerTokens(repo.url)
  ];
}

function parseRepoOwnerTokens(url: string | undefined): string[] {
  if (typeof url !== "string" || url.trim() === "") {
    return [];
  }

  const match = url.match(/github\.com[/:]([^/]+)\/[^/]+(?:\.git)?$/i);
  if (!match) {
    return [];
  }

  const owner = match[1];
  return owner ? tokenizeTerms(owner) : [];
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/[_#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractReadmeLeadText(readmeText: string): string {
  if (!readmeText) {
    return "";
  }

  const paragraphs = readmeText
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .filter(paragraph => !paragraph.startsWith("#"))
    .filter(paragraph => !paragraph.startsWith("```"))
    .filter(paragraph => !paragraph.startsWith("- "))
    .filter(paragraph => !paragraph.startsWith("* "))
    .map(paragraph => ({
      raw: paragraph,
      stripped: stripMarkdown(paragraph)
    }))
    .filter(paragraph => paragraph.stripped !== "")
    .filter(paragraph => !paragraph.stripped.toLowerCase().includes("table of contents"))
    .filter(paragraph => !isNoisyMetadataText(paragraph.raw, paragraph.stripped));

  return paragraphs.find(candidate => candidate.stripped.length >= 20)?.stripped || "";
}

function extractDomains(value: string): string[] {
  const matches = value.match(/\b[a-z0-9.-]+\.[a-z]{2,}(?:\/[a-z0-9._~:/?#[\]@!$&'()*+,;=-]*)?/giu) || [];
  return [...new Set(matches
    .map(match => match.replace(/[),.;]+$/u, ""))
    .filter(match => !NOISY_README_DOMAINS.some(domain => match.toLowerCase().includes(domain))))]
    .slice(0, 8);
}

function isNoisyMetadataText(rawValue: string, normalizedValue: string): boolean {
  const rawLower = rawValue.toLowerCase();
  const normalizedLower = normalizedValue.toLowerCase();

  if (rawLower.includes("img.shields.io") || rawValue.includes("![")) {
    return true;
  }

  const urlCount = (rawValue.match(/https?:\/\//gu) || []).length;
  const markdownLinkCount = (rawValue.match(/\[[^\]]+\]\([^)]+\)/gu) || []).length;
  if (urlCount >= 2 || markdownLinkCount >= 3) {
    return true;
  }

  if (normalizedLower.includes("img.shields.io")) {
    return true;
  }

  const tokens = tokenizeTerms(normalizedValue).filter(token => !TOPIC_STOP_WORDS.has(token));
  if (tokens.length === 0) {
    return false;
  }

  return tokens.every(token => TOOLCHAIN_ONLY_DESCRIPTION_TOKENS.has(token));
}

function extractRouteEndpoints(routeText: string): string[] {
  const endpoints: string[] = [];

  for (const rawLine of routeText.split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/u);
    if (!match || !match[1] || !match[2]) {
      continue;
    }

    endpoints.push(`${match[1]} ${match[2]}`);
  }

  return endpoints;
}

function hasAnyTerm(signals: Set<string>, terms: string[]): boolean {
  return terms.some(term => signals.has(term));
}

async function exists(fsModule: FsModule, targetPath: string): Promise<boolean> {
  try {
    await fsModule.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0"
      }
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", error => {
      reject(normalizeGitExecutionError(error));
    });
    child.on("close", code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr.trim()}`));
    });
  });
}
