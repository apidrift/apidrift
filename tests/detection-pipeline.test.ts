import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/pipeline.js';
import { codemods as defaultCodemods } from '../src/changes/index.js';
import { stripeChargesToIntents } from '../src/changes/stripe-charges-to-intents.js';
import { detectChanges, type Fetcher } from '../src/detection/index.js';
import { genericSymbolCodemod } from '../src/matcher/symbol.js';
import type { Llm, LlmRequest, LlmResponse } from '../src/fixer/llm.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, '..', 'fixtures', 'stripe-changelog');
const readFixture = (name: string) => fs.readFileSync(path.join(fixturesDir, name), 'utf8');

const INDEX_MD = readFixture('index-excerpt.md');
const FORM1_URL =
  'https://docs.stripe.com/changelog/dahlia/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-intents.md';
const FORM1_MD = readFixture('removes-payment-method-types-parameter-from-payment-intents-setup-intents.md');
// The fixture index's "2026-08-26.preview" release has several OTHER Breaking
// rows besides FORM1_URL; detectChanges fetches every Breaking row for the
// requested release (it doesn't cherry-pick), so any changelog detail URL we
// don't recognize gets a minimal stub (empty Node.js table -> contributes
// nothing) — see tests/detection.test.ts for the full explanation.
const CHANGELOG_DETAIL_URL_RE = /^https:\/\/docs\.stripe\.com\/changelog\//;
const STUB_DETAIL_MD = [
  '# stub — not a US-2 fixture',
  '',
  '## Impact',
  '',
  'n/a for this test.',
  '',
  '## Changes',
  '',
  '#### Node.js',
  '',
  '| Parameter | Change | Resources or methods |',
  '| --- | --- | --- |',
].join('\n');

function fixtureFetcher(map: Record<string, string>): Fetcher {
  return async (url: string) => {
    if (url in map) return map[url];
    if (CHANGELOG_DETAIL_URL_RE.test(url)) return STUB_DETAIL_MD;
    throw new Error(`unexpected fetch: ${url}`);
  };
}

/** A scripted LLM: on first turn it writes `newContent`, then it stops. Same shape as tests/ai-fixer.test.ts. */
function mockLlm(targetRel: string, newContent: string): Llm {
  let turn = 0;
  return {
    async createMessage(_req: LlmRequest): Promise<LlmResponse> {
      turn += 1;
      if (turn === 1) {
        return {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 't1', name: 'write_file', input: { path: targetRel, content: newContent } }],
        };
      }
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
    },
  };
}

function makeRepo(sourceBody: string, testBody: string): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-detect-'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.mkdirSync(path.join(repo, 'test'));
  fs.mkdirSync(path.join(repo, 'node_modules', 'stripe'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'detect-e2e', type: 'commonjs', scripts: { test: 'node --test' } }),
  );
  // A fake `stripe` package under node_modules — real enough for the generic
  // matcher's root resolution (`require('stripe')(...)`) AND for the
  // verifier's `npm test` to actually resolve `require('stripe')` at runtime,
  // with no network and no real Stripe SDK installed.
  fs.writeFileSync(
    path.join(repo, 'node_modules', 'stripe', 'package.json'),
    JSON.stringify({ name: 'stripe', main: 'index.js' }),
  );
  fs.writeFileSync(
    path.join(repo, 'node_modules', 'stripe', 'index.js'),
    "module.exports = function Stripe() { return { paymentIntents: { confirm: async (id) => ({ id }) } }; };\n",
  );
  fs.writeFileSync(path.join(repo, 'src', 'pay.js'), sourceBody);
  fs.writeFileSync(path.join(repo, 'test', 'pay.test.js'), testBody);
  return repo;
}

