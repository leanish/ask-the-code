export type CookieOptions = {
  httpOnly?: boolean;
  maxAge?: number;
  secure?: boolean;
};

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (!name || valueParts.length === 0) {
      continue;
    }
    try {
      cookies[name] = decodeURIComponent(valueParts.join("="));
    } catch {
      continue;
    }
  }
  return cookies;
}

export function serializeCookie(
  name: string,
  value: string,
  {
    httpOnly = false,
    maxAge,
    secure = false
  }: CookieOptions = {}
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    maxAge === undefined ? "" : `Max-Age=${maxAge}`,
    "SameSite=Lax",
    secure ? "Secure" : "",
    httpOnly ? "HttpOnly" : ""
  ].filter(Boolean).join("; ");
}

export function clearCookie(name: string, options: Omit<CookieOptions, "maxAge"> = {}): string {
  return serializeCookie(name, "", {
    ...options,
    maxAge: 0
  });
}
