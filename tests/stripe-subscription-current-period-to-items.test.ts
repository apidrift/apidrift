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
