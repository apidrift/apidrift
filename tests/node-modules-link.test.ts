import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/pipeline.js';

const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-out-'));

/**
 * US-1, fix A: makeWorkspace() copies the target repo but skips node_modules,
 * so the verifier's `npm test` would fail on any real repo purely for missing
 * dependencies. The pipeline must symlink the CLONE's own installed
 * node_modules into the workspace so the target's real test suite can run.
 */
test('node_modules link: the workspace can run tests that require an installed dependency', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-linktarget-'));
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.mkdirSync(path.join(target, 'test'), { recursive: true });
  fs.mkdirSync(path.join(target, 'node_modules', 'some-dep'), { recursive: true });

  fs.writeFileSync(
    path.join(target, 'package.json'),
    JSON.stringify({ name: 'linktest', type: 'commonjs', scripts: { test: 'node --test' } }, null, 2),
  );
  fs.writeFileSync(
    path.join(target, 'node_modules', 'some-dep', 'package.json'),
    JSON.stringify({ name: 'some-dep', main: 'index.js' }, null, 2),
  );
  fs.writeFileSync(
    path.join(target, 'node_modules', 'some-dep', 'index.js'),
    'module.exports = 42;\n',
  );
  fs.writeFileSync(
    path.join(target, 'src', 'checkout.js'),
    `'use strict';
async function chargeCustomer(stripe, { amountCents, token }) {
  const charge = await stripe.charges.create({ amount: amountCents, currency: 'usd', source: token });
  return { paymentId: charge.id };
}
module.exports = { chargeCustomer };
`,
  );
  fs.writeFileSync(
    path.join(target, 'test', 'checkout.test.js'),
    `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
// This only passes if the workspace's node_modules is really the target
// clone's installed node_modules (symlinked in), not an empty copy.
const dep = require('some-dep');
test('installed dependency is reachable from the workspace', () => {
  assert.strictEqual(dep, 42);
});
`,
  );

  const results = run(target, { outputDir: outDir() });
  return results.then((rs) => {
    const r = rs.find((x) => x.change.id === 'stripe-charges-create-to-payment-intents');
    assert.ok(r, 'expected the stripe codemod to run');
    assert.strictEqual(r.applied, true, 'should have applied a fix');
    assert.strictEqual(
      r.verify?.passed,
      true,
      `expected the target's own test suite (which needs node_modules) to pass: ${r.verify?.output}`,
    );
    assert.strictEqual(r.draft, false);

    // The symlinked node_modules must never leak into the produced patch.
    assert.ok(r.patchPath && fs.existsSync(r.patchPath));
    const patch = fs.readFileSync(r.patchPath!, 'utf8');
    assert.ok(!patch.includes('node_modules'), 'the patch must not reference node_modules');

    fs.rmSync(target, { recursive: true, force: true });
  });
});
