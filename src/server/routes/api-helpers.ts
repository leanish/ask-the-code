import {
  DEFAULT_ANSWER_AUDIENCE,
  isSupportedAnswerAudience,
  SUPPORTED_ANSWER_AUDIENCES
} from "../../core/answer/answer-audience.ts";
import { SUPPORTED_SELECTION_STRATEGIES, isSelectionStrategy } from "../../core/repos/selection-strategies.ts";
import type {
  AskAttachment,
  AskJobManager,
  AskJobSnapshot,
  AskRequest,
  Environment,
  LoadedConfig,
  ManagedRepoDefinition,
  RepoSelectionStrategy
} from "../../core/types.ts";

export const DEFAULT_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 8;
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export type ServerJobManager = Pick<AskJobManager, "createJob" | "getJob" | "subscribe"> & Partial<Pick<AskJobManager, "getStats">>;
export type LoadedRepoList = Pick<LoadedConfig, "repos">;
export type LoadRepoListFn = (env: Environment) => Promise<LoadedRepoList>;
export type ApiRouteDeps = {
  jobManager: ServerJobManager;
  bodyLimitBytes: number;
  env: Environment;
  loadConfigFn: LoadRepoListFn;
};

export async function readJsonBody(request: Request, bodyLimitBytes: number): Promise<unknown> {
  const body = await readLimitedRequestBodyText(request, bodyLimitBytes);

  if (body === "") {
    throw new HttpError(400, "Request body must be valid JSON.");
  }

  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, `Request body must be valid JSON: ${message}`);
  }
}

export async function readLimitedRequestBodyText(request: Request, bodyLimitBytes: number): Promise<string> {
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > bodyLimitBytes) {
      try {
        await reader.cancel();
      } catch {
        // The response status is already determined; do not mask the 413 error.
      }
      throw new HttpError(413, `Request body exceeds ${bodyLimitBytes} bytes.`);
    }

    chunks.push(value);
  }

  return new TextDecoder().decode(mergeChunks(chunks, totalBytes));
}

function mergeChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  if (chunks.length === 0) {
    return new Uint8Array();
  }

  if (chunks.length === 1) {
    return chunks[0] ?? new Uint8Array();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
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
    attachments: normalizeAttachments(requestBody.attachments),
    repoNames: normalizeRepoNames(requestBody.repoNames ?? requestBody.repos),
    ...(audience === undefined ? {} : { audience }),
    model: normalizeOptionalString(requestBody.model, "model"),
    reasoningEffort: normalizeOptionalString(requestBody.reasoningEffort, "reasoningEffort"),
    selectionMode: normalizeSelectionMode(requestBody.selectionMode),
    selectionShadowCompare: normalizeOptionalBoolean(requestBody.selectionShadowCompare, "selectionShadowCompare"),
    noSync: normalizeOptionalBoolean(requestBody.noSync, "noSync"),
    noSynthesis: normalizeOptionalBoolean(requestBody.noSynthesis, "noSynthesis")
  };
}

export function normalizeApiAskRequest(body: unknown): Partial<AskRequest> & Pick<AskRequest, "question"> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const requestBody = body as Record<string, unknown>;
  const allowedFields = new Set(["question", "attachments"]);
  const extraFields = Object.keys(requestBody).filter(field => !allowedFields.has(field));
  if (extraFields.length > 0) {
    throw new HttpError(
      400,
      `API ask only accepts "question" and "attachments". Remove: ${extraFields.join(", ")}.`
    );
  }

  if (typeof requestBody.question !== "string" || requestBody.question.trim() === "") {
    throw new HttpError(400, 'Request body must include a non-empty "question" string.');
  }

  return {
    question: requestBody.question,
    attachments: normalizeAttachments(requestBody.attachments)
  };
}

function normalizeAttachments(value: unknown): AskAttachment[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new HttpError(400, '"attachments" must be an array when provided.');
  }

  if (value.length > MAX_ATTACHMENTS) {
    throw new HttpError(400, `"attachments" must include at most ${MAX_ATTACHMENTS} files.`);
  }

  let totalBytes = 0;
  const attachments = value.map((item, index) => {
    const attachment = normalizeAttachment(item, index);
    totalBytes += getBase64DecodedBytes(attachment.contentBase64);
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new HttpError(400, `"attachments" must be at most ${MAX_TOTAL_ATTACHMENT_BYTES} decoded bytes in total.`);
    }
    return attachment;
  });

  return attachments;
}

function normalizeAttachment(value: unknown, index: number): AskAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `"attachments[${index}]" must be a JSON object.`);
  }

  const attachment = value as Record<string, unknown>;
  const name = normalizeAttachmentString(attachment.name, `attachments[${index}].name`, 200);
  const mediaType = normalizeAttachmentString(attachment.mediaType, `attachments[${index}].mediaType`, 100);
  const contentBase64 = normalizeBase64Content(attachment.contentBase64, index);
  const decodedBytes = getBase64DecodedBytes(contentBase64);
  if (decodedBytes > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(400, `"attachments[${index}]" exceeds ${MAX_ATTACHMENT_BYTES} decoded bytes.`);
  }

  return {
    name,
    mediaType,
    contentBase64
  };
}

function normalizeAttachmentString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `"${label}" must be a non-empty string.`);
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpError(400, `"${label}" must be at most ${maxLength} characters.`);
  }

  return normalized;
}

function normalizeBase64Content(value: unknown, index: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `"attachments[${index}].contentBase64" must be a non-empty base64 string.`);
  }

  const normalized = value.replace(/\s/gu, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized) || normalized.length % 4 === 1) {
    throw new HttpError(400, `"attachments[${index}].contentBase64" must be a non-empty base64 string.`);
  }

  const decoded = Buffer.from(normalized, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/u, "");
  if (decoded.length === 0 || canonical !== normalized.replace(/=+$/u, "")) {
    throw new HttpError(400, `"attachments[${index}].contentBase64" must be a non-empty base64 string.`);
  }

  return normalized;
}

function getBase64DecodedBytes(contentBase64: string): number {
  return Buffer.from(contentBase64, "base64").byteLength;
}

export function withJobLinks(job: AskJobSnapshot): AskJobSnapshot & { links: { self: string; events: string } } {
  return {
    ...job,
    links: {
      self: `/jobs/${encodeURIComponent(job.id)}`,
      events: `/jobs/${encodeURIComponent(job.id)}/events`
    }
  };
}

export function serializeRepoSummary(
  repo: Pick<ManagedRepoDefinition, "name" | "defaultBranch" | "description" | "aliases">
): Pick<ManagedRepoDefinition, "name" | "defaultBranch" | "description" | "aliases"> {
  return {
    name: repo.name,
    defaultBranch: repo.defaultBranch,
    description: repo.description,
    aliases: repo.aliases
  };
}

export function getEmptyConfigSetupHint(): string {
  return 'No configured repos available. Try "atc config discover-github" to discover and add repos.';
}

export function isTerminalStatus(status: string): boolean {
  return status === "completed" || status === "failed";
}

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
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

  throw new HttpError(400, '"repoNames" must be a comma-separated string or an array of non-empty strings.');
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

  throw new HttpError(400, `"selectionMode" must be one of: ${SUPPORTED_SELECTION_STRATEGIES.join(", ")}.`);
}

function hasOwn(object: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, property);
}
