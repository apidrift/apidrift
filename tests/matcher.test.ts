import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, findMatches } from '../src/matcher/index.js';
import { stripeChargesToIntents } from '../src/changes/stripe-charges-to-intents.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Non-regression coverage for the widened matcher glob (US-1): the matcher
 * now scans the whole repo tree (not just src/**), because real repos like
 * `sahat/hackathon-starter` keep their code in `controllers/`, not `src/`.
 * This must (a) still find code outside src/, and (b) still respect the
 * mandatory exclusions so it never picks up node_modules, build output, or
 * test files.
 */
test('widened glob: finds a match in controllers/ (no src/ dir at all)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-glob-'));
  fs.mkdirSync(path.join(repo, 'controllers'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'node_modules', 'stripe'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
  fs.mkdirSync(path.join(repo, '__tests__'), { recursive: true });

  const chargeCall = `
    exports.postStripe = (req, res) => {
      stripe.charges.create({ amount: 395, currency: 'usd', source: req.body.stripeToken }, () => {});
    };
  `;

  // Should be picked up: real source, outside src/.
  fs.writeFileSync(path.join(repo, 'controllers', 'api.js'), chargeCall);
  // Should be excluded: node_modules.
  fs.writeFileSync(path.join(repo, 'node_modules', 'stripe', 'index.js'), chargeCall);
  // Should be excluded: build output.
  fs.writeFileSync(path.join(repo, 'dist', 'api.js'), chargeCall);
  // Should be excluded: test dirs / test-named files.
  fs.writeFileSync(path.join(repo, 'test', 'api.test.js'), chargeCall);
  fs.writeFileSync(path.join(repo, '__tests__', 'api.js'), chargeCall);
  fs.writeFileSync(path.join(repo, 'controllers', 'api.spec.js'), chargeCall);

  const project = loadProject(repo);
  const matches = findMatches(project, stripeChargesToIntents);

  assert.strictEqual(matches.length, 1, 'only the real controllers/ source should match');
  assert.strictEqual(
    path.relative(repo, matches[0].filePath),
    path.join('controllers', 'api.js'),
  );

  fs.rmSync(repo, { recursive: true, force: true });
});

test('widened glob: the acme-payments fixture still matches exactly once (no false positives from lib/)', () => {
  const target = path.join(here, '..', 'fixtures', 'acme-payments');
  const project = loadProject(target);

  // lib/stripe-mock.js is now in scope (it's outside src/, and the glob is
  // no longer src/-only) — assert it's actually loaded, so this test would
  // fail if the glob regressed back to src/-only.
  const files = project.getSourceFiles().map((f) => path.relative(target, f.getFilePath()));
  assert.ok(
    files.includes(path.join('lib', 'stripe-mock.js')),
    'lib/ should be in scope under the widened default glob',
  );

  // lib/stripe-mock.js only *defines* charges.create as an object method
  // (never calls `<x>.charges.create(...)`), so it must not add a spurious
  // match on top of the real usage in src/checkout.js.
  const matches = findMatches(project, stripeChargesToIntents);
  assert.strictEqual(matches.length, 1, 'the fixture must still match exactly once');
});
