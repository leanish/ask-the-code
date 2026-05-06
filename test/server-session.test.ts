import { describe, expect, it } from "vitest";

import {
  buildSessionCookie,
  clearSessionCookie,
  decodeSession,
  encodeSession,
  generateOauthState,
  getSessionSecret,
  readSessionFromCookie,
  type SessionPayload
} from "../src/server/auth/session.ts";

const session: SessionPayload = {
  sub: "github:123",
  login: "octo",
  name: "Octo Cat",
  email: "octo@example.test",
  avatarUrl: "https://example.test/avatar.png",
  expiresAt: Date.now() + 60_000
};

describe("session helpers", () => {
  it("reads only sufficiently long session secrets", () => {
    expect(getSessionSecret({ ATC_SESSION_SECRET: " 1234567890abcdef " })).toBe("1234567890abcdef");
    expect(getSessionSecret({ ATC_SESSION_SECRET: "short" })).toBeNull();
    expect(getSessionSecret({})).toBeNull();
  });

  it("encodes, reads, and clears signed session cookies", () => {
    const token = encodeSession(session, "1234567890abcdef");
    const cookie = `theme=dark; ${buildSessionCookie(token, 60)}; other=value`;

    expect(decodeSession(token, "1234567890abcdef")).toEqual(session);
    expect(readSessionFromCookie(cookie, "1234567890abcdef")).toEqual(session);
    expect(clearSessionCookie()).toBe("atc_session=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly");
  });

  it("rejects malformed, tampered, expired, and structurally invalid sessions", () => {
    const token = encodeSession(session, "1234567890abcdef");
    const expired = encodeSession({ ...session, expiresAt: Date.now() - 1 }, "1234567890abcdef");
    const invalidShape = encodeSession({ ...session, login: 123 } as unknown as SessionPayload, "1234567890abcdef");

    expect(decodeSession("missing-dot", "1234567890abcdef")).toBeNull();
    expect(decodeSession(`${token}x`, "1234567890abcdef")).toBeNull();
    expect(decodeSession(expired, "1234567890abcdef")).toBeNull();
    expect(decodeSession(invalidShape, "1234567890abcdef")).toBeNull();
    expect(readSessionFromCookie(undefined, "1234567890abcdef")).toBeNull();
  });

  it("generates oauth states that are safe for cookies and urls", () => {
    const state = generateOauthState();

    expect(state).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(state.length).toBeGreaterThan(20);
  });
});
