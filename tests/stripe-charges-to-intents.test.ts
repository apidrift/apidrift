import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, Node, SyntaxKind } from 'ts-morph';
import { stripeChargesToIntents } from '../src/changes/stripe-charges-to-intents.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vendorized extract of Stripe's public OpenAPI spec for
 * `POST /v1/payment_intents`, plus a couple of documented facts that the
 * OpenAPI schema itself does not model (see `notes` in the fixture).
 *
 * Source (fetched 2026-08-30):
 *   https://github.com/stripe/openapi @ 976606f9d8ce1285e922cf9183bbd135222ec901
 *   raw file: openapi/spec3.json
 *   API version in that spec: 2026-08-26.dahlia
 *   Docs excerpt (automatic_payment_methods.allow_redirects):
 *   https://docs.stripe.com/api/payment_intents/create
 *
 * We vendor a ~4KB extract instead of the full multi-MB spec so this test
 * runs offline and deterministically — no network access, no Stripe key.
 */
const specExtractPath = path.join(here, '..', 'fixtures', 'stripe-spec', 'payment_intents_create.extract.json');
const spec = JSON.parse(fs.readFileSync(specExtractPath, 'utf8')) as {
  required: string[];
  properties: Record<string, unknown>;
  notes: Record<string, string>;
};

/**
 * A mock of the Stripe `POST /v1/payment_intents` HTTP endpoint.
 *
 * No real network call is made anywhere in this file. This function stands
 * in for what the real API does, encoding exactly the two documented rules
 * we're testing against:
 *
 *  1. `amount` and `currency` are required (per the OpenAPI schema's
 *     `required` array — `spec.required` below, not hardcoded here).
 *  2. When `confirm: true` resolves to a payment intent that *would* accept
 *     redirect-based payment methods (i.e. `automatic_payment_methods` is
 *     absent, or present with `allow_redirects` other than `'never'`),
 *     `return_url` is conditionally required to confirm — per
 *     docs.stripe.com/api/payment_intents/create's description of
 *     `automatic_payment_methods.allow_redirects`. If `allow_redirects` is
 *     `'never'`, `return_url` is documented as NOT required.
 *
 * Throws (like a Stripe 400) when a request would be rejected; otherwise
 * returns a fake successful PaymentIntent.
 */
function mockCreatePaymentIntent(body: Record<string, unknown>): { id: string; status: string } {
  for (const field of spec.required) {
    if (body[field] === undefined) {
      throw new Error(`Stripe mock: missing required parameter \`${field}\``);
    }
  }

  if (body.confirm === true) {
    const apm = body.automatic_payment_methods as { allow_redirects?: string } | undefined;
    const redirectsFiltered = apm?.allow_redirects === 'never';
    if (!redirectsFiltered && !body.return_url) {
      throw new Error(
        'Stripe mock: return_url may be required to confirm this PaymentIntent when redirect-based ' +
          "payment methods are not filtered out (set automatic_payment_methods.allow_redirects to 'never', " +
          'or provide return_url)',
      );
    }
  }

  return { id: 'pi_mock_123', status: 'succeeded' };
}

/** Runs the real codemod (find + apply) against a small synthetic source file. */
function runCodemod(sourceText: string): string {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('checkout.js', sourceText);
  const matches = stripeChargesToIntents.find(project);
  assert.strictEqual(matches.length, 1, 'expected exactly one charges.create match');
  stripeChargesToIntents.apply!(matches[0]);
  return sourceFile.getFullText();
}

const oldSource = `
async function chargeCustomer(stripe, { amountCents, token }) {
  const charge = await stripe.charges.create({
    amount: amountCents,
    currency: 'usd',
    source: token,
  });
  return charge;
}
`;

/**
 * Converts an object-literal AST node into a plain JS value, AST-based (no
 * `eval`/`Function`): string/boolean/number literals become their value,
 * identifiers (e.g. a variable used as a param value, like `token` above)
 * become their source text — we only need presence/shape here, not the
 * actual runtime value of a variable that doesn't exist in this scope.
 */
function objectLiteralToPlain(node: Node): unknown {
  if (Node.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const prop of node.getProperties()) {
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
      const assignment = prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
      out[assignment.getName()] = objectLiteralToPlain(assignment.getInitializerOrThrow());
    }
    return out;
  }
  if (Node.isStringLiteral(node)) return node.getLiteralValue();
  if (Node.isNumericLiteral(node)) return node.getLiteralValue();
  if (node.getKind() === SyntaxKind.TrueKeyword) return true;
  if (node.getKind() === SyntaxKind.FalseKeyword) return false;
  // Identifier or anything else: keep its source text as a stand-in value.
  return node.getText();
}

/** Parses the migrated call's argument object literal into a plain JS object. */
function extractCreateArgs(migratedSource: string): Record<string, unknown> {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('out.js', migratedSource);
  const call = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((c) => c.getExpression().getText() === 'stripe.paymentIntents.create');
  assert.ok(call, 'expected a stripe.paymentIntents.create call in the migrated source');
  const [arg] = call!.getArguments();
  assert.ok(arg && Node.isObjectLiteralExpression(arg), 'expected an object literal argument');
  return objectLiteralToPlain(arg!) as Record<string, unknown>;
}

