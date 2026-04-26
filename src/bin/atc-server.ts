#!/usr/bin/env node

import { HelpError, main } from "../server/main.ts";

main(process.argv.slice(2)).catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof HelpError) {
    console.log(message);
    return;
  }

  console.error(`atc-server: ${message}`);
  process.exitCode = 1;
});
