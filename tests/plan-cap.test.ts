/**
 * US-13, module B — the read-only PLAN pass: the BYOT cost cap (AC7/AC8) and
 * the forme #2 report-only guarantee (AC9).
 *
 * The cap lives between the walk and `run()`, never inside `src/pipeline.ts`:
 * `applyFix()` is the only caller of the `Llm` and it lives INSIDE `run()`, so
 * a gate placed before `run()` is structurally before any token can be spent.
 *
 * The first test in this file is the one that matters most. Filtering
 * zero-match candidates out before `run()` removes them from the only code
 * path that emits the anti-silence warning (`PipelineResult.warning`,
 * commit 78dbfe2) — so the plan pass has to reproduce that signal itself, and
 * that test was written before the filtering existed.
 *
 * Hermetic: fixture Markdown + stub fetcher, a spy `Llm` that never reaches a
 * network, temp repos (AC13).
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MAX_CHANGES,
  capBreachLines,
  parseMaxChanges,
  planChanges,
  reportOnlyEntries,
  runPlanned,
} from '../src/plan.js';
import { genericSymbolCodemod } from '../src/matcher/symbol.js';
import { stripeChargesToIntents } from '../src/changes/stripe-charges-to-intents.js';
import { createStripeVendorSource } from '../src/detection/stripe-source.js';
import type { Fetcher } from '../src/detection/index.js';
import type { Llm, LlmRequest, LlmResponse } from '../src/fixer/llm.js';
import type { Change, Codemod } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const fixturesDir = path.join(repoRoot, 'fixtures', 'stripe-changelog');
const readFixture = (name: string) => fs.readFileSync(path.join(fixturesDir, name), 'utf8');

/** Counts every call; never returns a tool_use, so nothing is ever edited. */
function spyLlm(): { llm: Llm; calls: () => number } {
  let calls = 0;
  return {
    llm: {
      async createMessage(_req: LlmRequest): Promise<LlmResponse> {
        calls += 1;
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'noop' }] };
      },
    },
    calls: () => calls,
  };
}

function detectedChange(symbol: string, apiVersion = '2025-03-31.basil'): Change {
  return {
    id: `stripe-${apiVersion.replace(/\./g, '-')}-${symbol.replace(/\./g, '-')}`,
    vendor: 'stripe',
    source: 'changelog',
    kind: 'breaking',
    title: `${symbol} changed`,
    target: { type: 'symbol', symbol },
    migration: { op: 'removed', detail: 'irrelevant to these tests' },
    references: ['https://docs.stripe.com/changelog.md (consulted 2026-09-19)'],
    confidence: 'low',
    apiVersion,
  };
}

function makeRepo(sourceBody: string): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-plan-'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.mkdirSync(path.join(repo, 'test'));
  fs.mkdirSync(path.join(repo, 'node_modules', 'stripe'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'plan-cap', type: 'commonjs', scripts: { test: 'node --test' } }),
  );
  fs.writeFileSync(
    path.join(repo, 'node_modules', 'stripe', 'package.json'),
    JSON.stringify({ name: 'stripe', main: 'index.js' }),
  );
  fs.writeFileSync(path.join(repo, 'node_modules', 'stripe', 'index.js'), 'module.exports = function Stripe() { return {}; };\n');
  fs.writeFileSync(path.join(repo, 'src', 'pay.js'), sourceBody);
  fs.writeFileSync(
    path.join(repo, 'test', 'pay.test.js'),
    "'use strict';\nconst { test } = require('node:test');\ntest('placeholder', () => {});\n",
  );
  return repo;
}

const SIX_CALL_SITES = `'use strict';
const stripe = require('stripe')(process.env.STRIPE_KEY);
async function everything(id, opts) {
  await stripe.paymentIntents.create(opts);
  await stripe.paymentIntents.update(id, opts);
  await stripe.paymentIntents.confirm(id, opts);
  await stripe.setupIntents.create(opts);
  await stripe.setupIntents.update(id, opts);
  await stripe.subscriptions.create(opts);
}
module.exports = { everything };
`;

const SIX_SYMBOLS = [
  'stripe.paymentIntents.create',
  'stripe.paymentIntents.update',
  'stripe.paymentIntents.confirm',
  'stripe.setupIntents.create',
  'stripe.setupIntents.update',
  'stripe.subscriptions.create',
];

