import { Node, SyntaxKind } from 'ts-morph';
import type { Project } from 'ts-morph';
import type { Change, Codemod, Match } from '../types.js';

/**
 * Stripe deprecated the Charges API in favor of PaymentIntents.
 *
 *   stripe.charges.create({ amount, currency, source })
 *      ->
 *   stripe.paymentIntents.create({
 *     amount, currency, payment_method, confirm: true,
 *     automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
 *   })
 *
 * Why `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }`:
 * the Stripe OpenAPI spec (stripe/openapi, spec3.json, API version
 * 2026-08-26.dahlia) only marks `amount`/`currency` as `required` for
 * `POST /v1/payment_intents` — it does not model that `return_url` is
 * *conditionally* required when `confirm: true` resolves to a redirect-based
 * payment method. Stripe's API reference for `automatic_payment_methods`
 * (https://docs.stripe.com/api/payment_intents/create, fetched 2026-08-30)
 * spells out the condition directly: with `allow_redirects: "always"`
 * (the default once automatic payment methods are enabled) "`return_url` may
 * be required to confirm this PaymentIntent"; with `allow_redirects: "never"`
 * "this PaymentIntent will not accept redirect-based payment methods ...
 * `return_url` will not be required to confirm this PaymentIntent". Setting
 * `allow_redirects: 'never'` reproduces the old Charges API's semantics (a
 * single non-redirect attempt) without requiring a `return_url` the old call
 * never had a place for.
 *
 * In the MVP this Change is hardcoded. In production it would be emitted by the
 * upstream diff engine (oasdiff / SDK release / changelog) into this same shape.
 */
const change: Change = {
  id: 'stripe-charges-create-to-payment-intents',
  vendor: 'stripe',
  source: 'changelog',
  kind: 'deprecation',
  title: 'Migrate deprecated Charges.create to PaymentIntents.create',
  target: { type: 'symbol', symbol: 'stripe.charges.create' },
  migration: {
    op: 'replaced_by',
    detail:
      'stripe.paymentIntents.create; param `source` -> `payment_method`; add `confirm: true` and ' +
      "`automatic_payment_methods: { enabled: true, allow_redirects: 'never' }` (avoids the " +
      'conditional `return_url` requirement for redirect-based payment methods)',
  },
  references: [
    'https://docs.stripe.com/payments/payment-intents/migration',
    'https://docs.stripe.com/api/payment_intents/create',
  ],
  confidence: 'high',
};

/**
 * Matches call expressions shaped like `<obj>.charges.create(...)`.
 * AST-based: resolves the property-access chain instead of grepping text,
 * so it ignores comments, strings, and unrelated `.create(` calls.
 */
function find(project: Project): Match[] {
  const matches: Match[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;

      const callee = node.getExpression(); // e.g. stripe.charges.create
      if (!Node.isPropertyAccessExpression(callee)) return;
      if (callee.getName() !== 'create') return;

      const receiver = callee.getExpression(); // e.g. stripe.charges
      if (!Node.isPropertyAccessExpression(receiver)) return;
      if (receiver.getName() !== 'charges') return;

      const { line } = sourceFile.getLineAndColumnAtPos(node.getStart());
      matches.push({
        filePath: sourceFile.getFilePath(),
        line,
        snippet: node.getText().split('\n')[0].trim(),
        node,
      });
    });
  }

  return matches;
}

/**
 * Rewrites a matched call in place:
 *   1. charges          -> paymentIntents
 *   2. source: <x>      -> payment_method: <x>
 *   3. add confirm: true (if absent)
 *   4. add automatic_payment_methods: { enabled: true, allow_redirects: 'never' }
 *      (if absent) — see the comment on `change` above for why this is
 *      required, not cosmetic: without it, `confirm: true` can conditionally
 *      require a `return_url` the old Charges API call never had.
 */
function apply(match: Match): void {
  // `Match.node` is a generic `Node` (a codemod may match something other than
  // a call — see src/types.ts), so narrow before using the call-only API.
  if (!Node.isCallExpression(match.node)) return;
  const call = match.node;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return;
  const receiver = callee.getExpression();
  if (!Node.isPropertyAccessExpression(receiver)) return;

  // 1. charges -> paymentIntents
  receiver.getNameNode().replaceWithText('paymentIntents');

  // 2 + 3 + 4. adjust the argument object literal, if present.
  const [arg] = call.getArguments();
  if (arg && Node.isObjectLiteralExpression(arg)) {
    const sourceProp = arg.getProperty('source');
    if (sourceProp && sourceProp.getKind() === SyntaxKind.PropertyAssignment) {
      // rename the key `source` -> `payment_method`, keep its value
      const nameNode = sourceProp.getFirstChild();
      if (nameNode) nameNode.replaceWithText('payment_method');
    }

    if (!arg.getProperty('confirm')) {
      arg.addPropertyAssignment({ name: 'confirm', initializer: 'true' });
    }

    if (!arg.getProperty('automatic_payment_methods')) {
      arg.addPropertyAssignment({
        name: 'automatic_payment_methods',
        initializer: "{ enabled: true, allow_redirects: 'never' }",
      });
    }
  }
}

export const stripeChargesToIntents: Codemod = { change, find, apply };
