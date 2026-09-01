import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, SyntaxKind } from 'ts-morph';
import { stripeSubscriptionPeriodToItems as codemod } from '../src/changes/stripe-subscription-current-period-to-items.js';
import { stripeChargesToIntents } from '../src/changes/stripe-charges-to-intents.js';
import { loadProject } from '../src/matcher/index.js';
import { run } from '../src/pipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'acme-payments');
const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-out-'));

/**
 * Parses a snippet into a real ts-morph Project (not the in-memory FS, so the
 * language service behaves exactly as it does against a checked-out repo) and
 * runs the codemod's find().
 */
function projectFrom(sourceText: string) {
  const project = new Project({ compilerOptions: { allowJs: true }, useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('billing.js', sourceText);
  return { project, sourceFile };
}

function migrate(sourceText: string): string {
  const { project, sourceFile } = projectFrom(sourceText);
  for (const match of codemod.find(project)) codemod.apply!(match);
  return sourceFile.getFullText();
}

const LEGACY = `
async function getBillingPeriod(stripe, id) {
  const subscription = await stripe.subscriptions.retrieve(id);
  const start = subscription.current_period_start;
  const end = subscription.current_period_end;
  return { start, end };
}
`;

// ── The Change record ──────────────────────────────────────────────────────

test('the Change record carries the documented sources and the multi-item caveat', () => {
  const { change } = codemod;

  assert.strictEqual(change.id, 'stripe-subscription-current-period-to-items');
  assert.strictEqual(change.kind, 'breaking');
  assert.strictEqual(change.migration.op, 'param_move');
  assert.strictEqual(change.confidence, 'medium', 'items.data[0] is a judgement call on multi-item subscriptions');

  assert.ok(
    change.references.some((r) =>
      r.startsWith('https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md'),
    ),
    'the changelog entry must be cited',
  );
  assert.ok(
    change.references.some((r) => r.includes('/api/subscription_items/object')),
    'the replacement field on the SubscriptionItem object must be cited',
  );

  // The caveat has to reach the human: migration.detail is what buildPrBody
  // renders under "What changed upstream".
  assert.match(change.migration.detail!, /multi-item/i);
});

// ── AC2: the transformation, incl. two matches in one file ─────────────────

test('rewrites both period reads in the same file (the mutation loop)', () => {
  const { project } = projectFrom(LEGACY);
  assert.strictEqual(codemod.find(project).length, 2, 'both moved fields must be matched');

  const migrated = migrate(LEGACY);
  assert.match(migrated, /const start = subscription\.items\.data\[0\]\.current_period_start;/);
  assert.match(migrated, /const end = subscription\.items\.data\[0\]\.current_period_end;/);
  assert.doesNotMatch(migrated, /subscription\.current_period_/, 'no subscription-level read may survive');
});

test('the rewritten node is a PropertyAccessExpression and the output gains an ElementAccessExpression', () => {
  const { project } = projectFrom(LEGACY);
  const matches = codemod.find(project);

  // Structurally unlike codemod #1, whose Match.node is a CallExpression.
  for (const match of matches) {
    assert.strictEqual(match.node.getKind(), SyntaxKind.PropertyAccessExpression);
  }

  const { sourceFile } = projectFrom(migrate(LEGACY));
  const indexed = sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression);
  assert.strictEqual(indexed.length, 2, 'each rewrite inserts a data[0] element access');
  for (const node of indexed) assert.strictEqual(node.getText(), 'subscription.items.data[0]');
});

test('a non-awaited binding is matched too', () => {
  const migrated = migrate(`
    function f(stripe, id) {
      const sub = stripe.subscriptions.retrieve(id);
      return sub.current_period_end;
    }
  `);
  assert.match(migrated, /sub\.items\.data\[0\]\.current_period_end/);
});

// ── Nullability: the rewrite must not move the `?.` guard ──────────────────

test('an optional read keeps its short-circuit on the original receiver', () => {
  const migrated = migrate(`
    async function f(stripe, id) {
      const sub = await stripe.subscriptions.retrieve(id);
      return sub?.current_period_end;
    }
  `);

  // The guard stays on \`sub\`: a null \`sub\` still yields undefined, exactly as
  // it did before the migration.
  assert.match(migrated, /return sub\?\.items\.data\[0\]\.current_period_end;/);
  // ...and it must NOT have migrated onto the inserted \`data[0]\`, which would
  // turn a previously safe read into a TypeError on a null subscription.
  assert.ok(!migrated.includes('data[0]?.'), 'the `?.` must not move onto data[0]');
  assert.ok(!migrated.includes('sub.items'), 'the receiver must stay optional');
});

test('optional and non-optional reads coexist in one file after the rewrite', () => {
  const migrated = migrate(`
    async function f(stripe, id) {
      const sub = await stripe.subscriptions.retrieve(id);
      const start = sub.current_period_start;
      const end = sub?.current_period_end;
      return { start, end };
    }
  `);

  assert.match(migrated, /const start = sub\.items\.data\[0\]\.current_period_start;/);
  assert.match(migrated, /const end = sub\?\.items\.data\[0\]\.current_period_end;/);
  assert.ok(!migrated.includes('data[0]?.'), 'the `?.` must not move onto data[0]');
  assert.doesNotMatch(migrated, /sub\??\.current_period_/, 'no subscription-level read may survive');
});

test('the receiver of a match is always the binding identifier itself', () => {
  // Guards the rule apply() relies on: the node it rewrites is
  // `<binding><.|?.><moved field>`, so the only `?.` it can ever move is the
  // one on the matched access. An indirect receiver (`state?.sub.…`) is not the
  // binding identifier, so find() leaves it to the tier-2 agent.
  const { project } = projectFrom(`
    async function f(stripe, id) {
      const sub = await stripe.subscriptions.retrieve(id);
      const state = { sub };
      return state?.sub.current_period_end;
    }
  `);

  assert.strictEqual(codemod.find(project).length, 0, 'an indirect receiver is out of scope');

  const { project: direct } = projectFrom(`
    async function f(stripe, id) {
      const sub = await stripe.subscriptions.retrieve(id);
      return sub?.current_period_end;
    }
  `);
  const matches = codemod.find(direct);
  assert.strictEqual(matches.length, 1);
  const access = matches[0].node.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  assert.strictEqual(access.getExpression().getKind(), SyntaxKind.Identifier);
  assert.strictEqual(access.hasQuestionDotToken(), true, 'the optional read is matched, `?.` and all');
});

test('idempotence: applying the codemod twice changes nothing the second time', () => {
  const once = migrate(LEGACY);
  const twice = migrate(once);
  assert.strictEqual(twice, once);

  const { project } = projectFrom(once);
  assert.strictEqual(codemod.find(project).length, 0, 'already-migrated code must not match');
});

// ── AC5: matching is AST-only, never text ──────────────────────────────────

test('AST-only: the same characters in a comment or a string literal never match', () => {
  const { project } = projectFrom(`
    async function f(stripe, id) {
      const subscription = await stripe.subscriptions.retrieve(id);
      // legacy: subscription.current_period_end
      /* also legacy: subscription.current_period_start */
      const label = 'subscription.current_period_end';
      const other = "subscription.current_period_start";
      return { subscription, label, other };
    }
  `);

  assert.strictEqual(codemod.find(project).length, 0, 'comments and strings are not code');
});

test('AST-only: a different property-access chain is not matched', () => {
  const { project } = projectFrom(`
    async function f(stripe, invoice, id) {
      const subscription = await stripe.subscriptions.retrieve(id);
      const a = invoice.current_period_end;      // not the subscription binding
      const b = subscription.status;             // not a moved field
      const c = wrapper.subscription;            // the binding name as a property
      return { a, b, c };
    }
  `);

  assert.strictEqual(codemod.find(project).length, 0);
});

test('a read not anchored on a subscriptions call is not matched', () => {
  const { project } = projectFrom(`
    async function f(stripe, id) {
      const subscription = await stripe.invoices.retrieve(id);
      return subscription.current_period_end;
    }
  `);

  assert.strictEqual(codemod.find(project).length, 0, 'the anchor must be <x>.subscriptions.<method>()');
});

test('documented limitation: destructuring is left to the tier-2 agent, not silently mangled', () => {
  const { project } = projectFrom(`
    async function f(stripe, id) {
      const subscription = await stripe.subscriptions.retrieve(id);
      const { current_period_end } = subscription;
      return current_period_end;
    }
  `);

  assert.strictEqual(codemod.find(project).length, 0, 'ObjectBindingPattern is out of scope by design');
});

// ── AC2: a reassigned binding stops tracking ────────────────────────────────

test('AC2: a read after the binding is reassigned to a non-subscription source is not matched', () => {
  // Before the fix, `binding.findReferencesAsNodes()` treated every reference
  // to `sub` identically, including the one AFTER it stopped holding a
  // Subscription — this read would have been (wrongly) rewritten to
  // `sub.items.data[0].current_period_end`.
  const { project } = projectFrom(`
    async function f(stripe, a, b) {
      let sub = await stripe.subscriptions.retrieve(a);
      sub = await stripe.invoices.retrieve(b);
      return sub.current_period_end;
    }
  `);

  assert.strictEqual(
    codemod.find(project).length,
    0,
    'a reassignment to a non-subscriptions call must cut tracking off for every read that follows it',
  );

  const migrated = migrate(`
    async function f(stripe, a, b) {
      let sub = await stripe.subscriptions.retrieve(a);
      sub = await stripe.invoices.retrieve(b);
      return sub.current_period_end;
    }
  `);
  assert.match(migrated, /return sub\.current_period_end;/, 'the read after reassignment must be left untouched');
});

test('AC2: reads before the reassignment still match; only reads after it are cut off', () => {
  const { project } = projectFrom(`
    async function f(stripe, a, b) {
      let sub = await stripe.subscriptions.retrieve(a);
      const before = sub.current_period_end;
      sub = await stripe.invoices.retrieve(b);
      const after = sub.current_period_end;
      return { before, after };
    }
  `);

  assert.strictEqual(codemod.find(project).length, 1, 'only the read before reassignment is in scope');

  const migrated = migrate(`
    async function f(stripe, a, b) {
      let sub = await stripe.subscriptions.retrieve(a);
      const before = sub.current_period_end;
      sub = await stripe.invoices.retrieve(b);
      const after = sub.current_period_end;
      return { before, after };
    }
  `);
  assert.match(migrated, /const before = sub\.items\.data\[0\]\.current_period_end;/);
  assert.match(migrated, /const after = sub\.current_period_end;/, 'the post-reassignment read stays untouched');
});

test('AC2 (bonus): a reassignment to ANOTHER subscriptions call keeps tracking going', () => {
  const { project } = projectFrom(`
    async function f(stripe, a, c) {
      let sub = await stripe.subscriptions.retrieve(a);
      sub = await stripe.subscriptions.retrieve(c);
      return sub.current_period_end;
    }
  `);

  assert.strictEqual(
    codemod.find(project).length,
    1,
    'a reassignment to another subscriptions-returning call must not cut tracking off',
  );
});

// ── AC3: the receiver's root must not be provably some other, concrete thing ──

test('AC3 SAFETY: db.subscriptions.retrieve(id) does not match when `db` resolves to a different require', () => {
  const { project } = projectFrom(`
    const db = require('./db-client');
    async function f(id) {
      const subscription = await db.subscriptions.retrieve(id);
      return subscription.current_period_end;
    }
  `);

  assert.strictEqual(
    codemod.find(project).length,
    0,
    'a root that resolves to a concrete, non-vendor require() must never match',
  );
});

test('AC3: a plain parameter root (dependency injection, as used by fixtures/acme-payments) still matches', () => {
  // The real-world/legacy shape: `stripe` is passed in, not required/imported
  // in this file. AC3 must not regress this — only a root PROVABLY bound to
  // something else is rejected, not merely an unresolvable one.
  const { project } = projectFrom(LEGACY);
  assert.strictEqual(codemod.find(project).length, 2, 'a plain parameter root is tolerated, not rejected');
});

test('AC3: matches through `const stripeClient = new Stripe(k)` (a resolvable, legitimate root)', () => {
  const { project } = projectFrom(`
    import Stripe from 'stripe';
    const stripeClient = new Stripe('sk_test');
    async function f(id) {
      const subscription = await stripeClient.subscriptions.retrieve(id);
      return subscription.current_period_end;
    }
  `);

  assert.strictEqual(codemod.find(project).length, 1);
});

// ── Non-collision with codemod #1 ──────────────────────────────────────────

test('the two codemods do not collide on the fixture', () => {
  const project = loadProject(fixture);

  const periodMatches = codemod.find(project);
  const chargeMatches = stripeChargesToIntents.find(project);

  assert.strictEqual(periodMatches.length, 2, 'both period reads in src/billing.js');
  assert.strictEqual(chargeMatches.length, 1, 'the single charges.create in src/checkout.js');

  const periodFiles = new Set(periodMatches.map((m) => path.relative(fixture, m.filePath)));
  const chargeFiles = new Set(chargeMatches.map((m) => path.relative(fixture, m.filePath)));
  assert.deepStrictEqual([...periodFiles], [path.join('src', 'billing.js')]);
  assert.deepStrictEqual([...chargeFiles], [path.join('src', 'checkout.js')]);

  // lib/stripe-mock.js *defines* subscriptions.retrieve but never calls it,
  // so it must not produce a spurious match.
  assert.ok(
    project.getSourceFiles().some((f) => f.getFilePath().endsWith(path.join('lib', 'stripe-mock.js'))),
    'the mock is in the matcher glob — this assertion guards the one above',
  );
});

// ── AC6 + AC7: end to end, tier 1, two independent results ─────────────────

test('end to end: the fixture yields two independent, verified, non-draft results without an API key', async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const out = outDir();

  try {
    // No `llm` passed: tier 1 only. Anything needing the agent would be skipped.
    const results = await run(fixture, { outputDir: out });

    const charges = results.find((r) => r.change.id === 'stripe-charges-create-to-payment-intents');
    const periods = results.find((r) => r.change.id === 'stripe-subscription-current-period-to-items');
    assert.ok(charges && periods, 'both registered changes must run');

    for (const r of [charges!, periods!]) {
      assert.strictEqual(r.applied, true, `${r.change.id}: a fix must be applied`);
      assert.strictEqual(r.method, 'deterministic', `${r.change.id}: tier 1, no model`);
      assert.strictEqual(r.verify?.passed, true, `${r.change.id}: the fixture suite must stay green`);
      assert.strictEqual(r.draft, false, `${r.change.id}: a green suite opens a real PR`);
      assert.strictEqual(r.branch, `apidrift/${r.change.id}`);
      assert.ok(fs.existsSync(r.prPath!), `${r.change.id}: its PR body must exist`);
      assert.ok(fs.existsSync(r.patchPath!), `${r.change.id}: its patch must exist`);
      assert.ok(fs.readFileSync(r.patchPath!, 'utf8').trim().length > 0, `${r.change.id}: non-empty patch`);
    }

    // Independence: distinct branches, distinct artifacts, no overwriting.
    assert.notStrictEqual(charges!.branch, periods!.branch);
    assert.notStrictEqual(charges!.prPath, periods!.prPath);
    assert.notStrictEqual(charges!.patchPath, periods!.patchPath);

    const periodsBody = fs.readFileSync(periods!.prPath!, 'utf8');
    assert.match(periodsBody, /multi-item/i, 'the medium-confidence caveat must reach the PR body');
    const chargesBody = fs.readFileSync(charges!.prPath!, 'utf8');
    assert.match(chargesBody, /paymentIntents/, "each PR body must describe its own change");

    // Each result's patch only touches its own source file: the workspaces are
    // independent copies, not a shared, cumulative one.
    assert.match(fs.readFileSync(periods!.patchPath!, 'utf8'), /src\/billing\.js/);
    assert.doesNotMatch(fs.readFileSync(periods!.patchPath!, 'utf8'), /paymentIntents/);
  } finally {
    if (previousKey !== undefined) process.env.ANTHROPIC_API_KEY = previousKey;
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('the fixer never edits the fixture tests', async () => {
  const out = outDir();
  try {
    const results = await run(fixture, { outputDir: out });
    for (const r of results) {
      if (!r.patchPath) continue;
      const patch = fs.readFileSync(r.patchPath, 'utf8');
      assert.doesNotMatch(patch, /^\+\+\+ b\/test\//m, `${r.change.id}: tests are read-only to the fixer`);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