// This is the exact wiring `--detect` performs in src/cli.ts: detectChanges()
// -> genericSymbolCodemod() -> RunOptions.codemods. It is exercised here at
// the pipeline level (same convention as tests/ai-fixer.test.ts) since
// src/cli.ts's `main()` runs on import and isn't itself a unit under test.
test('AC3: an auto-detected (forme #1) changelog change flows through the pipeline with zero hand-written find()/apply()', async () => {
  const detection = await detectChanges({
    fetcher: fixtureFetcher({
      'https://docs.stripe.com/changelog.md': INDEX_MD,
      [FORM1_URL]: FORM1_MD,
    }),
    release: '2026-08-26.preview',
  });

  const confirmChange = detection.autoExecutable.find((c) => c.target.symbol === 'stripe.paymentIntents.confirm');
  assert.ok(confirmChange, 'expected the confirm() Change to be detected as auto-executable');
  assert.strictEqual(confirmChange!.confidence, 'low');

  const codemod = genericSymbolCodemod(confirmChange!);
  assert.strictEqual(codemod.apply, undefined, 'no hand-written apply() — this must go through the AI tier');

  const oldSource = `'use strict';
const stripe = require('stripe')(process.env.STRIPE_KEY);
async function confirmPayment(id, extra) {
  const pi = await stripe.paymentIntents.confirm(id, { payment_method_types: ['card'], ...extra });
  return pi.id;
}
module.exports = { confirmPayment };
`;
  const fixedSource = `'use strict';
const stripe = require('stripe')(process.env.STRIPE_KEY);
async function confirmPayment(id, extra) {
  const pi = await stripe.paymentIntents.confirm(id, { ...extra });
  return pi.id;
}
module.exports = { confirmPayment };
`;
  const goodTest = `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { confirmPayment } = require('../src/pay');
test('confirms a payment intent', async () => {
  const id = await confirmPayment('pi_1', {});
  assert.strictEqual(id, 'pi_1');
});
`;

  const repo = makeRepo(oldSource, goodTest);
  const results = await run(repo, {
    outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-detect-out-')),
    codemods: [genericSymbolCodemod(confirmChange!)],
    llm: mockLlm('src/pay.js', fixedSource),
  });

  const r = results.find((x) => x.change.id === confirmChange!.id);
  assert.ok(r, 'expected the detected change to run through the pipeline');
  assert.strictEqual(r!.matches.length, 1, 'the generic matcher must find the one confirm() call');
  assert.strictEqual(r!.method, 'ai', 'a detected change with no apply() always uses the AI tier');
  assert.strictEqual(r!.applied, true);
  assert.strictEqual(r!.verify?.passed, true);
  assert.strictEqual(r!.draft, false);

  fs.rmSync(repo, { recursive: true, force: true });
});

test('AC5: a forme #2 change is never among detectChanges().autoExecutable, so it can never reach the pipeline via this seam', async () => {
  const FORM2_URL =
    'https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md';
  // Build a tiny index whose only Breaking row is the forme #2 fixture, so we
  // can assert autoExecutable stays empty end to end.
  const tinyIndex = `## 2025-03-31.basil\n\n| Title | Affected Products | Breaking change? | Category |\n| --- | --- | --- | --- |\n| [Adds subscription item-level billing periods and removes subscription-level periods](${FORM2_URL}) | Billing | Breaking | api |\n`;

  const result = await detectChanges({
    fetcher: fixtureFetcher({
      'https://docs.stripe.com/changelog.md': tinyIndex,
      [FORM2_URL]: readFixture('deprecate-subscription-current-period-start-and-end.md'),
    }),
    release: '2025-03-31.basil',
  });

  assert.deepStrictEqual(result.autoExecutable, [], 'forme #2 must never be injectable into RunOptions.codemods');
  assert.strictEqual(result.all.length, 1);
  assert.strictEqual(result.all[0].classification, 'object');
});

// ── anti-silence guard (Phase-0 spike follow-up) ────────────────────────────
// A detection-fed Change (no apply()) that matches zero call sites must never
// read as an ordinary, silent "nothing to do" when the repo demonstrably DOES
// construct the vendor's client — that's the exact shape of "the matcher just
// doesn't recognize this repo's construction pattern" (see the destructured
// require gap documented in tests/matcher-symbol.test.ts), which is a real gap
// to flag, not a clean bill of health.

