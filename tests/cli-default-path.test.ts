/**
 * US-14 — the Free CLI's default path becomes the dynamic changelog diff.
 *
 * Everything here runs the REAL CLI code (`runCli`) in a real subprocess, with
 * exactly two things swapped for fixtures: the `Fetcher` (committed markdown
 * under `fixtures/stripe-changelog/`) and the `Llm` (a stub that proposes
 * nothing). See `tests/fixture-cli.ts`. Not one request leaves this suite
 * (AC11) — and `fetched()` below is the proof, per run, not a claim.
 *
 * The four pre-existing subprocess tests that pass `--deterministic-only` and
 * expect 0 (tests/api-version.test.ts, tests/installed-sdk.test.ts,
 * tests/plan-cap.test.ts, tests/cli-clean-run.test.ts) are the other half of
 * this suite: they are the ones that would go red — or silently reach the
 * network — if the offline contract below ever slipped. None of them was
 * modified.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectReleases } from '../src/detection/walk.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const fixturesDir = path.join(repoRoot, 'fixtures', 'stripe-changelog');
const fx = (name: string) => path.join(fixturesDir, name);

const INDEX_URL = 'https://docs.stripe.com/changelog.md';
const FORM1_URL =
  'https://docs.stripe.com/changelog/dahlia/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-intents.md';
const FORM2_URL =
  'https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md';

/**
 * The walk fixture: an index publishing four `.acacia` releases and one
 * `.preview`. From the bound `2023-08-16` it yields five auto-executable
 * changes (`stripe.paymentIntents.{create,update,confirm}`,
 * `stripe.setupIntents.{create,update}`, all stamped `2025-02-01.acacia`), one
 * report-only change, and two unreadable pages.
 */
const WALK_FIXTURES: Record<string, string> = {
  [INDEX_URL]: fx('index-walk-excerpt.md'),
  [FORM1_URL]: fx('removes-payment-method-types-parameter-from-payment-intents-setup-intents.md'),
  [FORM2_URL]: fx('deprecate-subscription-current-period-start-and-end.md'),
};

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Every URL the CLI actually asked the fetcher for. `[]` is the zero-network proof. */
  fetched: string[];
}

function runCli(
  args: string[],
  opts: {
    fixtures?: Record<string, string>;
    env?: Record<string, string>;
    fetchFails?: string;
    /** US-16, AC1: attaches `{ cause: { code } }` to the thrown fetch error. */
    fetchFailsCauseCode?: string;
    /** US-16, AC1: names the thrown fetch error `TimeoutError`. */
    fetchFailsTimeout?: boolean;
  } = {},
): CliRun {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-fetchlog-')), 'urls.txt');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_TEST_CONTEXT: undefined,
    APIDRIFT_FIXTURE_MAP: JSON.stringify(opts.fixtures ?? WALK_FIXTURES),
    APIDRIFT_FETCH_LOG: log,
    ...opts.env,
  } as NodeJS.ProcessEnv;
  // A developer's own key or config must never decide what this suite tests.
  delete env.ANTHROPIC_API_KEY;
  delete env.APIDRIFT_MODEL;
  if (!opts.env?.APIDRIFT_INFERENCE) delete env.APIDRIFT_INFERENCE;
  if (opts.fetchFails) env.APIDRIFT_FIXTURE_FAIL = opts.fetchFails;
  if (opts.fetchFailsCauseCode) env.APIDRIFT_FIXTURE_FAIL_CAUSE_CODE = opts.fetchFailsCauseCode;
  if (opts.fetchFailsTimeout) env.APIDRIFT_FIXTURE_FAIL_TIMEOUT = '1';

  const r = spawnSync('npx', ['tsx', 'tests/fixture-cli.ts', ...args], { cwd: repoRoot, encoding: 'utf8', env });
  const fetched = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  fs.rmSync(path.dirname(log), { recursive: true, force: true });
  return { status: r.status, stdout: strip(r.stdout ?? ''), stderr: strip(r.stderr ?? ''), fetched };
}

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `apidrift-${prefix}-`));
  tmpDirs.push(d);
  return d;
}
process.on('exit', () => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

/**
 * A repo that (a) constructs a Stripe client, (b) pins an API version the
 * resolver can read, and (c) optionally calls one of the symbols the fixture
 * walk detects. `2023-08-16` is the bound the whole fixture walk is built on.
 */
function makeRepo(body: string, extra: Record<string, string> = {}): string {
  const repo = tmp('repo');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.mkdirSync(path.join(repo, 'node_modules', 'stripe'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'target', version: '1.0.0', type: 'commonjs', scripts: { test: 'node -e ""' } }),
  );
  fs.writeFileSync(
    path.join(repo, 'node_modules', 'stripe', 'package.json'),
    JSON.stringify({ name: 'stripe', version: '13.0.0', main: 'index.js' }),
  );
  fs.writeFileSync(path.join(repo, 'node_modules', 'stripe', 'index.js'), 'module.exports = function Stripe() { return {}; };\n');
  fs.writeFileSync(path.join(repo, 'src', 'pay.js'), body);
  for (const [rel, content] of Object.entries(extra)) fs.writeFileSync(path.join(repo, rel), content);
  return repo;
}

const PINNED_CLIENT = `'use strict';
const stripe = require('stripe')(process.env.STRIPE_KEY, { apiVersion: '2023-08-16' });
`;

/** Calls `stripe.paymentIntents.confirm` — one of the five the fixture walk detects. */
const AFFECTED = `${PINNED_CLIENT}
async function pay(id) {
  return stripe.paymentIntents.confirm(id, { payment_method_types: ['card'] });
}
module.exports = { pay };
`;

