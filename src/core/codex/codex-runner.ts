import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import {
  resolveAnswerAudience,
  type AnswerAudience
} from "../answer/answer-audience.js";
import { normalizeCodexExecutionError } from "./codex-installation.js";
import { DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT } from "./codex-defaults.js";
import { formatEstimatedCodexUsd } from "./codex-pricing.js";
import { formatDuration } from "../time/duration-format.js";
import type { CodexScopeRepo, CodexSynthesis, CodexUsage, Environment, RunCodexQuestionInput } from "../types.js";

const DEFAULT_CODEX_TIMEOUT_MS = 300_000;
const FORCE_KILL_GRACE_PERIOD_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
export const CODEX_COMPLETED_STATUS_PREFIX = "Running Codex... done in ";
const TOKEN_COUNT_FORMATTER = new Intl.NumberFormat("en-US");

type StatusCallback = ((message: string) => void) | null | undefined;

type RunCodexPromptInput = {
  prompt: string;
  model?: string | null;
  reasoningEffort?: string | null;
  workingDirectory: string;
  onStatus?: StatusCallback;
  timeoutMs?: number;
  emptyOutputText?: string;
};

type RunCodexExecInput = {
  prompt: string;
  model: string;
  reasoningEffort: string;
  outputFile: string;
  workingDirectory: string;
  onStatus?: StatusCallback;
  timeoutMs: number;
};

type RunCodexExecResult = {
  usage: CodexUsage | null;
};

export async function runCodexQuestion({
  question,
  audience,
  model,
  reasoningEffort,
  selectedRepos,
  workspaceRoot,
  repoCatalogPath,
  onStatus,
  timeoutMs = DEFAULT_CODEX_TIMEOUT_MS
}: RunCodexQuestionInput): Promise<CodexSynthesis> {
  const executionContext = getCodexExecutionContext({
    question,
    ...(audience === undefined ? {} : { audience }),
    selectedRepos,
    workspaceRoot,
    ...(repoCatalogPath === undefined ? {} : { repoCatalogPath })
  });
  const resolvedModel = model || DEFAULT_CODEX_MODEL;
  const resolvedReasoningEffort = reasoningEffort || DEFAULT_CODEX_REASONING_EFFORT;

  onStatus?.(formatCodexRunningStatus());

  return runCodexPrompt({
    prompt: executionContext.prompt,
    model: resolvedModel,
    reasoningEffort: resolvedReasoningEffort,
    workingDirectory: executionContext.workingDirectory,
    onStatus,
    timeoutMs,
    emptyOutputText: "Codex did not produce a final answer."
  });
}

export async function runCodexPrompt({
  prompt,
  model,
  reasoningEffort,
  workingDirectory,
  onStatus,
  timeoutMs = DEFAULT_CODEX_TIMEOUT_MS,
  emptyOutputText = "Codex did not produce a final answer."
}: RunCodexPromptInput): Promise<CodexSynthesis> {
  const outputFile = createCodexOutputFilePath();
  const resolvedModel = model || DEFAULT_CODEX_MODEL;
  const resolvedReasoningEffort = reasoningEffort || DEFAULT_CODEX_REASONING_EFFORT;

  try {
    const execResult = await runCodexExec({
      prompt,
      model: resolvedModel,
      reasoningEffort: resolvedReasoningEffort,
      outputFile,
      workingDirectory,
      onStatus,
      timeoutMs
    });

    const text = (await fs.readFile(outputFile, "utf8")).trim() || emptyOutputText;
    return execResult.usage
      ? { text, usage: execResult.usage }
      : { text };
  } finally {
    await fs.rm(outputFile, { force: true });
  }
}

function createCodexOutputFilePath(): string {
  return path.join(
    os.tmpdir(),
    `archa-codex-${process.pid}-${Date.now()}-${randomUUID()}.txt`
  );
}

