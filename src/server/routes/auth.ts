import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { Env, Hono } from "hono";

import type { Environment } from "../../core/types.ts";
import { clearCookie, parseCookies, serializeCookie } from "../http-cookies.ts";
import { HttpError } from "./api-helpers.ts";

const SESSION_COOKIE = "atc_session";
const OAUTH_STATE_COOKIE = "atc_oauth_state";
const OAUTH_STATE_MAX_AGE_SECONDS = 600;
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type AuthFetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type AuthRouteDeps = {
  env: Environment;
  fetchFn?: AuthFetchFn;
};
type GithubConfig = {
  clientId: string;
  clientSecret: string;
  authSecret: string;
  redirectUri: string | null;
};
type AuthUser = {
  email: string;
  name: string | null;
  picture: string | null;
};
type SessionCookiePayload = AuthUser & {
  iat: number;
  exp: number;
};
type AuthSessionResult = {
  session: AuthSession;
  refreshedCookie: string | null;
};
export type AuthSession = {
  authenticated: boolean;
  githubConfigured: boolean;
  user: AuthUser | null;
};

export function registerAuthRoutes<E extends Env>(app: Hono<E>, deps: AuthRouteDeps): void {
  const fetchFn = deps.fetchFn ?? fetch;

  app.get("/auth/session", c => {
    const result = getAuthSessionResult(c.req.header("cookie"), deps.env);
    const response = c.json(result.session);
    if (result.refreshedCookie) {
      response.headers.append("Set-Cookie", serializeSessionCookie(result.refreshedCookie, c.req.url));
    }
    return response;
  });

  app.get("/auth/github/start", c => {
    const config = requireGithubConfig(deps.env);
    const canonicalStartUrl = resolveCanonicalAuthStartUrl(config, c.req.url);
    if (canonicalStartUrl) {
      return redirectWithCookies(canonicalStartUrl, []);
    }

    const redirectUri = resolveRedirectUri(config, c.req.url);
    const state = createOauthState(config.authSecret);
    const authUrl = new URL("https://github.com/login/oauth/authorize");
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", "read:user user:email");
    authUrl.searchParams.set("state", state);

    return redirectWithCookies(authUrl.toString(), [
      serializeCookie(OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
        secure: shouldUseSecureCookies(c.req.url)
      })
    ]);
  });

  app.get("/auth/github/callback", async c => {
    const config = requireGithubConfig(deps.env);
    const cookies = parseCookies(c.req.header("cookie"));
    const expectedState = cookies[OAUTH_STATE_COOKIE];
    const actualState = c.req.query("state");
    const code = c.req.query("code");
    if (!actualState || !isValidOauthState(actualState, expectedState, config.authSecret)) {
      throw new HttpError(400, "Invalid GitHub SSO state.");
    }
    if (!code) {
      throw new HttpError(400, "GitHub SSO callback is missing an authorization code.");
    }

    const redirectUri = resolveRedirectUri(config, c.req.url);
    const tokenResponse = await fetchFn("https://github.com/login/oauth/access_token", {
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      method: "POST"
    });
    const tokenPayload = await readJsonObject(tokenResponse);
    if (!tokenResponse.ok || typeof tokenPayload.access_token !== "string") {
      throw new HttpError(502, "GitHub SSO token exchange failed.");
    }

    const accessToken = tokenPayload.access_token;
    const userInfoResponse = await fetchGithubApi(fetchFn, "https://api.github.com/user", accessToken);
    const userInfo = await readJsonObject(userInfoResponse);
    if (!userInfoResponse.ok || typeof userInfo.login !== "string" || userInfo.login.trim() === "") {
      throw new HttpError(502, "GitHub SSO user lookup failed.");
    }

    const email = await resolveGithubEmail(fetchFn, accessToken, userInfo);
    const login = userInfo.login.trim();
    const user: AuthUser = {
      email,
      name: typeof userInfo.name === "string" && userInfo.name.trim() !== "" ? userInfo.name.trim() : login,
      picture: typeof userInfo.avatar_url === "string" && userInfo.avatar_url.trim() !== "" ? userInfo.avatar_url.trim() : null
    };

    return redirectWithCookies("/", [
      serializeSessionCookie(createSessionCookieValue(user, config.authSecret), c.req.url),
      clearCookie(OAUTH_STATE_COOKIE, {
        httpOnly: true,
        secure: shouldUseSecureCookies(c.req.url)
      })
    ]);
  });

  app.post("/auth/logout", c => {
    const config = readGithubConfig(deps.env);
    const headers = new Headers({
      "Content-Type": "application/json"
    });
    headers.append("Set-Cookie", clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: shouldUseSecureCookies(c.req.url)
    }));
    return new Response(JSON.stringify({ ok: true }), {
      headers,
      status: 200
    });
  });
}