/** A Stripe client, and not one of the detected symbols anywhere — the AC8 shape. */
const UNAFFECTED = `${PINNED_CLIENT}
async function listCustomers() {
  return stripe.customers.list({ limit: 3 });
}
module.exports = { listCustomers };
`;

// ══════════════════════════════════════════════════════════════════════════
// AC2bis — THE OFFLINE MODE IS AN EXPLICIT CHOICE, ON THREE CHANNELS
//
// One test per channel, and each asserts the same three things: ZERO fetcher
// calls, the sentence that says the walk did not run, and exit 0. This is the
// parade to the principal risk of the whole US — the suite quietly starting to
// make real requests — so it is asserted on the fetcher itself, never inferred
// from the absence of a symptom.
// ══════════════════════════════════════════════════════════════════════════

test('AC2bis (i) — the --deterministic-only FLAG: zero fetch, the walk announces it did not run, exit 0', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--deterministic-only', '--out', tmp('out')]);

  assert.deepStrictEqual(r.fetched, [], 'not one fetcher call may happen under an explicit offline choice');
  assert.strictEqual(r.status, 0, `CLI failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /offline mode/i);
  assert.match(r.stdout, /did NOT run/, 'the fallback is ANNOUNCED — US-16 AC5 forbids the SILENT one, not the fallback');
  assert.ok(r.stdout.includes('--deterministic-only'), 'name the channel that asked for it');
});

test('AC2bis (ii) — APIDRIFT_INFERENCE=deterministic-only: zero fetch, announced, exit 0', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--out', tmp('out')], {
    env: { APIDRIFT_INFERENCE: 'deterministic-only' },
  });

  assert.deepStrictEqual(r.fetched, [], 'the env channel is an offline CONTRACT, not merely "no model"');
  assert.strictEqual(r.status, 0, `CLI failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /offline mode/i);
  assert.ok(r.stdout.includes('APIDRIFT_INFERENCE=deterministic-only'), 'name the channel that asked for it');
});

test('AC2bis (iii) — apidrift.json {"inference":"deterministic-only"}: zero fetch, announced, exit 0', () => {
  // The motive for OPTION B, in one sentence: a CI that already wrote this
  // file must not start reaching the network, nor go red, because APIdrift
  // changed its default underneath it.
  const repo = makeRepo(AFFECTED, { 'apidrift.json': JSON.stringify({ inference: 'deterministic-only' }) });
  const r = runCli(['run', repo, '--out', tmp('out')]);

  assert.deepStrictEqual(r.fetched, [], 'a config file that says deterministic-only means NO network');
  assert.strictEqual(r.status, 0, `CLI failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /offline mode/i);
  assert.ok(r.stdout.includes('apidrift.json'), 'name the channel that asked for it');
});

test('AC2bis/AC2ter — PROVENANCE, not value: the same resolved policy, two behaviours', () => {
  // The bug this US is built to avoid, in one assertion pair. Both runs resolve
  // `deterministic-only`; branching on that value alone would make them
  // identical. One CHOSE it (offline, exit 0), the other merely lacks a key
  // (Vision B: fetch, list, exit 20).
  const body = AFFECTED;
  const chosen = runCli(['run', makeRepo(body), '--deterministic-only', '--out', tmp('out')]);
  const byDefault = runCli(['run', makeRepo(body), '--out', tmp('out')]);

  assert.strictEqual(chosen.status, 0);
  assert.deepStrictEqual(chosen.fetched, []);
  assert.strictEqual(byDefault.status, 20);
  assert.ok(byDefault.fetched.includes(INDEX_URL), 'the default path fetches even with no model configured');
});

// ══════════════════════════════════════════════════════════════════════════
// AC1 / AC2ter / AC3bis — VISION B: detect, list, do not fix, exit 20
// ══════════════════════════════════════════════════════════════════════════

test('AC1 — no flag at all: the pin drives the walk, no release number is ever typed', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--out', tmp('out')]);

  assert.ok(r.fetched.includes(INDEX_URL), 'the changelog index is read by default, with no --detect');
  assert.ok(r.fetched.includes(FORM1_URL), 'and so are the detail pages of the walked releases');
  assert.match(r.stdout, /after 2023-08-16/, 'the lower bound is the version the REPO pins — nobody typed it');
  assert.match(r.stdout, /up to 2025-04-01\.acacia/, 'up to the latest release on that line');
});

test('AC3bis — the NUMERIC exit code is 20 when drift is detected and no model can fix it', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--out', tmp('out')]);

  // The value, not "non-zero": 20..29 is reserved for APIdrift verdicts, and a
  // caller that greps for it needs it stable.
  assert.strictEqual(r.status, 20, `expected the drift verdict:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /NOT fixed/);
  assert.match(r.stdout, /stripe\.paymentIntents\.confirm/, 'name the symbol');
  assert.match(r.stdout, /2025-02-01\.acacia/, 'name the release it comes from');
  assert.match(r.stdout, /an API key is required to generate the fix/i);
  assert.match(r.stdout, /ANTHROPIC_API_KEY/);
  assert.match(r.stdout, /--ai/);
});

test('AC3bis — the SAME repo with a model configured does NOT exit 20', () => {
  const repo = makeRepo(AFFECTED);
  const withModel = runCli(['run', repo, '--ai', '--out', tmp('out')], { env: { APIDRIFT_STUB_LLM: '1' } });

  assert.notStrictEqual(withModel.status, 20, `20 is the "no model" verdict, never a run that had one:\n${withModel.stdout}`);
  assert.strictEqual(withModel.status, 0, `CLI failed:\n${withModel.stdout}\n${withModel.stderr}`);
  assert.ok(!/an API key is required/i.test(withModel.stdout), 'do not ask for what is already there');
});

