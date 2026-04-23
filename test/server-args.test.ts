import { describe, expect, it } from "vitest";

import { HelpError, parseServerArgs } from "../src/server/args.js";

describe("server-args", () => {
  it("parses explicit host and port overrides", () => {
    expect(parseServerArgs(["--host", "0.0.0.0", "--port", "9999"])).toEqual({
      host: "0.0.0.0",
      port: 9999
    });
  });

  it("accepts port zero for ephemeral binding", () => {
    expect(parseServerArgs(["--port", "0"])).toEqual({
      host: "127.0.0.1",
      port: 0
    });
  });

  it("uses environment defaults when flags are absent", () => {
    expect(parseServerArgs([], {
      ATC_SERVER_HOST: "localhost",
      ATC_SERVER_PORT: "8788"
    })).toEqual({
      host: "localhost",
      port: 8788
    });
  });

  it("rejects missing values when another flag appears in place of the value", () => {
    expect(() => parseServerArgs(["--host", "--port", "8787"])).toThrow("Missing value for --host");
    expect(() => parseServerArgs(["--port", "--host"])).toThrow("Missing value for --port");
  });

  it("rejects invalid ports", () => {
    expect(() => parseServerArgs(["--port", "wat"])).toThrow(
      "Invalid --port: wat. Use a TCP port between 0 and 65535."
    );
  });

  it("surfaces help output for explicit help flags", () => {
    expect(() => parseServerArgs(["--help"])).toThrow(HelpError);
  });
});
