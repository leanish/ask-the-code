import type { Env, Hono } from "hono";

import { parseCookies, serializeCookie } from "../http-cookies.ts";
import { AppPage } from "../ui/pages/app-page.tsx";

type UiMode = "simple" | "advanced";
const MODE_COOKIE_MAX_AGE_SECONDS = 31_536_000;

export function registerUiRoutes<E extends Env>(app: Hono<E>): void {
  app.get("/", c => {
    const urlMode = normalizeMode(c.req.query("mode"));
    const mode = urlMode ?? normalizeMode(parseCookies(c.req.header("Cookie")).atc_mode) ?? "simple";

    if (urlMode) {
      c.header("Set-Cookie", formatModeCookie(urlMode));
    }

    return c.html(`<!DOCTYPE html>${String(<AppPage mode={mode} />)}`, 200, {
      "Cache-Control": "no-cache"
    });
  });
}

function normalizeMode(value: string | undefined): UiMode | null {
  return value === "simple" || value === "advanced" ? value : null;
}

function formatModeCookie(mode: UiMode): string {
  return serializeCookie("atc_mode", mode, {
    maxAge: MODE_COOKIE_MAX_AGE_SECONDS
  });
}
