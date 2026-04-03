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
  return serverHandle;
}

export { HelpError };