test('AC2ter (d) — every listed call site is a path RELATIVE to the target repo (the US-11 leak)', () => {
  const repo = makeRepo(AFFECTED);
  const r = runCli(['run', repo, '--out', tmp('out')]);

  assert.strictEqual(r.status, 20);
  assert.match(r.stdout, /src[/\\]pay\.js:\d+/, 'the site is named, relatively');
  assert.ok(!r.stdout.includes(repo), 'a path off the user\'s machine must never reach the terminal');
  assert.ok(!r.stderr.includes(repo));
});

test('AC2ter (f) — the forbidden pair: "no known API change affects this repo" and exit 20 never coexist', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--out', tmp('out')]);

  assert.strictEqual(r.status, 20);
  assert.ok(
    !/no known API change affects this repo/.test(r.stdout),
    'the clean-run note certifies a clean repo; printing it next to a list of changes that affect it is the exact false bill of health this US forbids',
  );
  assert.ok(!/^tip: set ANTHROPIC_API_KEY/m.test(r.stdout), 'the listing already says it, and louder');
});

test('AC2 — the built-in registry still runs on a run with no model (Deterministic-first)', () => {
  // A repo that the REGISTRY can fix (charges.create -> paymentIntents) and
  // that the walk also finds drift in. Both happen, in the same run: a
  // deterministic PR is opened AND the undetectable-by-codemod changes are
  // listed. The exit code reports what is LEFT TO DO, so it is still 20.
  const repo = makeRepo(`${PINNED_CLIENT}
async function charge(amount) {
  return stripe.charges.create({ amount, currency: 'usd', source: 'tok_visa' });
}
async function pay(id) {
  return stripe.paymentIntents.confirm(id, { payment_method_types: ['card'] });
}
module.exports = { charge, pay };
`);
  const out = tmp('out');
  const r = runCli(['run', repo, '--out', out]);

  assert.strictEqual(r.status, 20, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /stripe\.charges\.create|charges/i, 'the registry was evaluated, not shelved');
  assert.ok(fs.readdirSync(out).length > 0, 'the deterministic tier still produces its artifact with no key at all');
});

// ══════════════════════════════════════════════════════════════════════════
// AC3 — the frozen flag contract
// ══════════════════════════════════════════════════════════════════════════

test('AC3 — the help no longer presents detection as opt-in, and names no retired flag', () => {
  const help = runCli(['--help']);

  assert.strictEqual(help.status, 0);
  assert.ok(!/opt-in/i.test(help.stdout), 'detection is the DEFAULT now — no text may still call it optional');
  assert.ok(!/--detect\b/.test(help.stdout), 'the flag is gone; documenting it would resurrect it');
  assert.ok(!/--release\b/.test(help.stdout));
  assert.match(help.stdout, /no flag required/i, 'and it says so positively, not only by omission');

  // Preserved WORD FOR WORD: tests/plan-cap.test.ts asserts these three.
  assert.match(help.stdout, /--max-changes <n>/);
  assert.match(help.stdout, /-y, --yes/);
  assert.match(help.stdout, /There is no prompt/i);

  // AC3 + AC3bis: the exit-code contract is documented, not folklore.
  assert.match(help.stdout, /EXIT CODES/);
  assert.match(help.stdout, /^\s*20\s+drift detected/m);
  // AC3 + the human arbitration: the two "no network" flags are neighbours in
  // the help and must not read as synonyms.
  assert.match(help.stdout, /--offline IS NOT --deterministic-only/);
  assert.match(help.stdout, /--since <api-version>/);
});

test('US-16, AC6 — the help distinguishes the changelog walk from the AI fixer by name, and drops the false blanket claim', () => {
  const help = runCli(['--help']);

  assert.strictEqual(help.status, 0);
  assert.ok(
    !help.stdout.includes('never leaves your machine in either mode'),
    'the two inference MODES (deterministic-only/BYOT) are not the two network PATHS (changelog walk/AI fixer) — the old sentence conflated them',
  );
  assert.match(help.stdout, /changelog walk/i);
  assert.match(help.stdout, /AI fixer/i);
  assert.match(help.stdout, /sends? NOTHING of your code/i, 'what IS true of the changelog walk must still be said');
  assert.match(help.stdout, /DOES send the affected\s+source/i, 'what is true of the AI fixer must not be hidden either');

  // AC6(b): the --offline refusal states the SAME distinction in one line.
  const offline = runCli(['run', makeRepo(AFFECTED), '--offline', '--out', tmp('out')]);
  assert.match(offline.stderr, /docs\.stripe\.com/);
  assert.match(offline.stderr, /not a code upload/i);
});

test('AC3 — --detect is refused by name, and the error says what replaced it', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--detect']);

  assert.strictEqual(r.status, 1);
  assert.deepStrictEqual(r.fetched, [], 'a refused command line runs nothing');
  assert.match(r.stderr, /--detect/);
  assert.match(r.stderr, /default/i, 'name the replacement: detection is now what a bare run does');
});

test('AC3 — --release is refused by name, and the error names --since', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--release', '2026-08-26.preview']);

  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /--release/);
  assert.match(r.stderr, /--since <api-version>/, 'the replacement, by name — never a silent ignore');
});

test('AC3 — an unknown flag is an error, not something to ignore', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--detetc-changes']);

  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /unknown option/i);
  assert.match(r.stderr, /--detetc-changes/);
});

