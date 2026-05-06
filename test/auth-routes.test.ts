import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../src/server/app.ts";
import {
  buildSessionCookie,
  encodeSession,
  type SessionPayload
} from "../src/server/auth/session.ts";
import { HttpError } from "../src/server/routes/api-helpers.ts";
import { registerAuthRoutes } from "../src/server/routes/auth.ts";
import type { Environment } from "../src/core/types.ts";

const configuredEnv: Environment = {
  ATC_GITHUB_CLIENT_ID: "client-id",
  ATC_GITHUB_CLIENT_SECRET: "client-secret",
  ATC_GITHUB_REDIRECT_URI: "http://localhost/auth/github/callback",
  ATC_SESSION_SECRET: "1234567890abcdef"
};

describe("auth routes", () => {
  it("reports auth configuration and current session state", async () => {
    const app = buildAuthApp(configuredEnv);
    const session = encodeSession(createSession(), configuredEnv.ATC_SESSION_SECRET!);

    const unauthenticated = await app.request("/auth/me");
    const authenticated = await app.request("/auth/me", {
      headers: { cookie: buildSessionCookie(session, 60) }
    });
    const unconfigured = await buildAuthApp({}).request("/auth/me");

    expect(await unauthenticated.json()).toEqual({ authenticated: false, configured: true });
    expect(await authenticated.json()).toMatchObject({
      authenticated: true,
      configured: true,
      user: {
        sub: "github:123",
        login: "octo",
        name: "Octo Cat",
        email: null,
        avatarUrl: null
      }
    });
    expect(await unconfigured.json()).toEqual({ authenticated: false, configured: false });
  });

  it("starts the GitHub OAuth flow when configured", async () => {
    const response = await buildAuthApp(configuredEnv).request("/auth/github/login");

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toContain("atc_oauth_state=");
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-id");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost/auth/github/callback");
    expect(location.searchParams.get("scope")).toBe("read:user user:email");
    expect(location.searchParams.get("state")).toBeTruthy();
  });

  it("rejects invalid OAuth callbacks before contacting GitHub", async () => {
    const app = buildAuthApp(configuredEnv);

    const missingCode = await app.request("/auth/github/callback?state=s", {
      headers: { cookie: "atc_oauth_state=s" }
    });
    const badState = await app.request("/auth/github/callback?code=c&state=wrong", {
      headers: { cookie: "atc_oauth_state=s" }
    });

    expect(missingCode.status).toBe(400);
    expect(await missingCode.json()).toEqual({ error: 'Missing "code" query parameter.' });
    expect(badState.status).toBe(400);
    expect(await badState.json()).toEqual({ error: "OAuth state mismatch." });
  });

  it("creates a signed session after a successful OAuth callback", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token" }))
      .mockResolvedValueOnce(jsonResponse({
        id: 123,
        login: "octo",
        name: null,
        email: null,
        avatar_url: "https://example.test/avatar.png"
      }))
      .mockResolvedValueOnce(jsonResponse([{ email: "octo@example.test", primary: true, verified: true }]));
    const app = buildAuthApp(configuredEnv, fetchFn);

    const response = await app.request("/auth/github/callback?code=code&state=state", {
      headers: { cookie: "atc_oauth_state=state" }
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain("atc_session=");
    expect(response.headers.get("set-cookie")).toContain("atc_oauth_state=;");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("reports OAuth provider failures and clears sessions on logout", async () => {
    const failingFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: "bad" }, { ok: false, status: 502 }));
    const app = buildAuthApp(configuredEnv, failingFetch);

    const tokenFailure = await app.request("/auth/github/callback?code=code&state=state", {
      headers: { cookie: "atc_oauth_state=state" }
    });
    const logout = await app.request("/auth/logout", { method: "POST" });
    const unconfiguredLogin = await buildAuthApp({}).request("/auth/github/login");

    expect(tokenFailure.status).toBe(502);
    expect(await tokenFailure.json()).toEqual({ error: "GitHub token exchange failed (502)." });
    expect(logout.headers.get("set-cookie")).toBe("atc_session=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly");
    expect(await logout.json()).toEqual({ ok: true });
    expect(unconfiguredLogin.status).toBe(503);
  });
});

function buildAuthApp(env: Environment, fetchFn: typeof fetch = vi.fn<typeof fetch>()): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  registerAuthRoutes(app, { env, fetchFn });
  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: error.message }, error.statusCode as never);
    }
    throw error;
  });
  return app;
}

function createSession(): SessionPayload {
  return {
    sub: "github:123",
    login: "octo",
    name: "Octo Cat",
    email: null,
    avatarUrl: null,
    expiresAt: Date.now() + 60_000
  };
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const status = init.status ?? 200;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