export function getAuthSession(cookieHeader: string | undefined, env: Environment): AuthSession {
  return getAuthSessionResult(cookieHeader, env).session;
}

export function getAuthSessionResult(cookieHeader: string | undefined, env: Environment): AuthSessionResult {
  const config = readGithubConfig(env);
  const user = config.authSecret
    ? verifySessionCookie(parseCookies(cookieHeader)[SESSION_COOKIE], config.authSecret)
    : null;
  const session = {
    authenticated: user !== null,
    githubConfigured: isGithubConfigured(config),
    user
  };

  return {
    session,
    refreshedCookie: user && config.authSecret ? createSessionCookieValue(user, config.authSecret) : null
  };
}

export function validateAuthConfig(env: Environment): void {
  const config = readGithubConfig(env);
  const configuredCount = [config.clientId, config.clientSecret, config.authSecret]
    .filter(value => value !== "")
    .length;
  if (configuredCount !== 0 && configuredCount !== 3) {
    throw new Error("Set all GitHub SSO env vars or none of them: ATC_GITHUB_CLIENT_ID, ATC_GITHUB_CLIENT_SECRET, and ATC_AUTH_SECRET.");
  }
}

export function createSessionCookieValue(user: AuthUser, secret: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    ...user,
    iat: issuedAt,
    exp: issuedAt + SESSION_MAX_AGE_SECONDS
  } satisfies SessionCookiePayload), "utf8").toString("base64url");
  const signature = signSessionPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function serializeRefreshedSessionCookie(cookieValue: string, requestUrl: string): string {
  return serializeSessionCookie(cookieValue, requestUrl);
}

function serializeSessionCookie(cookieValue: string, requestUrl: string): string {
  return serializeCookie(SESSION_COOKIE, cookieValue, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: shouldUseSecureCookies(requestUrl)
  });
}

function verifySessionCookie(value: string | undefined, secret: string): AuthUser | null {
  if (!value) {
    return null;
  }

  const [payload, signature] = value.split(".");
  if (!payload || !signature) {
    return null;
  }

  if (!safeEqual(signature, signSessionPayload(payload, secret))) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionCookiePayload>;
    if (typeof parsed.email !== "string" || parsed.email.trim() === "") {
      return null;
    }
    if (typeof parsed.iat !== "number" || typeof parsed.exp !== "number") {
      return null;
    }
    if (parsed.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      email: parsed.email,
      name: typeof parsed.name === "string" ? parsed.name : null,
      picture: typeof parsed.picture === "string" ? parsed.picture : null
    };
  } catch {
    return null;
  }
}

function signSessionPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createOauthState(secret: string): string {
  const nonce = randomBytes(24).toString("base64url");
  return `${nonce}.${signOauthStateNonce(nonce, secret)}`;
}

function isValidOauthState(actualState: string, expectedCookieState: string | undefined, secret: string): boolean {
  if (!expectedCookieState || !safeEqual(actualState, expectedCookieState)) {
    return false;
  }

  const [nonce, signature] = actualState.split(".");
  if (!nonce || !signature) {
    return false;
  }

  return safeEqual(signature, signOauthStateNonce(nonce, secret));
}