test('AC3 — --since overrides the LOWER BOUND, which is what makes bound.ts\'s six messages true', () => {
  // The repo pins 2023-08-16; --since moves the bound past the release that
  // carries the five detectable changes, so the walk comes back empty and the
  // verdict changes from 20 to 0 — proof the flag moved the bound and not
  // something else.
  const repo = makeRepo(AFFECTED);
  const r = runCli(['run', repo, '--since', '2025-04-01.acacia', '--out', tmp('out')]);

  assert.match(r.stdout, /walking from 2025-04-01\.acacia/);
  assert.match(r.stdout, /--since overrides/);
  assert.strictEqual(r.status, 0, 'nothing left to fix past that bound');
});

test('AC3/AC14 — --yes is accepted and INERT without a model; --max-changes is still validated before any I/O', () => {
  const repo = makeRepo(AFFECTED);

  const yes = runCli(['run', repo, '--yes', '--max-changes', '10', '--out', tmp('out')]);
  assert.strictEqual(yes.status, 20, '--yes must not turn the drift verdict into a success');

  const bad = runCli(['run', repo, '--max-changes', '0', '--out', tmp('out')]);
  assert.strictEqual(bad.status, 1);
  assert.deepStrictEqual(bad.fetched, [], 'a malformed cap is refused before the network, with or without a model');
  assert.strictEqual(bad.stdout, '', 'it fails before the run even starts');
});

test('AC14 — the cap does not bite on the listing: it protects tokens, and there are none to protect', () => {
  // Five detected changes, all matched, against a cap of 1. With a model this
  // would refuse and exit 1. Without one, nothing is spendable — the listing IS
  // the deliverable of this mode, and replacing it with a refusal would train
  // the reader to type --yes by reflex.
  const repo = makeRepo(`${PINNED_CLIENT}
async function all(id) {
  await stripe.paymentIntents.create({ payment_method_types: ['card'] });
  await stripe.paymentIntents.update(id, { payment_method_types: ['card'] });
  await stripe.paymentIntents.confirm(id, { payment_method_types: ['card'] });
  await stripe.setupIntents.create({ payment_method_types: ['card'] });
  await stripe.setupIntents.update(id, { payment_method_types: ['card'] });
}
module.exports = { all };
`);
  const r = runCli(['run', repo, '--max-changes', '1', '--out', tmp('out')]);

  assert.strictEqual(r.status, 20, 'the verdict, not a cap refusal');
  assert.ok(!/above the cap/i.test(r.stderr), 'the cap must not fire where no token can be spent');
  assert.match(r.stdout, /5 detected change\(s\) affect this repo/);
});

// ══════════════════════════════════════════════════════════════════════════
// AC7 — the portion of US-16 absorbed here: nothing fails quietly
// ══════════════════════════════════════════════════════════════════════════

test('AC7(a) — an unreachable changelog names the URL, exits 1, and prints NO stack and NO absolute path', () => {
  // Offline, `fetch` throws `TypeError: fetch failed`, which names no URL at
  // all. Naming it is the CLI's job. And the old `console.error(err)` printed a
  // stack full of paths off the user's machine — the US-11 leak, again.
  const repo = makeRepo(AFFECTED);
  const r = runCli(['run', repo, '--out', tmp('out')], { fetchFails: 'fetch failed' });

  assert.strictEqual(r.status, 1, 'a run that could not look never reports a verdict');
  assert.match(r.stderr, /https:\/\/docs\.stripe\.com\/changelog\.md/, 'name the URL the user could try by hand');
  assert.match(r.stderr, /fetch failed/, 'and keep the underlying cause');
  assert.match(r.stderr, /--deterministic-only/, 'and say what still works');
  assert.ok(!/\n\s+at\s+\S+/.test(r.stderr), 'no stack frames');
  assert.ok(!r.stderr.includes(repoRoot), 'no absolute path off this machine');
  assert.ok(!r.stderr.includes(repo));
});

test('US-16, AC1 — a DNS/refused/reset failure names the root CAUSE (err.cause.code), not the uninformative "fetch failed" wrapper', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--out', tmp('out')], {
    fetchFails: 'fetch failed', fetchFailsCauseCode: 'ENOTFOUND',
  });

  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /ENOTFOUND/, 'the root cause, not the generic wrapper message');
  assert.match(r.stderr, /https:\/\/docs\.stripe\.com\/changelog\.md/, 'the URL is still named');
});

test('US-16, AC1 — a timeout is named as a timeout, distinctly from a DNS/refused failure', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--out', tmp('out')], {
    fetchFails: 'fetch failed', fetchFailsTimeout: true,
  });

  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /timeout after 30s/i);
  assert.ok(!/ENOTFOUND/.test(r.stderr));

  const dns = runCli(['run', makeRepo(AFFECTED), '--out', tmp('out')], {
    fetchFails: 'fetch failed', fetchFailsCauseCode: 'ENOTFOUND',
  });
  assert.notStrictEqual(r.stderr, dns.stderr, 'a timeout and a DNS failure must never read as the same cause');
});

test('AC7(b) — THE INDEX SENTINEL: an index parsed to zero headings is FATAL, and says so differently from a network failure', () => {
  // The hole that made this whole switch dangerous: `parseReleaseHeadings`
  // returns [] without raising, `selectReleases` used to answer
  // `line-not-published`, and the run read as "the vendor changed nothing".
  const repo = makeRepo(AFFECTED);
  const r = runCli(['run', repo, '--out', tmp('out')], {
    fixtures: { ...WALK_FIXTURES, [INDEX_URL]: fx('index-no-release-headings.md') },
  });

  assert.strictEqual(r.status, 1, 'vendor format drift is fatal, never a green run');
  assert.match(r.stderr, /ZERO release headings/);
  assert.match(r.stderr, /NOT a network failure/i, 'the two causes have two remedies — never one message');
  assert.ok(!/no known API change affects this repo/.test(r.stdout), 'and above all, never "nothing to do"');

  // Distinct, two by two, from the network failure of AC7(a).
  const network = runCli(['run', repo, '--out', tmp('out')], { fetchFails: 'fetch failed' });
  assert.notStrictEqual(r.stderr, network.stderr);
});

