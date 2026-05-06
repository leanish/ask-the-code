import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { Environment } from "../../core/types.ts";

export interface SessionPayload {
  sub: string;
  login: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  expiresAt: number;
}

export const SESSION_COOKIE_NAME = "atc_session";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function getSessionSecret(env: Environment = process.env): string | null {
  const value = env.ATC_SESSION_SECRET?.trim();
  return value && value.length >= 16 ? value : null;
}

export function encodeSession(payload: SessionPayload, secret: string): string {
  const body = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = sign(body, secret);
  return `${body}.${signature}`;
}

export function decodeSession(token: string, secret: string): SessionPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!verify(body, sig, secret)) return null;
  try {
    const decoded = JSON.parse(base64UrlDecode(body).toString("utf8")) as SessionPayload;
    if (typeof decoded.sub !== "string" || typeof decoded.login !== "string") return null;
    if (typeof decoded.expiresAt !== "number" || decoded.expiresAt < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function buildSessionCookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax; HttpOnly`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`;
}

export function readSessionFromCookie(
  cookieHeader: string | undefined,
  secret: string
): SessionPayload | null {
  const value = readCookie(cookieHeader, SESSION_COOKIE_NAME);
  return value ? decodeSession(value, secret) : null;
}

export function generateOauthState(): string {
  return base64UrlEncode(randomBytes(24));
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("=") ?? "");
  }
  return undefined;
}

function sign(body: string, secret: string): string {
  return base64UrlEncode(createHmac("sha256", secret).update(body).digest());
}

function verify(body: string, signature: string, secret: string): boolean {
  const expected = sign(body, secret);
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Buffer {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
