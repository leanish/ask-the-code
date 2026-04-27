import type { Hono } from "hono";

import type { AppEnv } from "../app.ts";
import { AppPage, type AppMode } from "../ui/pages/app-page.tsx";

const COOKIE_NAME = "atc_mode";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function registerUiRoutes(app: Hono<AppEnv>): void {
  app.get("/", c => {
    const queryMode = parseMode(c.req.query("mode"));
    const cookieMode = parseMode(readCookie(c.req.header("cookie"), COOKIE_NAME));
    const mode: AppMode = queryMode ?? cookieMode ?? "simple";

    if (queryMode) {
      c.header("Set-Cookie", buildCookie(COOKIE_NAME, queryMode, COOKIE_MAX_AGE));
    }

    return c.html(`<!doctype html>${(<AppPage mode={mode} />).toString()}`);
  });
}

function parseMode(value: string | undefined | null): AppMode | null {
  if (value === "simple" || value === "expert") {
    return value;
  }
  return null;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("=") ?? "");
    }
  }
  return undefined;
}

function buildCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}