test('AC7(b) unit — selectReleases tells "the index published nothing" apart from "this line is not published"', () => {
  assert.strictEqual(selectReleases([], '2023-08-16').status, 'index-empty');
  assert.strictEqual(selectReleases(['2026-04-22.preview'], '2023-08-16').status, 'line-not-published');
});

test('US-16, AC2b — an index with >= 1 heading but ZERO classable row anywhere is FATAL, and reads differently from index-empty and from a network failure', () => {
  const repo = makeRepo(AFFECTED);
  const r = runCli(['run', repo, '--out', tmp('out')], {
    fixtures: { ...WALK_FIXTURES, [INDEX_URL]: fx('index-headings-no-classable-rows.md') },
  });

  assert.strictEqual(r.status, 1, 'same class of failure as index-empty — we looked and could not read it');
  assert.match(r.stderr, /ZERO classable row/);
  assert.match(r.stderr, /2 release heading\(s\)/, 'the heading COUNT is named — this fixture carries two');
  assert.match(r.stderr, /NOT a network failure/i);
  assert.match(r.stderr, /NOT the zero-heading case either/i, 'distinct from index-empty, not merely "also fatal"');
  assert.ok(!/no known API change affects this repo/.test(r.stdout));

  const zeroHeadings = runCli(['run', repo, '--out', tmp('out')], {
    fixtures: { ...WALK_FIXTURES, [INDEX_URL]: fx('index-no-release-headings.md') },
  });
  const network = runCli(['run', repo, '--out', tmp('out')], { fetchFails: 'fetch failed' });
  const sentences = [r.stderr, zeroHeadings.stderr, network.stderr];
  assert.strictEqual(new Set(sentences).size, 3, 'three distinct causes, three distinct messages');
});

test('US-16, AC2c — an index row with a link and an unrecognized Breaking value is a named gap in the CLI output, not a silent drop', () => {
  const repo = makeRepo(AFFECTED);
  const r = runCli(['run', repo, '--out', tmp('out')], {
    fixtures: { [INDEX_URL]: fx('index-unknown-breaking-column.md'), [FORM1_URL]: fx('removes-payment-method-types-parameter-from-payment-intents-setup-intents.md') },
  });

  assert.match(r.stdout, /ambiguous-breaking-value\.md/, 'the unrecognized row is listed among the unreadable pages');
  assert.match(r.stdout, /"Maybe"/, 'the raw value read is quoted, not paraphrased');
});

test('AC7(c) — --offline fails CLOSED before any fetch, and names --deterministic-only as what still works', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--offline', '--out', tmp('out')]);

  assert.strictEqual(r.status, 1);
  assert.deepStrictEqual(r.fetched, [], 'the refusal happens before the network, not after a failed attempt');
  assert.match(r.stderr, /--offline/);
  assert.match(r.stderr, /--deterministic-only/, 'a fail-close that names no way forward is a dead end');
});

test('AC7(d) — no WalkStatus renders as a silent green run, and the sentences are distinct two by two', () => {
  const repo = makeRepo(UNAFFECTED);
  const out = () => tmp('out');

  // up-to-date: the bound IS the last release on its line.
  const upToDate = runCli(['run', repo, '--since', '2025-04-01.acacia', '--out', out()]);
  assert.strictEqual(upToDate.status, 0);
  assert.match(upToDate.stdout, /IS the latest release published on its line/);

  // ahead-of-index: newer than anything published on that line. Same empty
  // walk, a completely different thing to say.
  const ahead = runCli(['run', repo, '--since', '2030-01-01.acacia', '--out', out()]);
  assert.strictEqual(ahead.status, 0);
  assert.match(ahead.stdout, /is NEWER than anything this changelog publishes/);

  // unreadable-bound: we cannot order it, so we do not walk — and we fetch nothing.
  const unreadable = runCli(['run', repo, '--since', 'latest', '--out', out()]);
  assert.strictEqual(unreadable.status, 1);
  assert.deepStrictEqual(unreadable.fetched, [], 'a bound we cannot order buys us nothing from 200 KB of changelog');
  assert.match(unreadable.stderr, /cannot be ordered against the changelog/);

  // line-not-published: the index is fine, it just publishes nothing on this line.
  const noLine = runCli(['run', repo, '--out', out()], {
    fixtures: { ...WALK_FIXTURES, [INDEX_URL]: fx('index-preview-only.md') },
  });
  assert.strictEqual(noLine.status, 1);
  assert.match(noLine.stderr, /publishes no release at all on/);

  const sentences = [upToDate.stdout, ahead.stdout, unreadable.stderr, noLine.stderr];
  assert.strictEqual(new Set(sentences).size, 4, 'four statuses, four things to say');
});

test('AC7 — a pin we cannot resolve stops the run, fetches NOTHING, and names --since', () => {
  // `changesSinceBound` makes this structural: `source.changesSince` is never
  // reached. An explicit error, never 0 and never 20 — the run did not happen.
  const repo = makeRepo(`'use strict';
const stripe = require('stripe')(process.env.STRIPE_KEY, { apiVersion: process.env.STRIPE_API_VERSION });
module.exports = { stripe };
`);
  const r = runCli(['run', repo, '--out', tmp('out')]);

  assert.strictEqual(r.status, 1);
  assert.deepStrictEqual(r.fetched, [], 'no blind walk, and no 200 KB spent discovering we cannot walk');
  assert.match(r.stderr, /could not establish the Stripe API version/i);
  assert.match(r.stderr, /--since <api-version>/, 'the escape hatch US-13 promised, now real');
});

