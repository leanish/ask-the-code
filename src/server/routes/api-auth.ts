import { createHmac, timingSafeEqual } from "node:crypto";

import type { Environment } from "../../core/types.ts";
import { HttpError } from "./api-helpers.ts";

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export type ApiInteraction = {
  interactionUser: string;
  conversationKey: string;
};

export function authenticateApiInteraction({
  bodyText,
  env,
  headers,
  now = () => new Date()
}: {
  bodyText: string;
  env: Environment;
  headers: Headers;
  now?: () => Date;
}): ApiInteraction {
  requireBearerToken(headers, env);

  const signingSecret = env.ATC_API_SIGNING_SECRET;
  if (!signingSecret) {
    throw new HttpError(503, "API ask is not configured. Set ATC_API_TOKEN and ATC_API_SIGNING_SECRET.");
  }

  const interactionUser = requireHeader(headers, "x-atc-interaction-user", "API ask requires X-ATC-Interaction-User.");
  const conversationKey = requireHeader(headers, "x-atc-conversation-key", "API ask requires X-ATC-Conversation-Key.");
  const timestamp = requireHeader(headers, "x-atc-interaction-timestamp", "API ask requires X-ATC-Interaction-Timestamp.");
  const signature = requireHeader(headers, "x-atc-interaction-signature", "API ask requires X-ATC-Interaction-Signature.");

  validateTimestamp(timestamp, now);
  validateSignature({
    bodyText,
    conversationKey,
    interactionUser,
    signature,
    signingSecret,
    timestamp
  });

  return {
    interactionUser,
    conversationKey
  };
}

function requireBearerToken(headers: Headers, env: Environment): void {
  const configuredToken = env.ATC_API_TOKEN;
  if (!configuredToken) {
    throw new HttpError(503, "API ask is not configured. Set ATC_API_TOKEN and ATC_API_SIGNING_SECRET.");
  }

  const authorization = headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1] ?? null;
  if (!token || !constantTimeEquals(token, configuredToken)) {
    throw new HttpError(401, "API ask requires a valid bearer token.");
  }
}

function validateTimestamp(timestamp: string, now: () => Date): void {
  const parsed = parseTimestamp(timestamp);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(401, "Invalid API interaction timestamp.");
  }

  if (Math.abs(now().getTime() - parsed) > MAX_TIMESTAMP_SKEW_MS) {
    throw new HttpError(401, "API interaction timestamp is outside the allowed clock skew.");
  }
}

function parseTimestamp(timestamp: string): number {
  if (/^\d+$/u.test(timestamp)) {
    const numericTimestamp = Number(timestamp);
    return numericTimestamp < 10_000_000_000 ? numericTimestamp * 1000 : numericTimestamp;
  }

  return Date.parse(timestamp);
}

function validateSignature({
  bodyText,
  conversationKey,
  interactionUser,
  signature,
  signingSecret,
  timestamp
}: {
  bodyText: string;
  conversationKey: string;
  interactionUser: string;
  signature: string;
  signingSecret: string;
  timestamp: string;
}): void {
  const expected = createHmac("sha256", signingSecret)
    .update(`${timestamp}\n${interactionUser}\n${conversationKey}\n${bodyText}`)
    .digest("hex");

  if (!constantTimeEquals(signature, expected)) {
    throw new HttpError(401, "Invalid API interaction signature.");
  }
}

function requireHeader(headers: Headers, name: string, message: string): string {
  const value = headers.get(name);
  if (!value || value.trim() === "") {
    throw new HttpError(401, message);
  }

  return value.trim();
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return false;
  }

  return timingSafeEqual(leftBytes, rightBytes);
}
