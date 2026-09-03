import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripeChargesToIntents } from '../src/changes/stripe-charges-to-intents.js';
import { stripeSubscriptionPeriodToItems } from '../src/changes/stripe-subscription-current-period-to-items.js';
import { loadProject, findMatches } from '../src/matcher/index.js';
import { applyFix } from '../src/fixer/index.js';
import type { Codemod } from '../src/types.js';

/**
 * US-8: `src/fixer/index.ts` used to call `SourceFile#formatText()` on the
 * WHOLE touched file after every codemod, reformatting lines the codemod
 * never edited (e.g. `function (x)` -> `function(x)`). On
 * feross/studynotes.org (US-6) that woke up the target repo's `standard`
 * linter and turned an otherwise-correct fix into a draft PR — a blast-radius
 * violation (CLAUDE.md). The fix (this US) formats only the AST range each
 * `Match` actually edited, via `Node#formatText()`. See
 * .claude/agent-memory/architecte/decision_fixer_format_scope.md.
 */

const workspaceDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-format-scope-'));

/**
 * Every line that differs between `before` and `after` must fall inside the
 * union of `ranges` (1-indexed, inclusive — `[node.getStartLineNumber(),
 * node.getEndLineNumber()]` captured on each `Match.node` BEFORE `apply()`
 * ran). `formatText()`/`apply()` can only ever INSERT lines inside a matched
 * range (e.g. `addPropertyAssignment` growing an object literal), never
 * delete lines outside it — so lines strictly before the range and lines
 * strictly after it (shifted by however many lines were inserted) must be
 * byte-for-byte identical.
 */
function assertEditsWithinRanges(
  before: string,
  after: string,
  ranges: Array<[number, number]>,
  label: string,
): void {
  const linesBefore = before.split('\n');
  const linesAfter = after.split('\n');
  const start = Math.min(...ranges.map(([s]) => s));
  const end = Math.max(...ranges.map(([, e]) => e));
  const delta = linesAfter.length - linesBefore.length;
  assert.ok(delta >= 0, `${label}: formatting should never remove lines`);

  assert.deepStrictEqual(
    linesAfter.slice(0, start - 1),
    linesBefore.slice(0, start - 1),
    `${label}: a line BEFORE the matched range changed — blast radius violation`,
  );
  assert.deepStrictEqual(
    linesAfter.slice(end + delta),
    linesBefore.slice(end),
    `${label}: a line AFTER the matched range changed — blast radius violation`,
  );
}

/** Writes `sourceText` to a fresh on-disk workspace and finds the codemod's matches. */
function setUp(codemod: Codemod, sourceText: string, fileName: string) {
  const dir = workspaceDir();
  fs.writeFileSync(path.join(dir, fileName), sourceText);
  const project = loadProject(dir);
  const matches = findMatches(project, codemod);
  const ranges: Array<[number, number]> = matches.map((m) => [
    m.node.getStartLineNumber(),
    m.node.getEndLineNumber(),
  ]);
  return { dir, project, matches, ranges };
}

/**
 * Reduced from `routes/order.js` at `feross/studynotes.org` — the exact file
 * whose whole-file reformat made a correct fix fall back to draft in US-6.
 * SHA 7556fd62512213dc227d00674ed146a57a792be5,
 * https://github.com/feross/studynotes.org/blob/7556fd62512213dc227d00674ed146a57a792be5/routes/order.js
 * Same deliberate non-default style as the original: a space before every
 * function's parameter list (`function (x)` — the `standard` linter style,
 * the opposite of TypeScript's own formatter default, which is exactly what
 * `SourceFile#formatText()` used to collapse into `function(x)`).
 * `.catch(() => {})` is a second, unrelated style marker (the symptom
 * observed on agnaistic/agnai during US-6).
 */
const ORDER_JS = `const stripe = require('stripe')('sk_test')

module.exports = function (app) {
  app.post('/order', function (req, res, next) {
    auto({
      stripeCharge: function (cb) {
        stripe.charges.create({
          amount: 100,
          currency: 'usd',
          source: req.body.id
        }, cb)
      },
      order: ['stripeCharge', function (r, cb) {
        order.save(function (err, order) {
          cb(err, order)
        })
      }]
    }, function (err, r) {
      if (err) return next(err)
      res.sendStatus(200)
    })
  })

  app.get('/other', function (req, res) {
    somePromise().catch(() => {})
  })
}
`;

