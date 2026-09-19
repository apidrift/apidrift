/**
 * A SUBPROCESS entry point onto the real CLI, wired to committed fixture
 * markdown instead of the network (US-14, AC11 + AC3bis).
 *
 * AC3bis demands a subprocess test asserting the NUMERIC exit code (20), and
 * AC11 forbids a single real request. `src/cli.ts` itself can only give us one
 * of the two. So this file binds the very same `runCli` the binary binds, with
 * two things swapped: the `Fetcher` reads `fixtures/stripe-changelog/*.md`, and
 * the `Llm` — when asked for — is a stub that proposes no edit.
 *
 * Nothing here is part of the shipped tool: it is not under `src/`, it is not
 * matched by `tsx --test tests/*.test.ts`, and the seam it uses (`CliDeps`) is
 * the same injectable-`Fetcher` / injectable-`Llm` convention the rest of the
 * codebase already runs on.
 *
 * Protocol, all through the environment so argv stays the CLI's own:
 *   APIDRIFT_FIXTURE_MAP   JSON { url: <path to a fixture file> }. A URL that
 *                          is not in the map throws, exactly like an
 *                          unreachable page.
 *   APIDRIFT_FIXTURE_FAIL  when set, EVERY fetch throws with this message —
 *                          the "changelog unreachable" case.
 *   APIDRIFT_FETCH_LOG     file to write the fetched URLs to, one per line.
 *                          An EMPTY file is the proof of "zero fetcher call".
 *   APIDRIFT_STUB_LLM      when set, a model IS configured (a stub one).
 */
import fs from 'node:fs';
import { runCli } from '../src/cli-run.js';
import type { Fetcher } from '../src/detection/index.js';
import type { Llm } from '../src/fixer/llm.js';

const map: Record<string, string> = JSON.parse(process.env.APIDRIFT_FIXTURE_MAP ?? '{}');
const logPath = process.env.APIDRIFT_FETCH_LOG;
const fetched: string[] = [];

const flushLog = () => { if (logPath) fs.writeFileSync(logPath, fetched.map((u) => `${u}\n`).join('')); };
if (logPath) flushLog(); // the file exists from the start: absent != empty

const fetcher: Fetcher = async (url) => {
  fetched.push(url);
  flushLog();
  if (process.env.APIDRIFT_FIXTURE_FAIL) throw new Error(process.env.APIDRIFT_FIXTURE_FAIL);
  const file = map[url];
  if (!file) throw new Error(`fixture-cli: no fixture mapped for ${url}`);
  return fs.readFileSync(file, 'utf8');
};

/** Configured, and deliberately useless: it proposes nothing, so nothing is written. */
const stubLlm: Llm = {
  async createMessage() {
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'no edit proposed' }] };
  },
};

runCli(process.argv, {
  fetcher,
  // Same contract as the real `resolveLlm`: `deterministic-only` yields no
  // model whatever else is set, so the offline tests stay honest.
  resolveLlm: async (cfg) =>
    (process.env.APIDRIFT_STUB_LLM && cfg.policy !== 'deterministic-only' ? stubLlm : undefined),
})
  .then((code) => { flushLog(); process.exitCode = code; })
  .catch((err) => {
    flushLog();
    console.error(`fixture-cli: ${(err as Error).stack}`);
    process.exitCode = 1;
  });
