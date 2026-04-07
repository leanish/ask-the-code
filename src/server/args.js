export class HelpError extends Error {}

export function parseServerArgs(argv, env = process.env) {
  let host = env.ARCHA_SERVER_HOST || "127.0.0.1";
  let port = parsePort(env.ARCHA_SERVER_PORT || "8787", "ARCHA_SERVER_PORT");

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

function requireValue(flag, value) {
  if (!value || looksLikeFlag(value)) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function looksLikeFlag(value) {
  return value.startsWith("-");
}

function parsePort(value, label) {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`Invalid ${label}: ${value}. Use a positive integer TCP port.`);
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid ${label}: ${value}. Use a TCP port between 0 and 65535.`);
  }

  return port;
}

function helpText() {
  return [
    "Archa server exposes async HTTP question-answering jobs.",
    "",
    "Usage:",
    "  archa-server [--host <host>] [--port <port>]",
    "",
    "Options:",
    "  --host <host>                Host interface to bind",
    "  --port <port>                TCP port to bind",
    "",
    "Environment:",
    "  ARCHA_SERVER_HOST            Override default bind host",
    "  ARCHA_SERVER_PORT            Override default bind port",
    "  ARCHA_SERVER_BODY_LIMIT_BYTES",
    "  ARCHA_SERVER_MAX_CONCURRENT_JOBS",
    "  ARCHA_SERVER_JOB_RETENTION_MS",
    "",
    "  -h, --help                   Show help"
  ].join("\n");
}
