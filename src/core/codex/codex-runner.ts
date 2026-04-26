import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import {
  resolveAnswerAudience,
  type AnswerAudience
} from "../answer/answer-audience.ts";
import { normalizeCodexExecutionError } from "./codex-installation.ts";
import {
  CODEX_COMPLETED_STATUS_PREFIX,
  CODEX_STATUS_PREFIX,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT
} from "./constants.ts";
import { parseEnvPositiveInteger } from "../env/parse-env.ts";
import { formatDuration } from "../time/duration-format.ts";
import type { AskAttachment, CodexScopeRepo, CodexSynthesis, Environment, RunCodexQuestionInput } from "../types.ts";

const DEFAULT_CODEX_TIMEOUT_MS = 300_000;
const FORCE_KILL_GRACE_PERIOD_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_ATTACHMENT_PROMPT_CHARS = 20_000;

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

export async function runCodexQuestion({
  question,
  attachments = [],
  audience,
  model,
  reasoningEffort,
  selectedRepos,
  workspaceRoot,
  onStatus,
  timeoutMs = DEFAULT_CODEX_TIMEOUT_MS
}: RunCodexQuestionInput): Promise<CodexSynthesis> {
  const executionContext = getCodexExecutionContext({
    question,
    attachments,
    ...(audience === undefined ? {} : { audience }),
    selectedRepos,
    workspaceRoot
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
    await runCodexExec({
      prompt,
      model: resolvedModel,
      reasoningEffort: resolvedReasoningEffort,
      outputFile,
      workingDirectory,
      onStatus,
      timeoutMs
    });

    return {
      text: (await fs.readFile(outputFile, "utf8")).trim() || emptyOutputText
    };
  } finally {
    await fs.rm(outputFile, { force: true });
  }
}

function createCodexOutputFilePath(): string {
  return path.join(
    os.tmpdir(),
    `atc-codex-${process.pid}-${Date.now()}-${randomUUID()}.txt`
  );
}

export function getCodexTimeoutMs(env: Environment = process.env): number {
  const timeoutMs = parseEnvPositiveInteger(env.ATC_CODEX_TIMEOUT_MS?.trim(), {
    label: "ATC_CODEX_TIMEOUT_MS"
  });
  return timeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS;
}

export function getCodexExecutionContext({
  question,
  attachments = [],
  audience,
  selectedRepos,
  workspaceRoot
}: Pick<RunCodexQuestionInput, "question" | "attachments" | "audience" | "selectedRepos" | "workspaceRoot">): {
  workingDirectory: string;
  prompt: string;
} {
  const singleSelectedRepo = selectedRepos[0];
  const workingDirectory = selectedRepos.length === 1 && singleSelectedRepo
    ? singleSelectedRepo.directory
    : workspaceRoot;

  return {
    workingDirectory,
    prompt: buildPrompt(question, selectedRepos, audience, attachments)
  };
}

function buildPrompt(
  question: string,
  selectedRepos: CodexScopeRepo[],
  audience: AnswerAudience | null | undefined,
  attachments: AskAttachment[]
): string {
  const resolvedAudience = resolveAnswerAudience(audience);
  const repoNames = selectedRepos.map(repo => repo.name).join(", ");

  return [
    "Answer using the code in the current workspace.",
    ...getAudiencePromptLines(resolvedAudience),
    `These repos are in scope for answering the question: ${repoNames}.`,
    "Answer the question directly and stop. Do not offer follow-up help or ask whether you should rewrite the answer.",
    "",
    "I got the question:",
    '"""',
    question,
    '"""',
    ...formatAttachmentPromptLines(attachments)
  ].join("\n");
}

function formatAttachmentPromptLines(attachments: AskAttachment[]): string[] {
  if (attachments.length === 0) {
    return [];
  }

  return [
    "",
    "Attachments supplied with the question:",
    ...attachments.flatMap((attachment, index) => formatAttachmentPromptBlock(attachment, index))
  ];
}

function formatAttachmentPromptBlock(attachment: AskAttachment, index: number): string[] {
  const decoded = Buffer.from(attachment.contentBase64, "base64");
  const sizeLabel = `${decoded.byteLength} byte${decoded.byteLength === 1 ? "" : "s"}`;
  const content = isTextAttachment(attachment)
    ? decoded.toString("utf8")
    : attachment.contentBase64;
  const truncated = truncatePromptContent(content);
  const contentLabel = isTextAttachment(attachment) ? "Text content" : "Base64 content";

  return [
    `${index + 1}. ${attachment.name} (${attachment.mediaType}, ${sizeLabel})`,
    `${contentLabel}:`,
    '"""',
    truncated,
    '"""'
  ];
}

function truncatePromptContent(content: string): string {
  if (content.length <= MAX_ATTACHMENT_PROMPT_CHARS) {
    return content;
  }

  return `${content.slice(0, MAX_ATTACHMENT_PROMPT_CHARS)}\n[Attachment content truncated to ${MAX_ATTACHMENT_PROMPT_CHARS} characters.]`;
}

function isTextAttachment(attachment: AskAttachment): boolean {
  if (attachment.mediaType.startsWith("text/")) {
    return true;
  }

  return /\.(csv|css|html|java|js|json|jsx|log|md|py|scss|ts|tsx|txt|xml|ya?ml)$/iu.test(attachment.name);
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
}: RunCodexExecInput): Promise<void> {
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
    "--output-last-message",
    outputFile
  ];

  args.push("--model", model);

  args.push("-");

  const stopHeartbeat = startCodexHeartbeat(onStatus, startedAt);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("codex", args, {
        stdio: ["pipe", "ignore", "pipe"]
      });

      let stderr = "";
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
          onStatus?.(formatCodexCompletedStatus(Date.now() - startedAt));
          resolve();
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
  const lines = stderr
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
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
  return `${CODEX_STATUS_PREFIX}...`;
}

function formatCodexElapsedStatus(elapsedMs: number): string {
  return `${CODEX_STATUS_PREFIX}... ${formatDuration(elapsedMs)} elapsed`;
}

function formatCodexCompletedStatus(elapsedMs: number): string {
  return `${CODEX_COMPLETED_STATUS_PREFIX}${formatDuration(elapsedMs)}`;
}