test('codemod output: request body satisfies Stripe\'s documented required/conditional fields', () => {
  const migrated = runCodemod(oldSource);
  const body = extractCreateArgs(migrated);

  // Required per the OpenAPI schema (spec.required, vendorized from stripe/openapi).
  assert.strictEqual(body.amount, 'amountCents', 'amount must survive the migration'); // identifier text
  assert.ok('currency' in body, 'currency must survive the migration');

  // Fields the codemod is responsible for adding — a regression dropping any
  // of these must fail this test.
  assert.strictEqual(body.confirm, true, 'codemod must set confirm: true');
  assert.strictEqual(body.payment_method, 'token', 'codemod must rename source -> payment_method');
  assert.deepStrictEqual(
    body.automatic_payment_methods,
    { enabled: true, allow_redirects: 'never' },
    'codemod must add automatic_payment_methods: { enabled: true, allow_redirects: "never" } so that ' +
      'confirm: true does not conditionally require a return_url (see docs.stripe.com/api/payment_intents/create)',
  );

  // Mock the HTTP call: this must NOT throw, i.e. the generated body would
  // be accepted by Stripe without a return_url.
  assert.doesNotThrow(() => mockCreatePaymentIntent(body), 'the generated request must be accepted by the mock endpoint');
});

test('mock endpoint sanity check: confirm:true without return_url is rejected unless redirects are filtered', () => {
  // Redirect-based payment methods NOT filtered, no return_url -> Stripe would reject.
  assert.throws(() =>
    mockCreatePaymentIntent({ amount: 100, currency: 'usd', confirm: true, payment_method: 'pm_1' }),
  );

  // Either filtering redirects...
  assert.doesNotThrow(() =>
    mockCreatePaymentIntent({
      amount: 100,
      currency: 'usd',
      confirm: true,
      payment_method: 'pm_1',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    }),
  );

  // ...or supplying a return_url both satisfy the documented rule.
  assert.doesNotThrow(() =>
    mockCreatePaymentIntent({
      amount: 100,
      currency: 'usd',
      confirm: true,
      payment_method: 'pm_1',
      return_url: 'https://example.com/return',
    }),
  );
});

// ── AC3: the receiver's root must not be provably some other, concrete thing ──

test('AC3 SAFETY: db.charges.create(...) does not match when `db` resolves to a different require', () => {
  // `allowJs` is required here: without it ts-morph's language service does
  // not bind symbols in a plain `.js` file, and `db`'s declaration/initializer
  // (needed to resolve the root) would be unavailable.
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
  project.createSourceFile(
    'db.js',
    `
      const db = require('./db-client');
      async function chargeCustomer(payload) {
        return db.charges.create(payload);
      }
    `,
  );

  assert.strictEqual(
    stripeChargesToIntents.find(project).length,
    0,
    'a root that resolves to a concrete, non-vendor require() must never match',
  );
});

test('AC3: a plain parameter root (dependency injection, as used by fixtures/acme-payments) still matches', () => {
  // The real-world/legacy shape used throughout this project's own fixtures:
  // `stripe` is passed in, not required/imported in this file. AC3 must not
  // regress this — only a root PROVABLY bound to something else is rejected.
  const matches = (() => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('checkout.js', oldSource);
    return stripeChargesToIntents.find(project);
  })();
  assert.strictEqual(matches.length, 1, 'a plain parameter root is tolerated, not rejected');
});

test('AC3: matches through `const stripeClient = new Stripe(k)` (a resolvable, legitimate root)', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(
    'checkout.ts',
    `
      import Stripe from 'stripe';
      const stripeClient = new Stripe('sk_test');
      async function chargeCustomer(payload: Record<string, unknown>) {
        return stripeClient.charges.create(payload);
      }
    `,
  );

  assert.strictEqual(stripeChargesToIntents.find(project).length, 1);
});

test('regression guard: a codemod output missing confirm, payment_method, or automatic_payment_methods fails validation', () => {
  const migrated = runCodemod(oldSource);
  const goodBody = extractCreateArgs(migrated);

  const missingConfirm = { ...goodBody };
  delete (missingConfirm as Record<string, unknown>).confirm;
  assert.notStrictEqual(missingConfirm.confirm, true, 'sanity: confirm was actually removed');

  const missingPaymentMethod = { ...goodBody };
  delete (missingPaymentMethod as Record<string, unknown>).payment_method;
  assert.strictEqual(missingPaymentMethod.payment_method, undefined, 'sanity: payment_method was actually removed');

  const missingAutomaticPaymentMethods = { ...goodBody };
  delete (missingAutomaticPaymentMethods as Record<string, unknown>).automatic_payment_methods;
  // Without automatic_payment_methods and without a return_url, the mock (per the
  // documented Stripe rule) must reject a confirm:true request.
  assert.throws(
    () => mockCreatePaymentIntent(missingAutomaticPaymentMethods),
    /return_url may be required/,
    'stripping automatic_payment_methods must make the request rejectable by the mock endpoint',
  );
});
