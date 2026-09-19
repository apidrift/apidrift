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
  opts: { fixtures?: Record<string, string>; env?: Record<string, string>; fetchFails?: string } = {},
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