const sixCandidates = (): Codemod[] => SIX_SYMBOLS.map((s) => genericSymbolCodemod(detectedChange(s)));

// ══ THE TRAP (D3) — the plan pass must reproduce the 78dbfe2 anti-silence signal ══

test('AC7 TRAP: a candidate the plan pass DISCARDS for 0 matches still WARNS when the repo constructs a Stripe client — the 78dbfe2 guard survives the filtering', () => {
  // Destructured require: a documented gap in the generic matcher's root
  // resolution, while resolveAstClientOption (deliberately WIDE) DOES see the
  // construction. That gap is exactly what the warning exists to surface, and
  // before this pass it was emitted only from src/pipeline.ts — on a codemod
  // this filtering now prevents from ever reaching it.
  const repo = makeRepo(`'use strict';
const { Stripe } = require('stripe');
const stripe = new Stripe(process.env.STRIPE_KEY);
async function loadSub(id) { return stripe.subscriptions.retrieve(id); }
module.exports = { loadSub };
`);
  try {
    const candidate = genericSymbolCodemod(detectedChange('stripe.subscriptions.retrieve'));
    const plan = planChanges(repo, [candidate]);

    assert.deepStrictEqual(plan.matched, [], 'nothing matched, so nothing is handed to run()');
    assert.strictEqual(plan.warnings.length, 1, 'and the signal is NOT lost with it');
    assert.deepStrictEqual(plan.warnings[0].warning, { reason: 'vendor-present-no-match' });
    assert.strictEqual(plan.warnings[0].change.target.symbol, 'stripe.subscriptions.retrieve');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC7 TRAP: no vendor client anywhere -> no warning (the ordinary, silent "not applicable"), same predicate as the pipeline\'s', () => {
  const repo = makeRepo("'use strict';\nfunction loadSub(id) { return { id }; }\nmodule.exports = { loadSub };\n");
  try {
    const plan = planChanges(repo, [genericSymbolCodemod(detectedChange('stripe.subscriptions.retrieve'))]);
    assert.deepStrictEqual(plan.matched, []);
    assert.deepStrictEqual(plan.warnings, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC7 TRAP: a hand-written codemod (apply() present) is never warned about — 0 matches stays its ordinary, silent case', () => {
  const repo = makeRepo(`'use strict';
const stripe = require('stripe')(process.env.STRIPE_KEY);
async function loadIntent(id) { return stripe.paymentIntents.retrieve(id); }
module.exports = { loadIntent };
`);
  try {
    const plan = planChanges(repo, [stripeChargesToIntents]);
    assert.deepStrictEqual(plan.matched, []);
    assert.deepStrictEqual(plan.warnings, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ══ AC7 — the cap counts MATCHES, and above it not one token is spent ══

test('AC7: the cap counts changes that MATCHED code, not changes detected — 20 detected with 1 match each is not a 20-change run', () => {
  const repo = makeRepo(`'use strict';
const stripe = require('stripe')(process.env.STRIPE_KEY);
async function one(opts) { return stripe.paymentIntents.create(opts); }
module.exports = { one };
`);
  try {
    const noise = Array.from({ length: 20 }, (_, i) => genericSymbolCodemod(detectedChange(`stripe.widgets.method${i}`)));
    const plan = planChanges(repo, [...noise, genericSymbolCodemod(detectedChange('stripe.paymentIntents.create'))]);

    assert.strictEqual(plan.matched.length, 1, 'only the one that really costs anything counts');
    assert.strictEqual(plan.blocked, false, 'a cap on DETECTED changes would have fired here and been disarmed by reflex');
    assert.strictEqual(plan.matched[0].matches.length, 1, 'and it carries its number of call sites, for the blocked listing');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC7 INVARIANT: a run above the cap consumes ZERO Llm calls — the gate is before run(), not inside it', async () => {
  const repo = makeRepo(SIX_CALL_SITES);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-plan-out-'));
  try {
    const spy = spyLlm();
    const { plan, results } = await runPlanned(repo, sixCandidates(), { outputDir: out, llm: spy.llm });

    assert.strictEqual(DEFAULT_MAX_CHANGES, 5);
    assert.strictEqual(plan.matched.length, 6);
    assert.strictEqual(plan.blocked, true);
    assert.strictEqual(results, null, 'the pipeline is never entered');
    assert.strictEqual(spy.calls(), 0, 'not one token above the cap');
    assert.deepStrictEqual(fs.readdirSync(out), [], 'and not one artifact either');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('AC7 CONTROL: below the cap the same run DOES reach the model — the invariant above is not vacuous', async () => {
  const repo = makeRepo(SIX_CALL_SITES);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-plan-out-'));
  try {
    const spy = spyLlm();
    const { plan, results } = await runPlanned(repo, sixCandidates().slice(0, 2), { outputDir: out, llm: spy.llm });

    assert.strictEqual(plan.blocked, false);
    assert.strictEqual(results?.length, 2);
    assert.ok(spy.calls() > 0, 'the fixer was reached for the changes that survived the plan');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

// ══ AC8 — fail-closed, non interactive, two escape hatches ══

test('AC8: above the threshold the run names every change concerned — id, symbol, release of origin, number of sites', () => {
  const repo = makeRepo(SIX_CALL_SITES);
  try {
    const plan = planChanges(repo, sixCandidates());
    const lines = capBreachLines(plan);

    assert.strictEqual(lines.length, 6, 'one line per change that would have cost tokens');
    for (const symbol of SIX_SYMBOLS) {
      const line = lines.find((l) => l.includes(symbol));
      assert.ok(line, `no line for ${symbol}`);
      assert.ok(line!.includes('2025-03-31.basil'), 'the release of origin is what tells the reader WHERE this came from');
      assert.match(line!, /1 site\b/);
      assert.ok(line!.includes(`stripe-2025-03-31-basil-${symbol.replace(/\./g, '-')}`), 'and its id');
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC8: the decision is identical in a TTY and outside one — there is no prompt, hence no second code path', () => {
  const repo = makeRepo(SIX_CALL_SITES);
  const original = process.stdout.isTTY;
  try {
    process.stdout.isTTY = true;
    const inTty = planChanges(repo, sixCandidates()).blocked;
    process.stdout.isTTY = false;
    const outOfTty = planChanges(repo, sixCandidates()).blocked;

    assert.strictEqual(inTty, true);
    assert.strictEqual(outOfTty, true, 'a "yes" is never assumed, and never asked for');
  } finally {
    process.stdout.isTTY = original;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC8: --max-changes RAISES or LOWERS the threshold, and --yes confirms without any prompt', () => {
  const repo = makeRepo(SIX_CALL_SITES);
  try {
    const candidates = sixCandidates();
    assert.strictEqual(planChanges(repo, candidates).blocked, true, 'default N = 5, 6 matches');
    assert.strictEqual(planChanges(repo, candidates, { maxChanges: 10 }).blocked, false, 'raised');
    assert.strictEqual(planChanges(repo, candidates, { maxChanges: 2 }).blocked, true, 'lowered');
    assert.strictEqual(planChanges(repo, candidates.slice(0, 3), { maxChanges: 2 }).blocked, true, 'lowered, and it bites');
    assert.strictEqual(planChanges(repo, candidates, { yes: true }).blocked, false, '--yes');
    assert.strictEqual(
      planChanges(repo, candidates, { maxChanges: 6 }).blocked,
      false,
      'the cap is a ceiling, not a strict inequality: exactly N is allowed',
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC8: --max-changes takes an integer > 0 — there is deliberately no "unlimited" value', () => {
  assert.strictEqual(parseMaxChanges('1'), 1);
  assert.strictEqual(parseMaxChanges('42'), 42);
  assert.strictEqual(parseMaxChanges(undefined), undefined, 'absent means the default, not an error');

  for (const bad of ['0', '-3', '2.5', 'unlimited', 'all', '', 'NaN', 'Infinity']) {
    assert.throws(() => parseMaxChanges(bad), /--max-changes/, `expected ${JSON.stringify(bad)} to be refused`);
  }
});

test('AC8 subprocess: the CLI carries both escape hatches, and a malformed --max-changes exits non-zero instead of silently using the default', () => {
  const repo = makeRepo("'use strict';\nmodule.exports = { add: (a, b) => a + b };\n");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-cap-cli-'));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_TEST_CONTEXT: undefined };
  delete env.ANTHROPIC_API_KEY;
  const cli = (args: string[]) =>
    spawnSync('npx', ['tsx', 'src/cli.ts', 'run', repo, '--deterministic-only', '--out', out, ...args], {
      cwd: repoRoot, encoding: 'utf8', env,
    });

  try {
    const bad = cli(['--max-changes', '0']);
    assert.strictEqual(bad.status, 1, 'a cap of 0 is refused, not rounded up to the default');
    assert.match(bad.stderr, /--max-changes/);
    // No detection flag, so nothing above could have touched the network — the
    // flag is validated before any I/O at all.
    assert.strictEqual(bad.stdout, '', 'it fails before the run even starts');

    const help = cli(['--help']);
    assert.match(help.stdout, /--max-changes <n>/);
    assert.match(help.stdout, /-y, --yes/);
    assert.match(help.stdout, /There is no prompt/i, 'the non-interactive behaviour is documented, not implicit');

    // The flags are inert on a repo nothing matches — they must not change the
    // ordinary path (non-regression with US-17's clean-run note).
    const ok = cli(['--yes', '--max-changes', '10']);
    assert.strictEqual(ok.status, 0, `CLI failed:\n${ok.stdout}\n${ok.stderr}`);
    assert.match(ok.stdout.replace(/\x1b\[[0-9;]*m/g, ''), /no known API change affects this repo/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

// ══ AC9 — forme #2 is reported, and NEVER produces an artifact ══

const indexUrl = 'https://docs.stripe.com/changelog.md';
const FORM1_URL =
  'https://docs.stripe.com/changelog/dahlia/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-intents.md';
const FORM2_URL =
  'https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md';
const NO_CHANGES_URL = 'https://docs.stripe.com/changelog/basil/2025-03-31/billing-mode-default-flexible.md';

function channelsFetcher(): Fetcher {
  const pages: Record<string, string> = {
    [indexUrl]: readFixture('index-walk-channels.md'),
    [FORM1_URL]: readFixture('removes-payment-method-types-parameter-from-payment-intents-setup-intents.md'),
    [FORM2_URL]: readFixture('deprecate-subscription-current-period-start-and-end.md'),
    [NO_CHANGES_URL]: readFixture('billing-mode-default-flexible.md'),
  };
  return async (url) => {
    if (url in pages) return pages[url];
    throw new Error(`simulated fetch failure: ${url}`);
  };
}

test('AC9: a walk carrying a forme #2 REPORTS it with its release of origin and the URL of its page', async () => {
  const source = createStripeVendorSource({ fetcher: channelsFetcher(), indexUrl, fetchedAt: () => '2026-09-19' });
  const diff = await source.changesSince('2023-08-16');

  const entries = reportOnlyEntries(diff.reportOnly);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].symbol, 'stripe.subscriptions.object');
  assert.strictEqual(entries[0].release, '2024-06-20', 'the release the index put it under');
  assert.strictEqual(entries[0].url, FORM2_URL, 'the page a human has to open to act on it');
  assert.ok(entries[0].id.length > 0);
});

test('AC9: a forme #2 never produces a branch, a patch or a PR — no artifact in the output directory carries its id', async () => {
  const source = createStripeVendorSource({ fetcher: channelsFetcher(), indexUrl, fetchedAt: () => '2026-09-19' });
  const diff = await source.changesSince('2023-08-16');

  assert.strictEqual(diff.reportOnly.length, 1, 'the walk really does carry a forme #2');
  const reportOnlyId = diff.reportOnly[0].change.id;

  const repo = makeRepo(`'use strict';
const stripe = require('stripe')(process.env.STRIPE_KEY);
async function period(id) {
  const sub = await stripe.subscriptions.retrieve(id);
  return sub.current_period_end;
}
async function one(opts) { return stripe.paymentIntents.create(opts); }
module.exports = { period, one };
`);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-reportonly-out-'));
  try {
    const spy = spyLlm();
    // Exactly what a caller is allowed to hand to the pipeline: `autoExecutable`.
    // `reportOnly` has no seam into RunOptions.codemods at all.
    const { results } = await runPlanned(
      repo,
      diff.autoExecutable.map((c) => genericSymbolCodemod(c)),
      { outputDir: out, llm: spy.llm, maxChanges: 10 },
    );

    assert.ok(results, 'the run itself is not blocked');
    assert.ok(!results!.some((r) => r.change.id === reportOnlyId), 'the forme #2 never reaches the pipeline');
    for (const file of fs.readdirSync(out)) {
      assert.ok(!file.includes(reportOnlyId), `an artifact was written for a report-only change: ${file}`);
    }
    assert.ok(!fs.existsSync(path.join(repo, '.git')), 'and nothing was branched in the target repo');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});