export function getCodexTimeoutMs(env: Environment = process.env): number {
  if (!env.ARCHA_CODEX_TIMEOUT_MS) {
    return DEFAULT_CODEX_TIMEOUT_MS;
  }

  const rawTimeoutMs = env.ARCHA_CODEX_TIMEOUT_MS.trim();
  if (!/^\d+$/u.test(rawTimeoutMs)) {
    throw new Error(`Invalid ARCHA_CODEX_TIMEOUT_MS: ${env.ARCHA_CODEX_TIMEOUT_MS}. Use a positive integer.`);
  }

  const timeoutMs = Number.parseInt(rawTimeoutMs, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid ARCHA_CODEX_TIMEOUT_MS: ${env.ARCHA_CODEX_TIMEOUT_MS}. Use a positive integer.`);
  }

  return timeoutMs;
}

export function getCodexExecutionContext({
  question,
  audience,
  selectedRepos,
  workspaceRoot,
  repoCatalogPath
}: Pick<RunCodexQuestionInput, "question" | "audience" | "selectedRepos" | "workspaceRoot" | "repoCatalogPath">): {
  workingDirectory: string;
  prompt: string;
} {
  const singleSelectedRepo = selectedRepos[0];
  const workingDirectory = selectedRepos.length === 1 && singleSelectedRepo
    ? singleSelectedRepo.directory
    : workspaceRoot;

  return {
    workingDirectory,
    prompt: buildPrompt(question, selectedRepos, audience, {
      workingDirectory,
      repoCatalogPath: isCatalogVisibleFromWorkingDirectory(workingDirectory, repoCatalogPath)
        ? repoCatalogPath
        : null
    })
  };
}

function buildPrompt(
  question: string,
  selectedRepos: CodexScopeRepo[],
  audience: AnswerAudience | null | undefined,
  {
    workingDirectory,
    repoCatalogPath
  }: {
    workingDirectory: string;
    repoCatalogPath: string | null | undefined;
  }
): string {
  const resolvedAudience = resolveAnswerAudience(audience);
  const repoNames = selectedRepos.map(repo => repo.name).join(", ");

  return [
    "Answer using the code in the current workspace.",
    ...getAudiencePromptLines(resolvedAudience),
    `These repos are in scope for answering the question: ${repoNames}.`,
    repoCatalogPath
      ? `When you need a repo index, consult ${formatCatalogPathForPrompt(repoCatalogPath, workingDirectory)}. Treat it as advisory metadata and verify answers against the code in this workspace.`
      : null,
    "Answer the question directly and stop. Do not offer follow-up help or ask whether you should rewrite the answer.",
    "",
    "I got the question:",
    '"""',
    question,
    '"""'
  ].filter(line => line != null).join("\n");
}

function isCatalogVisibleFromWorkingDirectory(
  workingDirectory: string,
  repoCatalogPath: string | null | undefined
): repoCatalogPath is string {
  if (typeof repoCatalogPath !== "string" || repoCatalogPath.trim() === "") {
    return false;
  }

  const relativePath = path.relative(workingDirectory, repoCatalogPath);
  return relativePath === ""
    || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function formatCatalogPathForPrompt(repoCatalogPath: string, workingDirectory: string): string {
  const relativePath = path.relative(workingDirectory, repoCatalogPath);
  return relativePath === "" ? "." : relativePath;
}

function getAudiencePromptLines(audience: AnswerAudience): string[] {
  if (audience === "codebase") {
    return [
      "Write for an engineer who can inspect this workspace. Be concrete about the implementation and mention relevant files, symbols, and execution flow when useful.",
      "Use code snippets when they help explain behavior or where to make changes."
    ];
  }

  return [
    "Write for a non-engineering reader. Keep the answer self-contained and do not assume the reader can inspect this workspace.",
    "Assume no knowledge or access to source code or implementation details.",
    "Explain the behavior in plain language, not as a code walkthrough.",
    "Avoid unnecessary references to files, symbols, and other analyzed-workspace code details unless they are needed for accuracy or explicitly requested.",
    "Service-interaction code, API payloads, and integration examples are allowed when they help explain usage or behavior.",
    "Translate implementation details into user-facing behavior and outcomes instead of citing analyzed-workspace source identifiers.",
    "Use code snippets only when they help explain integration or behavior.",
    "Before finalizing, remove unnecessary references to analyzed-workspace code."
  ];
}

async function runCodexExec({
  prompt,
  model,
  reasoningEffort,
  outputFile,
  workingDirectory,
  onStatus,
  timeoutMs
}: RunCodexExecInput): Promise<RunCodexExecResult> {
  const startedAt = Date.now();
  const args = [
    "-c",
    `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
    "exec",
    "-C",
    workingDirectory,
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--json",
    "--output-last-message",
    outputFile
  ];

  args.push("--model", model);

  args.push("-");

  const stopHeartbeat = startCodexHeartbeat(onStatus, startedAt);

  try {
    return await new Promise<RunCodexExecResult>((resolve, reject) => {
      const child = spawn("codex", args, {
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stderr = "";
      const jsonTracker = createCodexJsonTracker();
      let settled = false;
      let forceKillTimer: NodeJS.Timeout | undefined;

      const timeoutTimer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        onStatus?.(`Codex timed out after ${formatDuration(timeoutMs)}; stopping...`);
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, FORCE_KILL_GRACE_PERIOD_MS);
        cleanupTimedOutChild(child);
        reject(new Error(formatCodexTimeoutError(timeoutMs, stderr)));
      }, timeoutMs);
      timeoutTimer.unref?.();

      child.stdin.write(prompt);
      child.stdin.end();

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.stdout!.on("data", (chunk: Buffer) => {
        jsonTracker.onData(chunk);
      });
      child.on("error", (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);
        reject(normalizeCodexExecutionError(error));
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);

        if (settled) {
          return;
        }

        settled = true;
        if (code === 0) {
          const usage = jsonTracker.finish();
          onStatus?.(formatCodexCompletedStatus(Date.now() - startedAt, usage, model));
          resolve({ usage });
          return;
        }
        reject(new Error(formatCodexExecError(code, stderr)));
      });
    });
  } finally {
    stopHeartbeat();
  }
}

