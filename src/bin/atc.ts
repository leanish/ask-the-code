#!/usr/bin/env node

import { main } from "../cli/main.js";
import { HelpError } from "../cli/parse-args.js";

main(process.argv.slice(2)).catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof HelpError) {
    console.log(message);
    return;
  }

  console.error(`atc: ${message}`);
  process.exitCode = 1;
});
