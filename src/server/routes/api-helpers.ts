import {
  DEFAULT_ANSWER_AUDIENCE,
  isSupportedAnswerAudience,
  SUPPORTED_ANSWER_AUDIENCES
} from "../../core/answer/answer-audience.ts";
import {
  SUPPORTED_SELECTION_STRATEGIES,
  isSelectionStrategy
} from "../../core/repos/selection-strategies.ts";
import type { AskRequest, RepoSelectionStrategy } from "../../core/types.ts";

export const DEFAULT_BODY_LIMIT_BYTES = 65_536;

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function readJsonBody(request: Request, bodyLimitBytes: number): Promise<unknown> {
  const body = request.body;
  if (!body) {
    throw new HttpError(400, "Request body must be valid JSON.");
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.length;
      if (totalBytes > bodyLimitBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore cancellation errors */
        }
        throw new HttpError(413, `Request body exceeds ${bodyLimitBytes} bytes.`);
      }
      chunks.push(value);
    }
  }

  if (chunks.length === 0) {
    throw new HttpError(400, "Request body must be valid JSON.");
  }

  const merged = mergeChunks(chunks, totalBytes);
  const text = new TextDecoder("utf-8").decode(merged);
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, `Request body must be valid JSON: ${message}`);
  }
}

function mergeChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function normalizeAskRequest(body: unknown): AskRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const requestBody = body as Record<string, unknown>;

  if (hasOwn(requestBody, "repoNames") && hasOwn(requestBody, "repos")) {
    throw new HttpError(400, 'Use either "repoNames" or "repos", not both.');
  }

  if (typeof requestBody.question !== "string" || requestBody.question.trim() === "") {
    throw new HttpError(400, 'Request body must include a non-empty "question" string.');
  }

  const audience = normalizeAudience(requestBody.audience);

  return {
    question: requestBody.question,
    repoNames: normalizeRepoNames(requestBody.repoNames ?? requestBody.repos),
    ...(audience === undefined ? {} : { audience }),
    model: normalizeOptionalString(requestBody.model, "model"),
    reasoningEffort: normalizeOptionalString(requestBody.reasoningEffort, "reasoningEffort"),
    selectionMode: normalizeSelectionMode(requestBody.selectionMode),
    selectionShadowCompare: normalizeOptionalBoolean(
      requestBody.selectionShadowCompare,
      "selectionShadowCompare"
    ),
    noSync: normalizeOptionalBoolean(requestBody.noSync, "noSync"),
    noSynthesis: normalizeOptionalBoolean(requestBody.noSynthesis, "noSynthesis")
  };
}

function normalizeRepoNames(value: unknown): string[] | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const repoNames = value
      .split(",")
      .map(name => name.trim())
      .filter(Boolean);
    return repoNames.length > 0 ? repoNames : null;
  }

  if (Array.isArray(value) && value.every(item => typeof item === "string" && item.trim() !== "")) {
    return value.map(item => item.trim());
  }

  throw new HttpError(
    400,
    '"repoNames" must be a comma-separated string or an array of non-empty strings.'
  );
}

function normalizeAudience(value: unknown): AskRequest["audience"] {
  if (value == null) {
    return DEFAULT_ANSWER_AUDIENCE;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `"audience" must be one of: ${SUPPORTED_ANSWER_AUDIENCES.join(", ")}.`);
  }

  const audience = value.trim();
  if (!isSupportedAnswerAudience(audience)) {
    throw new HttpError(400, `"audience" must be one of: ${SUPPORTED_ANSWER_AUDIENCES.join(", ")}.`);
  }

  return audience;
}

function normalizeOptionalString(value: unknown, label: string): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `"${label}" must be a non-empty string when provided.`);
  }

  return value;
}

function normalizeOptionalBoolean(value: unknown, label: string): boolean {
  if (value == null) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new HttpError(400, `"${label}" must be a boolean when provided.`);
  }

  return value;
}

function normalizeSelectionMode(value: unknown): RepoSelectionStrategy {
  if (value == null) {
    return "single";
  }

  if (isSelectionStrategy(value)) {
    return value;
  }

  throw new HttpError(
    400,
    `"selectionMode" must be one of: ${SUPPORTED_SELECTION_STRATEGIES.join(", ")}.`
  );
}

function hasOwn(object: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, property);
}

export function withJobLinks<T extends { id: string }>(
  job: T
): T & { links: { self: string; events: string } } {
  return {
    ...job,
    links: {
      self: `/jobs/${encodeURIComponent(job.id)}`,
      events: `/jobs/${encodeURIComponent(job.id)}/events`
    }
  };
}

export function isTerminalStatus(status: string): boolean {
  return status === "completed" || status === "failed";
}