test('AC7 — an unreadable detail PAGE is a named hole, not a missing release (and never fatal)', () => {
  // Two of the four walked releases have no fixture page. Page-level isolation
  // (US-13 AC4) keeps them from costing their siblings anything.
  const r = runCli(['run', makeRepo(AFFECTED), '--out', tmp('out')]);

  assert.strictEqual(r.status, 20, 'the walk went on');
  assert.match(r.stdout, /2 page\(s\) could not be read/);
  assert.match(r.stdout, /unreachable-detail-page\.md/, 'the URL is what makes a hole actionable');
});

// ══════════════════════════════════════════════════════════════════════════
// AC8 — the anti-silence guard survives the switch
// ══════════════════════════════════════════════════════════════════════════

test('AC8 — a detected change with 0 matches on a repo that DOES build a Stripe client still WARNS, in the listing mode', () => {
  // The most likely regression of the whole batch: the warning is emitted only
  // from `noMatchWarning`, and the plan pass drops zero-match candidates before
  // `run()` can ever see them. In the listing mode `run()` is not even entered
  // for detected changes, so `plan.warnings` is the ONLY surviving path.
  const r = runCli(['run', makeRepo(UNAFFECTED), '--out', tmp('out')]);

  assert.match(r.stdout, /WARNING: change detected but no matching call site found/);
  assert.match(r.stdout, /stripe\.paymentIntents\./, 'name the symbol we looked for and did not find');
  assert.match(r.stdout, /NOT a confirmed "not applicable"/);
  assert.ok(
    !/no known API change affects this repo/.test(r.stdout),
    'a warning and the clean-run note may never coexist (78dbfe2 / US-17 AC4)',
  );
  assert.strictEqual(r.status, 0, 'a warning is not a verdict: nothing matched, so nothing is left unfixed');
});

test('AC8 — the same warning survives WITH a model, where it comes from the plan pass too', () => {
  const r = runCli(['run', makeRepo(UNAFFECTED), '--ai', '--out', tmp('out')], { env: { APIDRIFT_STUB_LLM: '1' } });

  assert.match(r.stdout, /WARNING: change detected but no matching call site found/);
  assert.match(r.stdout, /detected but unmatched/, 'and it is counted in the done line');
});

// ══════════════════════════════════════════════════════════════════════════
// AC12 — what the switch does NOT change
// ══════════════════════════════════════════════════════════════════════════

test('AC12/AC8 — the pinned-version guard still blocks, identically, on the default path', () => {
  // `fixtures/implicit-pinned-stripe` pins 2023-08-16 through the stripe v13 it
  // has installed — nothing in its own source says so. The registry change it
  // matches takes effect from 2025-03-31.basil, so it must still be refused,
  // and still explain that the SDK is the source of the pin (US-9).
  const r = runCli(['run', path.join(repoRoot, 'fixtures', 'implicit-pinned-stripe'), '--out', tmp('out')]);

  assert.match(r.stdout, /not applied/i);
  assert.match(r.stdout, /IMPLICITLY/, 'nothing in that repo mentions 2023-08-16');
  assert.match(r.stdout, /UNCHANGED/);
  assert.ok(
    !/no known API change affects this repo/.test(r.stdout),
    'sites were found and left alone: that is not a clean repo',
  );
});

test('AC2ter (d) — no path of the machine reaches the terminal, ANY line: header, error, out dir', () => {
  // The listing was relative from the start; the leak the first version of this
  // US had was in the lines AROUND it — the `scanning <dir>` header and the
  // `done ... in <out dir>` footer printed `path.resolve` output. A relative
  // `../../..` chain would not have fixed it either: it CONTAINS the absolute
  // path as a substring. Outside the cwd, only the last segment is shown.
  const repo = makeRepo(AFFECTED);
  const out = tmp('out');
  const r = runCli(['run', repo, '--out', out]);

  for (const [name, text] of [['stdout', r.stdout], ['stderr', r.stderr]] as const) {
    assert.ok(!text.includes(repo), `${name} must not contain the target repo path`);
    assert.ok(!text.includes(out), `${name} must not contain the output dir path`);
    assert.ok(!text.includes(os.tmpdir()), `${name} must not contain the machine's temp root`);
  }
  assert.match(r.stdout, new RegExp(`scanning …[/\\\\]${path.basename(repo)}\\b`), 'the repo is still NAMED, by its own directory');

  const missing = runCli(['run', path.join(repo, 'does-not-exist')]);
  assert.strictEqual(missing.status, 1);
  assert.ok(!missing.stderr.includes(os.tmpdir()), 'the "no such directory" error is not a leak either');
  assert.match(missing.stderr, /no such directory/);
});

// ══════════════════════════════════════════════════════════════════════════
// ROUND 2 (QA reserves R1, R2, R3) — added beside the tests above, none of
// which was edited.
// ══════════════════════════════════════════════════════════════════════════

const CLEAN_NOTE = /no known API change affects this repo/;

/** The index is readable and lists releases, but EVERY detail page fails. */
const INDEX_ONLY: Record<string, string> = { [INDEX_URL]: fx('index-walk-excerpt.md') };

