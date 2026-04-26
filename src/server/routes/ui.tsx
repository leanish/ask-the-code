import type { Env, Hono } from "hono";

import { AppPage } from "../ui/pages/app-page.tsx";

type UiMode = "simple" | "expert";

export function registerUiRoutes<E extends Env>(app: Hono<E>): void {
  app.get("/", c => {
    const urlMode = normalizeMode(c.req.query("mode"));
    const mode = urlMode ?? normalizeMode(readCookie(c.req.header("Cookie"), "atc_mode")) ?? "simple";

    if (urlMode) {
      c.header("Set-Cookie", formatModeCookie(urlMode));
    }

    return c.html(`<!DOCTYPE html>${String(<AppPage mode={mode} />)}`, 200, {
      "Cache-Control": "no-cache"
    });
  });
}

function normalizeMode(value: string | undefined): UiMode | null {
  return value === "simple" || value === "expert" ? value : null;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return undefined;
}

function formatModeCookie(mode: UiMode): string {
  return `atc_mode=${mode}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
