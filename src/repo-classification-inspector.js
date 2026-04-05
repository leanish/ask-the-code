import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { getDefaultManagedReposRoot } from "./config-paths.js";
import { curateRepoMetadataWithCodex } from "./repo-metadata-codex-curator.js";

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
const EXTERNAL_FACING_PHRASES = [
  "external",
  "customer-facing",
  "user-facing",
  "merchant-facing",
  "partner-facing",
  "storefront",
  "checkout",
  "onboarding",
  "pricing",
  "public api",
  "public-api",
  "public endpoint"
];
const INTERNAL_TERMS = ["internal", "employee", "backoffice", "admin-only", "private"];
const LIBRARY_TERMS = ["library", "sdk", "module", "plugin", "package"];
const SERVICE_TERMS = ["microservice", "worker", "daemon"];
const PLAY_FRAMEWORK_TERMS = ["playframework", "com.typesafe.play", "play.mvc", "play.api"];
const SMALL_REPO_MAX_INFERRED_TOPICS = 3;
const MEDIUM_REPO_MAX_INFERRED_TOPICS = 5;
const LARGE_REPO_MAX_INFERRED_TOPICS = 8;
const HUGE_REPO_MAX_INFERRED_TOPICS = 20;
const MASSIVE_REPO_MAX_INFERRED_TOPICS = 30;

export async function inspectRepoClassifications({
  repo,
  sourceRepo = {},
  env = process.env,
  runCommandFn = runCommand,
  fsModule = fs,
  tempDirRoot = os.tmpdir(),
  curateMetadataFn = curateRepoMetadataWithCodex,
  useCodexCleanup = true
}) {
  const metadata = await inspectRepoMetadata({
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
}) {
  const inspection = await prepareInspectionDirectory({
    repo,
    env,
    fsModule,
    runCommandFn,
    tempDirRoot
  });

  try {
    const inferredMetadata = await inferMetadataFromDirectory({
      directory: inspection.directory,
      repo,
      sourceRepo,
      fsModule
    });
    if (useCodexCleanup) {
      try {
        return await curateMetadataFn({
          directory: inspection.directory,
          repo,
          sourceRepo,
          inferredMetadata,
          env
        });
      } catch {
        return inferredMetadata;
      }
    }

    return inferredMetadata;
  } catch {
    return {
      description: "",
      topics: [],
      classifications: []
    };
  } finally {
    await inspection.cleanup?.();
  }
}

async function prepareInspectionDirectory({ repo, env, fsModule, runCommandFn, tempDirRoot }) {
  const managedRepoDirectory = path.join(getDefaultManagedReposRoot(env), repo.name);
  if (await exists(fsModule, managedRepoDirectory)) {
    return {
      directory: managedRepoDirectory,
      cleanup: null
    };
  }

  const tempRoot = await fsModule.mkdtemp(path.join(tempDirRoot, "archa-discovery-"));
  const cloneDirectory = path.join(tempRoot, repo.name);

  try {
    await runCommandFn("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      repo.defaultBranch || "main",
      "--single-branch",
      repo.url,
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

async function inferMetadataFromDirectory({ directory, repo, sourceRepo, fsModule }) {
  if (!(await exists(fsModule, directory))) {
    return {
      description: "",
      topics: [],
      classifications: []
    };
  }

  const signals = new Set();
  const topicCandidates = [];
  const classifications = [];
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
    packageJson?.keywords || []
  ])) && !classifications.includes("internal")) {
    classifications.push("external");
  }

  const normalizedClassifications = Array.from(new Set(classifications));

  return {
    description: inferDescriptionFromReadme(readmeText),
    topics: inferTopicsFromSignals(
      topicCandidates,
      normalizedClassifications,
      buildExcludedTopicTokens(repo),
      sourceRepo.size
    ),
    classifications: normalizedClassifications
  };
}

function hasExternalFacingEvidence(values) {
  const haystack = values
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => typeof value === "string" && value.trim() !== "")
    .join("\n")
    .toLowerCase();

  return EXTERNAL_FACING_PHRASES.some(phrase => haystack.includes(phrase));
}