test('R1 (a) — unreadable detail pages: the walk found NOTHING because it could read nothing, and no clean-run note says otherwise', () => {
  // QA repro. The repo calls `stripe.paymentIntents.confirm`, one of the five
  // changes the fixture walk detects — but with every page unreadable the walk
  // detects 0. Before the fix this printed "4 page(s) could not be read" and,
  // two lines later, "✓ no known API change affects this repo… (checked 2)":
  // a false "nothing to do" whose `checked` counted the registry, not the walk.
  //
  // US-16 ECART (decision humaine A3, 2026-09-26, DECISION_HUMAINE_2026_09_26):
  // this fixture's every attempted Breaking page is unreadable (N == M == 4,
  // "unreachable-detail-page.md"-shaped for all four walked releases) — the
  // exact case A3 arbitrates to exit 1 ("the run established nothing"), not 0.
  // This assertion predates that decision (2026-09-19 QA repro) and the
  // literal exit-code contradiction was not visible until A3 was tranché;
  // updated here rather than left silently red — see the dev report's
  // `ecarts`.
  const r = runCli(['run', makeRepo(AFFECTED), '--out', tmp('out')], { fixtures: INDEX_ONLY });

  assert.match(r.stdout, /\d+ page\(s\) could not be read/, 'the hole is named');
  assert.match(r.stdout, /detected: 0 auto-executable change\(s\)/, 'and it really did detect nothing');
  assert.ok(!CLEAN_NOTE.test(r.stdout), 'a cleanliness claim over a walk whose coverage has a hole is a false bill of health');
  assert.strictEqual(r.status, 1, 'US-16 AC3/A3: N == M > 0 (every attempted page unreadable) established nothing — exit 1, not the prior 0');
});

test('R1 (a\') — the same hole under --since: the override does not make the coverage complete', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--since', '2023-08-16', '--out', tmp('out')], { fixtures: INDEX_ONLY });

  assert.match(r.stdout, /walking from 2023-08-16/);
  assert.match(r.stdout, /\d+ page\(s\) could not be read/);
  assert.ok(!CLEAN_NOTE.test(r.stdout), '--since with unreadable pages must not certify a clean repo either');
});

test('R1 (b) — ahead-of-index: "verify it before reading this run as up to date" is not followed by a green checkmark', () => {
  // Nothing was walked at all here, so `checked` is only the registry. The
  // status sentence itself says to verify; the note must not contradict it.
  const r = runCli(['run', makeRepo(UNAFFECTED), '--since', '2030-01-01.acacia', '--out', tmp('out')]);

  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /is NEWER than anything this changelog publishes/);
  assert.match(r.stdout, /verify it before reading this run as "up to date"/);
  assert.ok(!CLEAN_NOTE.test(r.stdout), 'the run that says "verify me" cannot also say "nothing to fix"');
});

test('R1 (control) — a COMPLETE walk on a repo the changes do not touch still earns the clean-run note', () => {
  // Guards the fix from over-inhibiting: no gap, status `up-to-date`, so the
  // note is emitted exactly as before.
  const r = runCli(['run', makeRepo(UNAFFECTED), '--since', '2025-04-01.acacia', '--out', tmp('out')]);

  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /IS the latest release published on its line/);
  assert.match(r.stdout, CLEAN_NOTE);
});

/** Five detected changes, all five MATCH: no unmatched candidate, hence no warning. */
const FIVE_MATCHES = `${PINNED_CLIENT}
async function all(id) {
  await stripe.paymentIntents.create({ payment_method_types: ['card'] });
  await stripe.paymentIntents.update(id, { payment_method_types: ['card'] });
  await stripe.paymentIntents.confirm(id, { payment_method_types: ['card'] });
  await stripe.setupIntents.create({ payment_method_types: ['card'] });
  await stripe.setupIntents.update(id, { payment_method_types: ['card'] });
}
module.exports = { all };
`;

/**
 * The walk fixture with its two unreadable pages made READABLE (mapped to the
 * committed "readable, zero changes" page). Same five detected changes, but
 * `gaps` is empty — so R1's coverage inhibition cannot be what silences the
 * clean-run note in the R2 test below.
 */
const COMPLETE_WALK_FIXTURES: Record<string, string> = {
  ...WALK_FIXTURES,
  'https://docs.stripe.com/changelog/acacia/2025-01-01/baseline-already-applied.md': fx('billing-mode-default-flexible.md'),
  'https://docs.stripe.com/changelog/acacia/2025-03-01/unreachable-detail-page.md': fx('billing-mode-default-flexible.md'),
};

test('R2 — AC2ter (f), ISOLATED: with five matches, no warning AND no unread page to hide behind, exit 20 and the clean-run note never coexist', () => {
  // The existing "forbidden pair" test uses AFFECTED, where 4 of 5 changes do
  // NOT match: `warned > 0` inhibits the note by itself, so removing
  // `skipped += listed` left it green. Every other inhibitor must be absent
  // here too — including `gaps` (the standard walk fixture has two unreadable
  // pages, which R1 now also makes inhibit) — so `skipped` is the ONLY term
  // standing between the listing and the note.
  const r = runCli(['run', makeRepo(FIVE_MATCHES), '--out', tmp('out')], { fixtures: COMPLETE_WALK_FIXTURES });

  assert.match(r.stdout, /5 detected change\(s\) affect this repo/, 'the premise: five matches');
  assert.ok(!/WARNING: change detected but no matching call site/.test(r.stdout), 'the premise: no warning is present to inhibit the note');
  assert.ok(!/could not be read/.test(r.stdout), 'the premise: the walk has no hole to inhibit the note');
  assert.ok(!CLEAN_NOTE.test(r.stdout), 'a listing of five affected changes cannot sit next to "no known API change affects this repo"');
  assert.strictEqual(r.status, 20);
});

