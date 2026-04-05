import process from "node:process";

import { startHttpServer } from "./http-server.js";
import { HelpError, parseServerArgs } from "./server-args.js";

export async function main(argv) {
  const options = parseServerArgs(argv, process.env);
  const serverHandle = await startHttpServer({
    env: process.env,
    host: options.host,
    port: options.port
  });

  process.stdout.write(`Archa server listening on ${serverHandle.url}\n`);

  setupShutdownHandlers(serverHandle);

  return serverHandle;
}

export function setupShutdownHandlers(serverHandle, { processRef = process } = {}) {
  let shuttingDown = false;

  function onSignal(signal) {
    if (shuttingDown) {
      processRef.stderr.write(`Forced shutdown (${signal})\n`);
      processRef.exit(1);
      return;
    }

    shuttingDown = true;
    processRef.stderr.write(`Shutting down (${signal})...\n`);
    serverHandle.close().then(
      () => processRef.exit(0),
      () => processRef.exit(1)
    );
  }

  processRef.on("SIGTERM", () => onSignal("SIGTERM"));
  processRef.on("SIGINT", () => onSignal("SIGINT"));
}

export { HelpError };