export function summarizeCodexStderr(stderr: string): string {
  const lines = normalizeCodexStderrLines(stderr);

  if (lines.length === 0) {
    return "";
  }

  const usageLimitSummary = summarizeCodexUsageLimit(lines);
  if (usageLimitSummary) {
    return usageLimitSummary;
  }

  const relevantLines = dedupeCodexStderrLines(lines.filter(line => isRelevantExecLine(line)));
  if (relevantLines.length > 0) {
    return relevantLines.slice(-8).join("\n");
  }

  return lines.slice(-8).join("\n");
}

export function summarizeCodexTimeoutStderr(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => isRelevantTimeoutLine(line));

  if (lines.length === 0) {
    return "";
  }

  return lines.slice(-8).join("\n");
}

function formatCodexExecError(code: number | null, stderr: string): string {
  const summary = summarizeCodexStderr(stderr);
  if (!summary) {
    return `codex exec failed with exit code ${code}`;
  }
  return `codex exec failed with exit code ${code}: ${summary}`;
}

function formatCodexTimeoutError(timeoutMs: number, stderr: string): string {
  const summary = summarizeCodexTimeoutStderr(stderr);
  if (!summary) {
    return `codex exec timed out after ${formatDuration(timeoutMs)}`;
  }

  return `codex exec timed out after ${formatDuration(timeoutMs)}: ${summary}`;
}

function cleanupTimedOutChild(child: ReturnType<typeof spawn>): void {
  child.stdin?.destroy();
  child.stdout!.destroy();
  child.stderr?.destroy();
}

function isRelevantTimeoutLine(line: string): boolean {
  return [
    /^error:/i,
    /\bwarn\b/i,
    /\berror\b/i,
    /^caused by:/i,
    /\bfailed\b/i,
    /\boperation not permitted\b/i,
    /\bexception\b/i
  ].some(pattern => pattern.test(line));
}

function isRelevantExecLine(line: string): boolean {
  return [
    /^error:/i,
    /\berror\b/i,
    /^caused by:/i,
    /\bfailed\b/i,
    /\bexception\b/i,
    /\busage limit\b/i,
    /\brate limit\b/i,
    /chatgpt\.com\/codex\/settings\/usage/i
  ].some(pattern => pattern.test(line));
}

function normalizeCodexStderrLines(stderr: string): string[] {
  return stderr
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
}

function dedupeCodexStderrLines(lines: string[]): string[] {
  return Array.from(new Set(lines));
}

