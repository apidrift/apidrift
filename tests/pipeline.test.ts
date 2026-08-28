import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/pipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-out-'));

test('happy path: migrates the fixture and opens a non-draft PR with passing tests', async () => {
  const target = path.join(here, '..', 'fixtures', 'acme-payments');
  const results = await run(target, { outputDir: outDir() });

  const r = results.find((x) => x.change.id === 'stripe-charges-create-to-payment-intents');
  assert.ok(r, 'expected the stripe codemod to run');
  assert.strictEqual(r.applied, true, 'should have applied a fix');
  assert.strictEqual(r.matches.length, 1, 'should match exactly one usage');
  assert.strictEqual(r.verify?.passed, true, 'the fixture tests should pass after migration');
  assert.strictEqual(r.draft, false, 'a passing fix opens a real PR, not a draft');
  assert.ok(fs.existsSync(r.prPath!), 'PR.md should exist');
});

test('the moat: a fix that breaks tests opens a DRAFT and does not claim success', async () => {
  // A repo whose test is coupled to the OLD behavior (payment id prefix "ch_").
  // After migrating to paymentIntents the id becomes "pi_", so the test fails —
  // APIdrift must open a draft, never a green PR.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-strict-'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.mkdirSync(path.join(repo, 'lib'));
  fs.mkdirSync(path.join(repo, 'test'));

  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'strict', type: 'commonjs', scripts: { test: 'node --test' } }, null, 2),
  );
  fs.copyFileSync(
    path.join(here, '..', 'fixtures', 'acme-payments', 'lib', 'stripe-mock.js'),
    path.join(repo, 'lib', 'stripe-mock.js'),
  );
  fs.writeFileSync(
    path.join(repo, 'src', 'checkout.js'),
    `'use strict';
async function chargeCustomer(stripe, { amountCents, token }) {
  const charge = await stripe.charges.create({
    amount: amountCents,
    currency: 'usd',
    source: token,
  });
  return { paymentId: charge.id };
}
module.exports = { chargeCustomer };
`,
  );
  fs.writeFileSync(
    path.join(repo, 'test', 'checkout.test.js'),
    `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeStripe } = require('../lib/stripe-mock');
const { chargeCustomer } = require('../src/checkout');
test('payment id keeps the legacy ch_ prefix', async () => {
  const r = await chargeCustomer(makeStripe(), { amountCents: 100, token: 'tok' });
  assert.ok(r.paymentId.startsWith('ch_'), 'expected a legacy charge id');
});
`,
  );

  const results = await run(repo, { outputDir: outDir() });
  const r = results.find((x) => x.change.id === 'stripe-charges-create-to-payment-intents');

  assert.ok(r, 'expected the stripe codemod to run');
  assert.strictEqual(r.applied, true, 'the fix is applied...');
  assert.strictEqual(r.verify?.passed, false, '...but the coupled test fails');
  assert.strictEqual(r.draft, true, 'so APIdrift opens a DRAFT, not a green PR');
});
