import { describe, expect, it } from "vitest";

import { parseCookies } from "../src/server/http-cookies.ts";

describe("http cookies", () => {
  it("skips malformed cookie values instead of throwing", () => {
    expect(parseCookies("valid=ok; bad=%E0%A4%A; another=value")).toEqual({
      valid: "ok",
      another: "value"
    });
  });
});