function summarizeCodexUsageLimit(lines: string[]): string | null {
  const joined = lines.join("\n");
  if (!/\busage limit\b/i.test(joined)) {
    return null;
  }

  const usageUrl = joined.match(/https:\/\/chatgpt\.com\/codex\/settings\/usage/iu)?.[0]
    ?? "https://chatgpt.com/codex/settings/usage";
  const retryAt = joined.match(/\btry again at ([^.\n]+)/iu)?.[1]?.trim();

  if (retryAt) {
    return `Codex usage limit reached. Visit ${usageUrl} to purchase more credits, or try again at ${retryAt}.`;
  }

  return `Codex usage limit reached. Visit ${usageUrl} to purchase more credits or try again later.`;
}

function startCodexHeartbeat(onStatus: StatusCallback, startedAt: number): () => void {
  if (!onStatus) {
    return () => {};
  }

  const timer = setInterval(() => {
    onStatus(formatCodexElapsedStatus(Date.now() - startedAt));
  }, HEARTBEAT_INTERVAL_MS);

  timer.unref?.();

  return () => {
    clearInterval(timer);
  };
}

function formatCodexRunningStatus(): string {
  return "Running Codex...";
}

function formatCodexElapsedStatus(elapsedMs: number): string {
  return `Running Codex... ${formatDuration(elapsedMs)} elapsed`;
}

function formatCodexCompletedStatus(elapsedMs: number, usage: CodexUsage | null, model: string): string {
  const duration = `${CODEX_COMPLETED_STATUS_PREFIX}${formatDuration(elapsedMs)}`;
  if (!usage) {
    return duration;
  }

  return `${duration} (${formatCodexUsageSummary(model, usage)})`;
}

function formatCodexUsageSummary(model: string, usage: CodexUsage): string {
  const parts = [
    `input=${formatTokenCount(usage.inputTokens)}`,
    `output=${formatTokenCount(usage.outputTokens)}`
  ];
  const estimatedUsd = formatEstimatedCodexUsd(model, usage);
  if (estimatedUsd) {
    parts.push(`usd=${estimatedUsd}`);
  }

  return parts.join(" ");
}

function formatTokenCount(value: number): string {
  return TOKEN_COUNT_FORMATTER.format(value);
}

function createCodexJsonTracker(): {
  onData(chunk: Buffer): void;
  finish(): CodexUsage | null;
} {
  let buffer = "";
  let usage: CodexUsage | null = null;

  return {
    onData(chunk: Buffer) {
      buffer += chunk.toString();
      buffer = consumeCodexJsonBuffer(buffer, nextUsage => {
        usage = nextUsage;
      });
    },
    finish() {
      if (buffer.trim()) {
        updateUsageFromCodexJsonLine(buffer, nextUsage => {
          usage = nextUsage;
        });
      }

      return usage;
    }
  };
}

function consumeCodexJsonBuffer(
  buffer: string,
  onUsage: (usage: CodexUsage) => void
): string {
  let remainingBuffer = buffer;

  while (true) {
    const newlineIndex = remainingBuffer.indexOf("\n");
    if (newlineIndex < 0) {
      return remainingBuffer;
    }

    const line = remainingBuffer.slice(0, newlineIndex);
    remainingBuffer = remainingBuffer.slice(newlineIndex + 1);
    updateUsageFromCodexJsonLine(line, onUsage);
  }
}

function updateUsageFromCodexJsonLine(line: string, onUsage: (usage: CodexUsage) => void): void {
  const usage = extractCodexUsage(line);
  if (!usage) {
    return;
  }

  onUsage(usage);
}

function extractCodexUsage(line: string): CodexUsage | null {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return null;
  }

  let parsedLine: unknown;

  try {
    parsedLine = JSON.parse(trimmedLine);
  } catch {
    return null;
  }

  if (!isRecord(parsedLine) || parsedLine.type !== "turn.completed") {
    return null;
  }

  return normalizeCodexUsage(parsedLine.usage);
}

function normalizeCodexUsage(value: unknown): CodexUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  const inputTokens = normalizeRequiredTokenCount(value.input_tokens);
  const cachedInputTokens = normalizeOptionalTokenCount(value.cached_input_tokens, 0);
  const outputTokens = normalizeRequiredTokenCount(value.output_tokens);
  if (inputTokens == null || cachedInputTokens == null || outputTokens == null) {
    return null;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens
  };
}

function normalizeRequiredTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

function normalizeOptionalTokenCount(value: unknown, defaultValue: number): number | null {
  if (value == null) {
    return defaultValue;
  }

  return normalizeRequiredTokenCount(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
