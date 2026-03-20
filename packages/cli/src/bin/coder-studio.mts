#!/usr/bin/env node
// @ts-nocheck
import { runCli } from '../lib/cli.mjs';

runCli().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`coder-studio error: ${message}`);
  process.exitCode = 1;
});