test('R3 — AC14, wiring: a model IS resolved, the matches exceed the cap, no --yes: exit 1, "above the cap", nothing sent, nothing written', () => {
  // The unit tests in tests/plan-cap.test.ts cover the cap itself. This covers
  // the CABLE: that `runCli` hands the user's `--yes` (and only it) to the
  // planner when a model exists. Hardcoding `yes: true` there disarms the cap
  // for everybody and no unit test would notice.
  const out = tmp('out');
  const r = runCli(['run', makeRepo(FIVE_MATCHES), '--ai', '--max-changes', '1', '--out', out], { env: { APIDRIFT_STUB_LLM: '1' } });

  assert.strictEqual(r.status, 1, `the cap must refuse:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /above the cap of 1/);
  assert.match(r.stderr, /--yes/, 'and it says how to confirm');
  assert.deepStrictEqual(fs.readdirSync(out), [], 'a refusal writes nothing');
});

test('--since under --deterministic-only is said to be IGNORED (fail loud), and changes nothing else', () => {
  const r = runCli(['run', makeRepo(AFFECTED), '--deterministic-only', '--since', '2025-03-31.basil', '--out', tmp('out')]);

  assert.deepStrictEqual(r.fetched, [], 'still zero fetch');
  assert.strictEqual(r.status, 0, 'the exit code is the offline mode\'s, unchanged');
  assert.match(r.stdout, /--since 2025-03-31\.basil was IGNORED/);
  assert.match(r.stdout, /does not walk/);

  const without = runCli(['run', makeRepo(AFFECTED), '--deterministic-only', '--out', tmp('out')]);
  assert.ok(!/IGNORED/.test(without.stdout), 'no --since, nothing to say');
});

test('R3 (converse) — the same run WITH --yes passes the cap: the flag is honoured, not ignored', () => {
  const r = runCli(['run', makeRepo(FIVE_MATCHES), '--ai', '--max-changes', '1', '--yes', '--out', tmp('out')], { env: { APIDRIFT_STUB_LLM: '1' } });

  assert.ok(!/above the cap/i.test(r.stderr), `--yes must lift the cap:\n${r.stderr}`);
  assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
});

// ══════════════════════════════════════════════════════════════════════════
// US-16 — AC3 sortie (3)/(4)/(5), and the decision humaine A3/B1 exit codes.
// ══════════════════════════════════════════════════════════════════════════

test('US-16, AC3/A3 — N < M unreadable pages, nothing matched: exit 0, and N/M is counted in the "done" line', () => {
  // UNAFFECTED never calls one of the fixture walk's 5 detected symbols, so
  // nothing matches — `listed` stays 0 and Vision B cannot fire. Of the walk's
  // 4 attempted pages, 2 are unreadable (the default WALK_FIXTURES shape):
  // N (2) < M (4), so decision humaine A3 keeps this at exit 0.
  const r = runCli(['run', makeRepo(UNAFFECTED), '--out', tmp('out')]);

  assert.strictEqual(r.status, 0, `A3: N < M must stay 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /2\/4 pages? unread/, 'the "done" line counts N\\/M');
  assert.ok(!/error:.*established nothing/i.test(r.stderr), 'N < M is not the "established nothing" case');
});

test('US-16, AC3/A3 — N == M > 0 (every attempted page unreadable), nothing matched: exit 1, "established nothing"', () => {
  // Same premise as R1(a) above, restated with UNAFFECTED (decoupled from
  // AFFECTED's own matching behaviour) to isolate A3's own condition.
  const r = runCli(['run', makeRepo(UNAFFECTED), '--out', tmp('out')], { fixtures: INDEX_ONLY });

  assert.strictEqual(r.status, 1, `A3: N == M > 0 must be 1:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /established nothing/i);
});

test('US-16, AC3 sortie (4) — "up to date" names the PROVENANCE of the resolved bound: an explicit pin names file:line', () => {
  const PINNED_AT_LATEST = `'use strict';
const stripe = require('stripe')(process.env.STRIPE_KEY, { apiVersion: '2025-04-01.acacia' });
async function listCustomers() { return stripe.customers.list({ limit: 3 }); }
module.exports = { listCustomers };
`;
  const r = runCli(['run', makeRepo(PINNED_AT_LATEST), '--out', tmp('out')]);

  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /IS the latest release published on its line/);
  assert.match(r.stdout, /pinned explicitly in your source/);
  assert.match(r.stdout, /src[/\\]pay\.js:2/, 'the exact file:line the literal was read from');
});

test('US-16, AC3 sortie (4) — --since names an explicit override, not the resolved pin\'s file', () => {
  const r = runCli(['run', makeRepo(UNAFFECTED), '--since', '2025-04-01.acacia', '--out', tmp('out')]);

  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /IS the latest release published on its line/);
  assert.match(r.stdout, /--since 2025-04-01\.acacia \(explicit override/);
  assert.ok(!/pay\.js/.test(r.stdout), '--since wins: the resolved pin\'s file is not named');
});

test('US-16, AC3 sortie (5) / decision humaine B1 — a range with ONLY report-only (forme #2) changes, no forme #1 matched: exit 0, "nothing here is auto-fixable", and NO clean-run note', () => {
  const r = runCli(['run', makeRepo(UNAFFECTED), '--out', tmp('out')], {
    fixtures: { [INDEX_URL]: fx('index-report-only-only.md'), [FORM2_URL]: fx('deprecate-subscription-current-period-start-and-end.md') },
  });

  assert.strictEqual(r.status, 0, `B1: report-only alone must stay 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /nothing here is auto-fixable/);
  assert.match(r.stdout, /1 response-shaped/);
  assert.ok(!/no known API change affects this repo/.test(r.stdout), 'a report-only change is not a clean bill of health (US-16, cleanRunNote reportOnly inhibition)');
  assert.ok(!/WARNING: change detected but no matching call site/.test(r.stdout), 'no forme #1 at all here — nothing for that guard to warn about');
});
