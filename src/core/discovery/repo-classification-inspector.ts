import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { getDefaultManagedReposRoot } from "../config/config-paths.ts";
import { pathExists } from "../fs/path-exists.ts";
import { normalizeGitExecutionError } from "../git/git-installation.ts";
import { getManagedRepoDirectory, getManagedRepoRelativePath } from "../repos/repo-paths.ts";
import { createEmptyRepoRouting, filterRepoRoutingConsumes } from "../repos/repo-routing.ts";
import { DEFAULT_REPO_TRUNK_BRANCH } from "../repos/constants.ts";
import { EXTERNAL_FACING_PHRASES, getMaxInferredTopics } from "./inference-constants.ts";
import { buildRepoRoutingDraft } from "./repo-routing-draft.ts";
import { curateRepoMetadataWithCodex } from "./repo-metadata-codex-curator.ts";
import type { Environment, RepoClassification, RepoRecord, RepoRoutingMetadata } from "../types.ts";

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
  readmeLeadText: string;
  readmeDomains: string[];
};
type RunCommandFn = (command: string, args: string[]) => Promise<void>;
type FsModule = typeof fs;
type PackageJsonLike = {
  keywords?: unknown;
  bin?: unknown;
  exports?: unknown;
  module?: unknown;
  main?: unknown;
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
  if (await pathExists(managedRepoDirectory, fsModule)) {
    return {
      directory: managedRepoDirectory,
      cleanup: null
    };
  }

  const tempRoot = await fsModule.mkdtemp(path.join(tempDirRoot, "atc-discovery-"));
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
      repo.defaultBranch || DEFAULT_REPO_TRUNK_BRANCH,
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
  if (!(await pathExists(directory, fsModule))) {
    return {
      description: "",
      topics: [],
      classifications: [],
      routeEndpoints: [],
      consumedTechnologies: [],
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
  const gradleText = await readTextIfExists(fsModule, path.join(directory, "build.gradle"));
  const gradleKtsText = await readTextIfExists(fsModule, path.join(directory, "build.gradle.kts"));
  const pomText = await readTextIfExists(fsModule, path.join(directory, "pom.xml"));
  const goModText = await readTextIfExists(fsModule, path.join(directory, "go.mod"));
  const readmeText = await readFirstExisting(fsModule, directory, README_CANDIDATES);
  const readmeLeadText = extractReadmeLeadText(readmeText);
  const routeEndpoints = await collectRouteEndpoints(fsModule, directory);

  addWords(signals, repo.name);
  addWords(signals, repo.description);
  addWords(signals, readmeLeadText);
  addWords(signals, packageJson?.keywords || []);
  collectWords(topicCandidates, repo.description);
  collectWords(topicCandidates, readmeLeadText);
  collectWords(topicCandidates, packageJson?.keywords || []);

  const dependencyNames = collectPackageDependencies(packageJson);
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
    || typeof packageJson?.bin === "string"
    || (packageJson?.bin && typeof packageJson.bin === "object")
    || goSource.includes("spf13/cobra");
  const hasLibraryPackaging = hasFrontendDependency && !hasFrontendSignals
    ? true
    : (LIBRARY_TERMS.some(term => signals.has(term)) && !hasBackendFramework)
      || gradleSource.includes("java-library")
      || (!hasBackendFramework && pomSource.includes("<packaging>jar</packaging>"))
      || (!hasBackendFramework && (
        typeof packageJson?.exports === "object"
        || typeof packageJson?.module === "string"
        || typeof packageJson?.main === "string"
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
    readmeSource
  });

  return {
    description: inferDescriptionFromReadme(readmeText),
    topics: inferTopicsFromSignals(
      topicCandidates,
      normalizedClassifications,
      buildExcludedTopicTokens(repo),
      sourceRepo.size
    ),
    classifications: normalizedClassifications,
    routeEndpoints,
    consumedTechnologies,
    readmeLeadText,
    readmeDomains: extractDomains(readmeText)
  };
}

function toRepoMetadata(repo: RepoRecord, metadata: LegacyRepoMetadata): RepoMetadata {
  return {
    description: metadata.description,
    routing: buildRepoRoutingDraft({
      repoName: repo.name,
      description: metadata.description,
      topics: metadata.topics,
      classifications: metadata.classifications,
      routeEndpoints: metadata.routeEndpoints,
      consumedTechnologies: metadata.consumedTechnologies,
      readmeLeadText: metadata.readmeLeadText,
      readmeDomains: metadata.readmeDomains
    })
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

function inferDescriptionFromReadme(readmeText: string): string {
  const leadParagraph = extractReadmeLeadText(readmeText);

  if (!leadParagraph) {
    return "";
  }

  if (leadParagraph.length <= DESCRIPTION_MAX_LENGTH) {
    return leadParagraph;
  }

  return `${leadParagraph.slice(0, DESCRIPTION_MAX_LENGTH - 3).trimEnd()}...`;
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
    if (await pathExists(path.join(rootDirectory, relativePath), fsModule)) {
      return true;
    }
  }

  return false;
}

async function hasAnyFile(fsModule: FsModule, rootDirectory: string, filenames: string[]): Promise<boolean> {
  for (const filename of filenames) {
    const candidatePath = path.join(rootDirectory, filename);
    if (await pathExists(candidatePath, fsModule)) {
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

function inferConsumedTechnologies({
  gradleSource,
  pomSource,
  goSource,
  readmeSource
}: {
  gradleSource: string;
  pomSource: string;
  goSource: string;
  readmeSource: string;
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

  return filterRepoRoutingConsumes([...technologies]).slice(0, 8);
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
    .map(stripMarkdown)
    .filter(Boolean)
    .filter(paragraph => !paragraph.toLowerCase().includes("table of contents"));

  return paragraphs.find(candidate => candidate.length >= 20) || "";
}

function extractDomains(value: string): string[] {
  const matches = value.match(/\b[a-z0-9.-]+\.[a-z]{2,}(?:\/[a-z0-9._~:/?#[\]@!$&'()*+,;=-]*)?/giu) || [];
  return [...new Set(matches.map(match => match.replace(/[),.;]+$/u, "")))].slice(0, 8);
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
