#!/usr/bin/env node

import { main } from "../src/cli/main.js";
import { HelpError } from "../src/cli/parse-args.js";

main(process.argv.slice(2)).catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof HelpError) {
    console.log(message);
    return;
  }
  console.error(`archa: ${message}`);
  process.exitCode = 1;
});
