import type { Context, Hono } from "hono";

import type { AppEnv } from "../app.ts";
import {
  buildSessionCookie,
  clearSessionCookie,
  encodeSession,
  generateOauthState,
  getSessionSecret,
  readSessionFromCookie,
  SESSION_DURATION_MS,
  type SessionPayload
} from "../auth/session.ts";
import { HttpError } from "./api-helpers.ts";
import type { Environment } from "../../core/types.ts";

const STATE_COOKIE_NAME = "atc_oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 600;

export interface AuthDeps {
  env?: Environment;
  fetchFn?: typeof fetch;
}

export function registerAuthRoutes(app: Hono<AppEnv>, deps: AuthDeps = {}): void {
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;

  app.get("/auth/me", c => {
    const config = readGithubConfig(env);
    const secret = getSessionSecret(env);
    if (!config || !secret) {
      return c.json({ authenticated: false, configured: false });
    }
    const session = readSessionFromCookie(c.req.header("cookie"), secret);
    if (!session) {
      return c.json({ authenticated: false, configured: true });
    }
    return c.json({
      authenticated: true,
      configured: true,
      user: {
        sub: session.sub,
        login: session.login,
        name: session.name,
        email: session.email,
        avatarUrl: session.avatarUrl
      }
    });
  });

  app.get("/auth/github/login", c => {
    const config = readGithubConfig(env);
    if (!config) {
      throw new HttpError(503, "GitHub sign-in is not configured. Set ATC_GITHUB_CLIENT_ID, ATC_GITHUB_CLIENT_SECRET, and ATC_SESSION_SECRET.");
    }
    const state = generateOauthState();
    c.header("Set-Cookie", `${STATE_COOKIE_NAME}=${state}; Path=/; Max-Age=${STATE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax; HttpOnly`);
    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizeUrl.searchParams.set("scope", "read:user user:email");
    authorizeUrl.searchParams.set("state", state);
    return c.redirect(authorizeUrl.toString());
  });

  app.get("/auth/github/callback", async c => {
    const config = readGithubConfig(env);
    const secret = getSessionSecret(env);
    if (!config || !secret) {
      throw new HttpError(503, "GitHub sign-in is not configured.");
    }

    const code = c.req.query("code");
    const stateFromQuery = c.req.query("state");
    const stateFromCookie = readCookieValue(c.req.header("cookie"), STATE_COOKIE_NAME);
    if (!code) throw new HttpError(400, 'Missing "code" query parameter.');
    if (!stateFromQuery || !stateFromCookie || stateFromQuery !== stateFromCookie) {
      throw new HttpError(400, "OAuth state mismatch.");
    }

    const tokenResponse = await fetchFn("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        state: stateFromQuery
      })
    });
    if (!tokenResponse.ok) {
      throw new HttpError(502, `GitHub token exchange failed (${tokenResponse.status}).`);
    }
    const tokenJson = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenJson.access_token) {
      throw new HttpError(
        502,
        `GitHub did not return an access token: ${tokenJson.error_description ?? tokenJson.error ?? "unknown error"}.`
      );
    }

    const profile = await fetchGithubProfile(fetchFn, tokenJson.access_token);
    const session: SessionPayload = {
      sub: `github:${profile.id}`,
      login: profile.login,
      name: profile.name ?? profile.login,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      expiresAt: Date.now() + SESSION_DURATION_MS
    };

    c.header(
      "Set-Cookie",
      [
        buildSessionCookie(encodeSession(session, secret), Math.floor(SESSION_DURATION_MS / 1000)),
        `${STATE_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`
      ].join(", ")
    );
    return c.redirect("/");
  });

  app.post("/auth/logout", c => {
    c.header("Set-Cookie", clearSessionCookie());
    return c.json({ ok: true });
  });
}

function readCookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("=") ?? "");
  }
  return undefined;
}

interface GithubOauthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function readGithubConfig(env: Environment): GithubOauthConfig | null {
  const clientId = env.ATC_GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.ATC_GITHUB_CLIENT_SECRET?.trim();
  const redirectUri =
    env.ATC_GITHUB_REDIRECT_URI?.trim() || "http://127.0.0.1:8787/auth/github/callback";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

async function fetchGithubProfile(
  fetchFn: typeof fetch,
  accessToken: string
): Promise<GithubProfile> {
  const userResponse = await fetchFn("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ask-the-code"
    }
  });
  if (!userResponse.ok) {
    throw new HttpError(502, `GitHub /user request failed (${userResponse.status}).`);
  }
  const user = (await userResponse.json()) as {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  };

  let email = user.email;
  if (!email) {
    try {
      const emailResponse = await fetchFn("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "ask-the-code"
        }
      });
      if (emailResponse.ok) {
        const emails = (await emailResponse.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = emails.find(e => e.primary && e.verified);
        email = primary?.email ?? emails.find(e => e.verified)?.email ?? null;
      }
    } catch {
      /* email is best-effort */
    }
  }

  return {
    id: user.id,
    login: user.login,
    name: user.name,
    email,
    avatarUrl: user.avatar_url
  };
}

export function withSession<T>(c: Context<AppEnv>, handler: (session: SessionPayload | null) => T, env: Environment = process.env): T {
  const secret = getSessionSecret(env);
  const session = secret ? readSessionFromCookie(c.req.header("cookie"), secret) : null;
  return handler(session);
}