function inferDescriptionFromReadme(readmeText) {
  const leadParagraph = extractReadmeLeadText(readmeText);

  if (!leadParagraph) {
    return "";
  }

  if (leadParagraph.length <= DESCRIPTION_MAX_LENGTH) {
    return leadParagraph;
  }

  return `${leadParagraph.slice(0, DESCRIPTION_MAX_LENGTH - 3).trimEnd()}...`;
}

function inferTopicsFromSignals(tokens, classifications, excludedTokens = [], sizeKb) {
  const classificationSet = new Set(classifications);
  const excluded = new Set(excludedTokens);
  const ranked = new Map();
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

function getMaxInferredTopics(sizeKb) {
  if (typeof sizeKb !== "number" || Number.isNaN(sizeKb)) {
    return MEDIUM_REPO_MAX_INFERRED_TOPICS;
  }

  if (sizeKb < 512) {
    return SMALL_REPO_MAX_INFERRED_TOPICS;
  }

  if (sizeKb < 5_000) {
    return MEDIUM_REPO_MAX_INFERRED_TOPICS;
  }

  if (sizeKb < 20_000) {
    return LARGE_REPO_MAX_INFERRED_TOPICS;
  }

  if (sizeKb < 100_000) {
    return HUGE_REPO_MAX_INFERRED_TOPICS;
  }

  return MASSIVE_REPO_MAX_INFERRED_TOPICS;
}

async function hasAnyPath(fsModule, rootDirectory, relativePaths) {
  for (const relativePath of relativePaths) {
    if (await exists(fsModule, path.join(rootDirectory, relativePath))) {
      return true;
    }
  }

  return false;
}

async function hasAnyFile(fsModule, rootDirectory, filenames) {
  for (const filename of filenames) {
    const candidatePath = path.join(rootDirectory, filename);
    if (await exists(fsModule, candidatePath)) {
      return true;
    }
  }

  return false;
}

async function hasRootFileWithSuffix(fsModule, rootDirectory, suffixes) {
  let entries = [];
  try {
    entries = await fsModule.readdir(rootDirectory, { withFileTypes: true });
  } catch {
    return false;
  }

  return entries.some(entry => entry.isFile() && suffixes.some(suffix => entry.name.endsWith(suffix)));
}

async function readFirstExisting(fsModule, rootDirectory, filenames) {
  for (const filename of filenames) {
    const text = await readTextIfExists(fsModule, path.join(rootDirectory, filename));
    if (text) {
      return text;
    }
  }

  return "";
}

async function readTextIfExists(fsModule, targetPath) {
  try {
    return await fsModule.readFile(targetPath, "utf8");
  } catch {
    return "";
  }
}

async function readJson(fsModule, targetPath) {
  try {
    return JSON.parse(await fsModule.readFile(targetPath, "utf8"));
  } catch {
    return null;
  }
}

function collectPackageDependencies(packageJson) {
  if (!packageJson || typeof packageJson !== "object") {
    return [];
  }

  return [
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {})
  ];
}

function hasMatchingDependency(dependencyNames, knownNames) {
  return dependencyNames.some(name => knownNames.has(name.toLowerCase()));
}

function addWords(target, value) {
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

function collectWords(target, value) {
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

function tokenizeTerms(value) {
  return (value.match(/[A-Za-z0-9-]+/g) || [])
    .flatMap(token => token.split("-"))
    .flatMap(token => token.split(/(?=[A-Z])/))
    .map(token => token.toLowerCase())
    .filter(Boolean);
}

function buildExcludedTopicTokens(repo) {
  return [
    ...tokenizeTerms(repo.name),
    ...parseRepoOwnerTokens(repo.url)
  ];
}

function parseRepoOwnerTokens(url) {
  if (typeof url !== "string" || url.trim() === "") {
    return [];
  }

  const match = url.match(/github\.com[/:]([^/]+)\/[^/]+(?:\.git)?$/i);
  if (!match) {
    return [];
  }

  return tokenizeTerms(match[1]);
}

function stripMarkdown(value) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/[_#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractReadmeLeadText(readmeText) {
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

function hasAnyTerm(signals, terms) {
  return terms.some(term => signals.has(term));
}

async function exists(fsModule, targetPath) {
  try {
    await fsModule.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0"
      }
    });

    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr.trim()}`));
    });
  });
}