test('tier 1 (charges->paymentIntents): formatText() stays inside the matched call; non-default style survives elsewhere', async () => {
  const { dir, project, matches, ranges } = setUp(stripeChargesToIntents, ORDER_JS, 'order.js');
  assert.strictEqual(matches.length, 1, 'expected exactly one charges.create match');

  const before = ORDER_JS;
  const spacedFnCountBefore = (before.match(/function \(/g) ?? []).length;

  await applyFix({ workspaceDir: dir, project, codemod: stripeChargesToIntents, matches });

  const after = fs.readFileSync(path.join(dir, 'order.js'), 'utf8');

  // AC2 / durable assertion: the only lines that changed are inside the
  // matched call's own AST range.
  assertEditsWithinRanges(before, after, ranges, 'stripe.charges.create call');

  // AC4 / symptom assertion, naming the exact US-6 regression: `function (`
  // survives untouched outside the matched call, and no `function(` (the
  // collapsed form the whole-file formatter used to produce) appears at all.
  const spacedFnCountAfter = (after.match(/function \(/g) ?? []).length;
  assert.strictEqual(
    spacedFnCountAfter,
    spacedFnCountBefore,
    'space-before-paren function style should be untouched outside the matched call',
  );
  assert.ok(!after.includes('function('), 'no `function (` should have collapsed to `function(`');
  assert.ok(after.includes('.catch(() => {})'), 'the unrelated .catch(() => {}) style marker should be untouched');

  // Sanity: the codemod actually ran (this isn't a no-op passing vacuously).
  assert.ok(after.includes('stripe.paymentIntents.create'), 'sanity: the call should have been migrated');
  assert.ok(after.includes('confirm: true'), 'sanity: the codemod adds confirm: true');

  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Same style markers as ORDER_JS, exercised against the second codemod
 * (`stripe-subscription-current-period-to-items`), which rewrites the
 * matched node via `replaceWithText` — the codemod `src/fixer/index.ts`'s
 * `wasForgotten()` guard exists for (see the comment there). Two matches in
 * the same file also exercises the multi-match loop.
 */
const BILLING_JS = `async function getBillingPeriod (stripe, id) {
  const subscription = await stripe.subscriptions.retrieve(id)
  const start = subscription.current_period_start
  const end = subscription.current_period_end
  return { start, end }
}

module.exports = function (app) {
  app.get('/billing', function (req, res) {
    somePromise().catch(() => {})
  })
}
`;

test('tier 1 (subscription current_period_* -> items): formatText() stays inside the matched reads; wasForgotten() guard path runs', async () => {
  const { dir, project, matches, ranges } = setUp(stripeSubscriptionPeriodToItems, BILLING_JS, 'billing.js');
  assert.strictEqual(matches.length, 2, 'expected both current_period_start and current_period_end to match');

  const before = BILLING_JS;
  const spacedFnCountBefore = (before.match(/function \(/g) ?? []).length;

  await applyFix({ workspaceDir: dir, project, codemod: stripeSubscriptionPeriodToItems, matches });

  const after = fs.readFileSync(path.join(dir, 'billing.js'), 'utf8');

  // AC2 / durable assertion, same shape as the charges->paymentIntents case,
  // over the union of both matches' ranges.
  assertEditsWithinRanges(before, after, ranges, 'subscription current_period_* reads');

  // AC4 / symptom assertion.
  const spacedFnCountAfter = (after.match(/function \(/g) ?? []).length;
  assert.strictEqual(
    spacedFnCountAfter,
    spacedFnCountBefore,
    'space-before-paren function style should be untouched outside the matched reads',
  );
  assert.ok(!after.includes('function('), 'no `function (` should have collapsed to `function(`');
  assert.ok(after.includes('.catch(() => {})'), 'the unrelated .catch(() => {}) style marker should be untouched');

  // Sanity: both matched reads were actually rewritten.
  assert.ok(
    after.includes('subscription.items.data[0].current_period_start'),
    'sanity: the first matched read should have been migrated',
  );
  assert.ok(
    after.includes('subscription.items.data[0].current_period_end'),
    'sanity: the second matched read should have been migrated',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});
