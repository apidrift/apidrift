#!/usr/bin/env node
/**
 * The `apidrift` binary — a shim, on purpose (US-14).
 *
 * Everything the CLI does lives in `./cli-run.ts` as a function that takes
 * `argv` and RETURNS an exit code, because the default path now reaches the
 * network and had to become reachable from a test with a fixture `Fetcher`
 * (AC11) and an observable numeric exit code (AC3bis). This file exists only
 * to bind that function to the process: the real fetcher, the real LLM
 * resolution, and `process.exitCode`.
 *
 * `process.exitCode` rather than `process.exit()`: the run's last words are
 * written to stdout, and `process.exit()` can truncate a pipe mid-write.
 *
 * The `catch` is the last line of defence, and it prints a MESSAGE, never the
 * error object: `console.error(err)` renders a stack trace containing absolute
 * paths from the user's machine — the US-11 leak. Every failure this tool
 * expects is already named upstream; anything reaching here is a bug in ours.
 */
import { runCli } from './cli-run.js';

runCli(process.argv)
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error(`\x1b[31merror:\x1b[0m apidrift failed unexpectedly: ${(err as Error).message}`);
    console.error('\x1b[2mthis is a bug in apidrift — please report it with the command you ran.\x1b[0m');
    process.exitCode = 1;
  });
