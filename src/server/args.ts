import { HelpError } from "../core/cli/help-error.ts";
import { parseEnvPort } from "../core/env/parse-env.ts";
import type { Environment, ServerCommandOptions } from "../core/types.ts";

export { HelpError };

export function parseServerArgs(argv: string[], env: Environment = process.env): ServerCommandOptions {
  let host = env.ATC_SERVER_HOST || "127.0.0.1";
  let port = parsePort(env.ATC_SERVER_PORT || "8787", "ATC_SERVER_PORT");

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--host":
        host = requireValue(arg, argv[index + 1]);
        index += 1;
        break;
      case "--port":
        port = parsePort(requireValue(arg, argv[index + 1]), "--port");
        index += 1;
        break;
      case "-h":
      case "--help":
        throw new HelpError(helpText());
      default:
        throw new Error(`Unknown server option: ${arg}\n\n${helpText()}`);
    }
  }

  return {
    host,
    port
  };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || looksLikeFlag(value)) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function looksLikeFlag(value: string): boolean {
  return value.startsWith("-");
}

function parsePort(value: string, label: string): number {
  const port = parseEnvPort(value, label);
  if (port == null) {
    throw new Error(`Invalid ${label}: ${value}. Use a TCP port between 0 and 65535.`);
  }

  return port;
}

function helpText(): string {
  return [
    "ask-the-code server exposes async HTTP question-answering jobs.",
    "",
    "Usage:",
    "  atc-server [--host <host>] [--port <port>]",
    "",
    "Options:",
    "  --host <host>                Host interface to bind",
    "  --port <port>                TCP port to bind",
    "",
    "Environment:",
    "  ATC_SERVER_HOST              Override default bind host",
    "  ATC_SERVER_PORT              Override default bind port",
    "  ATC_SERVER_BODY_LIMIT_BYTES",
    "  ATC_SERVER_MAX_CONCURRENT_JOBS",
    "  ATC_SERVER_JOB_RETENTION_MS",
    "",
    "  -h, --help                   Show help"
  ].join("\n");
}