test('anti-silence: a detected change with 0 matches WARNS when the repo constructs the vendor client via an unrecognized shape', async () => {
  const change = genericSymbolCodemod({
    id: 'test-stripe-subscriptions-retrieve',
    vendor: 'stripe',
    source: 'changelog',
    kind: 'breaking',
    title: 'test change',
    target: { type: 'symbol', symbol: 'stripe.subscriptions.retrieve' },
    migration: { op: 'removed', detail: 'irrelevant to this test' },
    references: ['https://docs.stripe.com/changelog.md (consulted 2026-09-10)'],
    confidence: 'low',
  });

  // Destructured require: a documented gap in the generic matcher's root
  // resolution, but resolveAstClientOption (US-7, deliberately WIDE) still
  // sees the construction — that gap between "the guard can see it" and "the
  // matcher can act on it" is exactly what this warning exists to surface.
  const repo = makeRepo(
    `'use strict';
const { Stripe } = require('stripe');
const stripe = new Stripe(process.env.STRIPE_KEY);
async function loadSub(id) {
  return stripe.subscriptions.retrieve(id);
}
module.exports = { loadSub };
`,
    `'use strict';
const { test } = require('node:test');
test('placeholder — never executed, matches.length is 0', () => {});
`,
  );

  const results = await run(repo, {
    outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-warn-out-')),
    codemods: [change],
  });

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].matches.length, 0, 'the destructured-require shape is a documented matcher gap');
  assert.deepStrictEqual(results[0].warning, { reason: 'vendor-present-no-match' });

  fs.rmSync(repo, { recursive: true, force: true });
});

test('anti-silence: no warning when there is genuinely no vendor client anywhere in the repo (the ordinary, ship-as-is case)', async () => {
  const change = genericSymbolCodemod({
    id: 'test-stripe-subscriptions-retrieve-absent',
    vendor: 'stripe',
    source: 'changelog',
    kind: 'breaking',
    title: 'test change',
    target: { type: 'symbol', symbol: 'stripe.subscriptions.retrieve' },
    migration: { op: 'removed', detail: 'irrelevant to this test' },
    references: ['https://docs.stripe.com/changelog.md (consulted 2026-09-10)'],
    confidence: 'low',
  });

  const repo = makeRepo(
    `'use strict';
function loadSub(id) { return { id }; } // no stripe usage at all
module.exports = { loadSub };
`,
    `'use strict';
const { test } = require('node:test');
test('placeholder — never executed, matches.length is 0', () => {});
`,
  );

  const results = await run(repo, {
    outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-nowarn-out-')),
    codemods: [change],
  });

  assert.strictEqual(results[0].matches.length, 0);
  assert.strictEqual(results[0].warning, undefined, 'no vendor client anywhere: an ordinary, silent "not applicable"');

  fs.rmSync(repo, { recursive: true, force: true });
});

test('anti-silence: NEVER fires for a hand-written codemod (apply() present) — 0 matches stays its ordinary, silent case', async () => {
  // stripeChargesToIntents matches `charges.create`; this repo's Stripe client
  // is real and constructed, but only ever calls `paymentIntents.retrieve` —
  // the overwhelmingly common case (most repos simply don't use the
  // deprecated pattern) that must stay silent, exactly as before this change.
  const repo = makeRepo(
    `'use strict';
const stripe = require('stripe')(process.env.STRIPE_KEY);
async function loadIntent(id) {
  return stripe.paymentIntents.retrieve(id);
}
module.exports = { loadIntent };
`,
    `'use strict';
const { test } = require('node:test');
test('placeholder — never executed, matches.length is 0', () => {});
`,
  );

  const results = await run(repo, {
    outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-handwritten-out-')),
    codemods: [stripeChargesToIntents],
  });

  assert.strictEqual(results[0].matches.length, 0);
  assert.strictEqual(results[0].warning, undefined, 'a hand-written codemod never gets the anti-silence warning');

  fs.rmSync(repo, { recursive: true, force: true });
});

test('AC7: non-regression — a run with no `codemods` option still uses exactly the hardcoded registry, unchanged by US-2', async () => {
  const target = path.join(here, '..', 'fixtures', 'acme-payments');
  const results = await run(target, { outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-nonreg-')) });

  assert.strictEqual(results.length, defaultCodemods.length, 'same number of results as the untouched registry');
  const ids = results.map((r) => r.change.id).sort();
  assert.deepStrictEqual(
    ids,
    defaultCodemods.map((c) => c.change.id).sort(),
    'exactly the registry\'s changes ran — detection never touches src/changes/index.ts',
  );
});
