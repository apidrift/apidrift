import { Node, SyntaxKind } from 'ts-morph';
import type { Project } from 'ts-morph';
import type { Change, Codemod, Match } from '../types.js';

/**
 * Stripe deprecated the Charges API in favor of PaymentIntents.
 *
 *   stripe.charges.create({ amount, currency, source })
 *      ->
 *   stripe.paymentIntents.create({ amount, currency, payment_method, confirm: true })
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
    detail: 'stripe.paymentIntents.create; param `source` -> `payment_method`; add `confirm: true`',
  },
  references: ['https://docs.stripe.com/payments/payment-intents/migration'],
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
 */
function apply(match: Match): void {
  const call = match.node;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return;
  const receiver = callee.getExpression();
  if (!Node.isPropertyAccessExpression(receiver)) return;

  // 1. charges -> paymentIntents
  receiver.getNameNode().replaceWithText('paymentIntents');

  // 2 + 3. adjust the argument object literal, if present.
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
  }
}

export const stripeChargesToIntents: Codemod = { change, find, apply };