function signOauthStateNonce(nonce: string, secret: string): string {
  return createHmac("sha256", secret).update(`oauth-state:${nonce}`).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
}

function readGithubConfig(env: Environment): GithubConfig {
  return {
    clientId: env.ATC_GITHUB_CLIENT_ID?.trim() ?? "",
    clientSecret: env.ATC_GITHUB_CLIENT_SECRET?.trim() ?? "",
    authSecret: env.ATC_AUTH_SECRET?.trim() ?? "",
    redirectUri: env.ATC_GITHUB_REDIRECT_URI?.trim() || null
  };
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => ({})) as unknown;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function readJsonArray(response: Response): Promise<unknown[]> {
  const value = await response.json().catch(() => []) as unknown;
  return Array.isArray(value) ? value : [];
}

function requireGithubConfig(env: Environment): GithubConfig & { clientId: string; clientSecret: string; authSecret: string } {
  const config = readGithubConfig(env);
  if (!isGithubConfigured(config)) {
    throw new HttpError(503, "GitHub SSO is not configured. Set ATC_GITHUB_CLIENT_ID, ATC_GITHUB_CLIENT_SECRET, and ATC_AUTH_SECRET.");
  }

  return config;
}

function isGithubConfigured(config: GithubConfig): boolean {
  return config.clientId !== "" && config.clientSecret !== "" && config.authSecret !== "";
}

function resolveRedirectUri(config: GithubConfig, requestUrl: string): string {
  if (config.redirectUri) {
    return config.redirectUri;
  }

  return new URL("/auth/github/callback", requestUrl).toString();
}

function resolveCanonicalAuthStartUrl(config: GithubConfig, requestUrl: string): string | null {
  if (!config.redirectUri) {
    return null;
  }

  const request = new URL(requestUrl);
  const redirect = new URL(config.redirectUri);
  if (request.origin === redirect.origin) {
    return null;
  }

  return new URL("/auth/github/start", redirect.origin).toString();
}

async function resolveGithubEmail(
  fetchFn: AuthFetchFn,
  accessToken: string,
  userInfo: Record<string, unknown>
): Promise<string> {
  if (typeof userInfo.email === "string" && userInfo.email.trim() !== "") {
    return userInfo.email.trim();
  }

  const emailsResponse = await fetchGithubApi(fetchFn, "https://api.github.com/user/emails", accessToken);
  const emails = await readJsonArray(emailsResponse);
  let primaryEmail: { email: string; primary: boolean; verified: boolean } | undefined;
  let verifiedEmail: { email: string; primary: boolean; verified: boolean } | undefined;
  for (const value of emails) {
    const candidate = toGithubEmail(value);
    if (!candidate.verified) {
      continue;
    }
    if (candidate.primary) {
      primaryEmail = candidate;
      break;
    }
    verifiedEmail ??= candidate;
  }
  const selectedEmail = primaryEmail ?? verifiedEmail;
  if (emailsResponse.ok && selectedEmail) {
    return selectedEmail.email;
  }

  if (typeof userInfo.login === "string" && userInfo.login.trim() !== "") {
    return `${userInfo.login.trim()}@users.noreply.github.com`;
  }

  throw new HttpError(502, "GitHub SSO email lookup failed.");
}

function toGithubEmail(value: unknown): { email: string; primary: boolean; verified: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { email: "", primary: false, verified: false };
  }

  const item = value as Record<string, unknown>;
  return {
    email: typeof item.email === "string" ? item.email.trim() : "",
    primary: item.primary === true,
    verified: item.verified === true
  };
}

function fetchGithubApi(fetchFn: AuthFetchFn, url: string, accessToken: string): Promise<Response> {
  return fetchFn(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "ask-the-code"
    }
  });
}

function shouldUseSecureCookies(requestUrl: string): boolean {
  return new URL(requestUrl).protocol === "https:";
}

function redirectWithCookies(location: string, cookies: string[]): Response {
  const headers = new Headers({
    Location: location
  });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }

  return new Response(null, {
    headers,
    status: 302
  });
}
