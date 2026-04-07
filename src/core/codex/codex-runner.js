import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import {
  isSupportedAnswerAudience,
  resolveAnswerAudience,
  SUPPORTED_ANSWER_AUDIENCES
} from "../answer/answer-audience.js";
import { normalizeCodexExecutionError } from "./codex-installation.js";
import { DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT } from "./codex-defaults.js";

const DEFAULT_CODEX_TIMEOUT_MS = 300_000;
const FORCE_KILL_GRACE_PERIOD_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

export async function runCodexQuestion({
  question,
  audience,
  model,
  reasoningEffort,
  selectedRepos,
  workspaceRoot,
  onStatus,
  timeoutMs = DEFAULT_CODEX_TIMEOUT_MS
}) {
  const executionContext = getCodexExecutionContext({ question, audience, selectedRepos, workspaceRoot });
  const resolvedModel = model || DEFAULT_CODEX_MODEL;
  const resolvedReasoningEffort = reasoningEffort || DEFAULT_CODEX_REASONING_EFFORT;

  onStatus?.(
    `Running Codex in ${executionContext.workingDirectory} with ${resolvedModel} (${resolvedReasoningEffort})...`
  );

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
}) {
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

function createCodexOutputFilePath() {
  return path.join(
    os.tmpdir(),
    `archa-codex-${process.pid}-${Date.now()}-${randomUUID()}.txt`
  );
}

export function getCodexTimeoutMs(env = process.env) {
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

export function getCodexExecutionContext({ question, audience, selectedRepos, workspaceRoot }) {
  const workingDirectory = selectedRepos.length === 1 ? selectedRepos[0].directory : workspaceRoot;

  return {
    workingDirectory,
    prompt: buildPrompt(question, selectedRepos, audience)
  };
}

function buildPrompt(question, selectedRepos, audience) {
  const resolvedAudience = resolveAnswerAudience(audience);
  if (!isSupportedAnswerAudience(resolvedAudience)) {
    throw new Error(
      `Unsupported answer audience: ${resolvedAudience}. Use one of: ${SUPPORTED_ANSWER_AUDIENCES.join(", ")}.`
    );
  }

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
    '"""'
  ].join("\n");
}

function getAudiencePromptLines(audience) {
  if (audience === "codebase") {
    return [
      "Write for an engineer who can inspect this workspace. Be concrete about the implementation and mention relevant files, symbols, and execution flow when useful.",
      "Use code snippets when they help explain behavior or where to make changes."
    ];
  }

  return [
    "Write for a general engineering reader. Keep the answer self-contained and do not assume the reader can inspect this workspace.",
    "Use code snippets only when they help explain integration or behavior.",
    "Mention file paths or line numbers only when they are necessary."
  ];
}

async function runCodexExec({ prompt, model, reasoningEffort, outputFile, workingDirectory, onStatus, timeoutMs }) {
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

  const stopHeartbeat = startCodexHeartbeat(onStatus);

  try {
    await new Promise((resolve, reject) => {
      const child = spawn("codex", args, {
        stdio: ["pipe", "ignore", "pipe"]
      });

      let stderr = "";
      let settled = false;
      let forceKillTimer = null;

      const timeoutTimer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        onStatus?.(`Codex timed out after ${formatTimeoutDuration(timeoutMs)}; stopping...`);
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

      child.stderr.on("data", chunk => {
        stderr += chunk;
      });
      child.on("error", error => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);
        reject(normalizeCodexExecutionError(error));
      });
      child.on("close", code => {
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);

        if (settled) {
          return;
        }

        settled = true;
        if (code === 0) {
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

export function summarizeCodexStderr(stderr) {
  const lines = stderr
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  return lines.slice(-8).join("\n");
}

export function summarizeCodexTimeoutStderr(stderr) {
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

function formatCodexExecError(code, stderr) {
  const summary = summarizeCodexStderr(stderr);
  if (!summary) {
    return `codex exec failed with exit code ${code}`;
  }
  return `codex exec failed with exit code ${code}: ${summary}`;
}

function formatCodexTimeoutError(timeoutMs, stderr) {
  const summary = summarizeCodexTimeoutStderr(stderr);
  if (!summary) {
    return `codex exec timed out after ${formatTimeoutDuration(timeoutMs)}`;
  }

  return `codex exec timed out after ${formatTimeoutDuration(timeoutMs)}: ${summary}`;
}

function formatTimeoutDuration(timeoutMs) {
  if (timeoutMs % 1000 === 0) {
    return `${timeoutMs / 1000}s`;
  }

  return `${timeoutMs}ms`;
}

function cleanupTimedOutChild(child) {
  child.stdin.destroy?.();
  child.stderr.destroy?.();
}

function isRelevantTimeoutLine(line) {
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

function startCodexHeartbeat(onStatus) {
  if (!onStatus) {
    return () => {};
  }

  const startedAt = Date.now();
  const timer = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    onStatus(`Still running Codex... (${elapsedSeconds}s elapsed)`);
  }, HEARTBEAT_INTERVAL_MS);

  timer.unref?.();

  return () => {
    clearInterval(timer);
  };
}
