import { Node } from 'ts-morph';
import type { Identifier, Project } from 'ts-morph';
import type { Change, Codemod, Match } from '../types.js';

/**
 * Stripe moved a Subscription's billing period onto its items.
 *
 *   sub.current_period_end   ->   sub.items.data[0].current_period_end
 *
 * Vendor rule, quoted from the changelog entry — "Adds subscription item-level
 * billing periods and removes subscription-level periods", API version
 * `2025-03-31.basil` (fetched 2026-09-01,
 * https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md):
 *
 *   "Why is this a breaking change? — `current_period_start` and
 *    `current_period_end` fields are no longer available on the subscription
 *    resource."
 *
 *   "Impact — Update any code that references subscription-level
 *    `current_period_end` and `current_period_start` fields. Instead, access
 *    the subscription item's billing periods directly using
 *    `items.data.current_period_end` and `items.data.current_period_start`
 *    fields."
 *
 * Its REST API table lists both fields as `Removed` on `Subscription` and
 * `Added` on `SubscriptionItem`. The replacement is documented on the
 * Subscription Item object
 * (https://docs.stripe.com/api/subscription_items/object?api-version=2025-03-31.basil#subscription_item_object-current_period_end,
 * fetched 2026-09-01): "`current_period_end` (timestamp) — The end time of
 * this subscription item's current billing period."
 *
 * ## Confidence: medium — read this before merging
 * Stripe writes the replacement path as `items.data.current_period_end`, with
 * no index: the field is per-item. `items.data[0]` is exact for a
 * **single-item** subscription (the dominant case, and the only one where the
 * removed Subscription-level field had an unambiguous meaning). On a
 * **multi-item** subscription each item now carries its *own* period, so
 * picking `data[0]` is deterministic but arbitrary: a human must confirm which
 * item's period the call site meant. This caveat is carried in
 * `migration.detail`, so it lands in the PR body.
 *
 * ## Why this change (and not another second codemod)
 * It is structurally unlike `stripe-charges-create-to-payment-intents` on
 * three axes, which is the point — see the AC8 observation at the bottom of
 * this file:
 *   1. the rewritten node is a `PropertyAccessExpression` on the *result* of a
 *      call, not the `CallExpression` itself;
 *   2. the rewrite *lengthens* the access chain (it inserts an
 *      `ElementAccessExpression`, `data[0]`) instead of renaming a segment;
 *   3. `find()` has to follow a data flow (call -> binding -> references)
 *      instead of recognizing a local shape.
 *
 * In the MVP this Change is hardcoded. In production it would be emitted by
 * the upstream diff engine into this same shape.
 */
const change: Change = {
  id: 'stripe-subscription-current-period-to-items',
  vendor: 'stripe',
  source: 'changelog',
  kind: 'breaking',
  title: 'Read subscription billing periods off subscription items (Basil 2025-03-31)',
  // NOTE: `symbol` names the ANCHOR — the call that produces the value — not
  // the node this codemod rewrites (a property read on that value). The Change
  // model has no way to express "property P of the object returned by call S";
  // see the AC8 observation at the bottom of this file.
  target: { type: 'symbol', symbol: 'stripe.subscriptions.retrieve' },
  migration: {
    // No value of the `migration.op` enum describes moving a field of a
    // *response*; every value is request-shaped. `param_move` is the least
    // wrong. Deliberately NOT extending the enum on a sample of two — the gap
    // is recorded in the AC8 observation instead.
    op: 'param_move',
    detail:
      '`current_period_start` / `current_period_end` were removed from the Subscription resource and ' +
      'added to Subscription Item; read them as `subscription.items.data[0].current_period_*`. ' +
      'Confidence medium: `items.data[0]` is exact for single-item subscriptions; a multi-item ' +
      'subscription has one period PER item, so a human should confirm which item is meant.',
  },
  references: [
    'https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md (fetched 2026-09-01) — breaking, API version 2025-03-31.basil',
    'https://docs.stripe.com/api/subscription_items/object?api-version=2025-03-31.basil#subscription_item_object-current_period_end (fetched 2026-09-01)',
    'https://github.com/stripe/stripe-node/releases/tag/v18.0.0 (matching Node SDK release, cited by the changelog entry)',
  ],
  confidence: 'medium',
};

/** The two fields the vendor moved off Subscription onto Subscription Item. */
const MOVED_FIELDS = ['current_period_start', 'current_period_end'];

/**
 * Methods on `<x>.subscriptions` that return a Subscription object — i.e. the
 * calls whose result used to carry the removed fields.
 */
const SUBSCRIPTION_RETURNING_METHODS = ['retrieve', 'create', 'update'];

/**
 * Returns the identifier a `<x>.subscriptions.<method>(...)` call is bound to,
 * or undefined if the result isn't bound to a plain `const`/`let` name.
 *
 * Handles the two shapes we can follow deterministically:
 *   const sub = await stripe.subscriptions.retrieve(id);   // AwaitExpression
 *   const sub = stripe.subscriptions.retrieve(id);         // direct
 *
 * NOT handled, on purpose: `const { current_period_end } = sub` and friends
 * (`SyntaxKind.ObjectBindingPattern`). Rewriting a destructured read means
 * synthesizing a new binding, which is a different (and riskier) transform —
 * out of scope here, covered by a non-match test, left to the tier-2 agent.
 */
function bindingIdentifierOf(call: Node): Identifier | undefined {
  const parent = call.getParent();
  const anchor = parent && Node.isAwaitExpression(parent) ? parent : call;

  const declaration = anchor.getParent();
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;

  const nameNode = declaration.getNameNode();
  if (!Node.isIdentifier(nameNode)) return undefined; // e.g. ObjectBindingPattern
  return nameNode;
}

/**
 * Matches reads of `current_period_start` / `current_period_end` on a value
 * that provably came from a `<x>.subscriptions.<retrieve|create|update>(...)`
 * call.
 *
 * 100% AST (ts-morph), no regex and no test against source text — which is why
 * the same characters inside a comment or a string literal never match, and
 * why `invoice.current_period_end` (not anchored on a subscriptions call)
 * doesn't either. References are resolved through the language service
 * (`findReferencesAsNodes`), so no type declarations / `node_modules` are
 * required.
 */
function find(project: Project): Match[] {
  const matches: Match[] = [];
  const seen = new Set<string>();

  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;

      const callee = node.getExpression(); // e.g. stripe.subscriptions.retrieve
      if (!Node.isPropertyAccessExpression(callee)) return;
      if (!SUBSCRIPTION_RETURNING_METHODS.includes(callee.getName())) return;

      const receiver = callee.getExpression(); // e.g. stripe.subscriptions
      if (!Node.isPropertyAccessExpression(receiver)) return;
      if (receiver.getName() !== 'subscriptions') return;

      const binding = bindingIdentifierOf(node);
      if (!binding) return;

      for (const reference of binding.findReferencesAsNodes()) {
        const access = reference.getParent();
        if (!access || !Node.isPropertyAccessExpression(access)) continue;
        // The reference must be the RECEIVER of the access (`sub.x`), not the
        // property name of someone else's access (`other.sub`).
        if (access.getExpression() !== reference) continue;
        if (!MOVED_FIELDS.includes(access.getName())) continue;

        const refFile = access.getSourceFile();
        const key = `${refFile.getFilePath()}:${access.getStart()}`;
        if (seen.has(key)) continue; // two anchoring calls can reach the same read
        seen.add(key);

        const { line } = refFile.getLineAndColumnAtPos(access.getStart());
        matches.push({
          filePath: refFile.getFilePath(),
          line,
          snippet: access.getText().split('\n')[0].trim(),
          node: access,
        });
      }
    });
  }

  return matches;
}

/**
 * Rewrites one matched read in place:
 *   sub.current_period_end -> sub.items.data[0].current_period_end
 *
 * Only the receiver is rewritten; the property name is untouched (the vendor
 * kept both field names, it only moved them onto the item).
 */
function apply(match: Match): void {
  // `applyFix()` applies matches in sequence, and each `replaceWithText`
  // re-parses the file. This is the first codemod that can match the same file
  // twice (both moved fields are usually read side by side), so a node found
  // before an earlier rewrite could already be gone. ts-morph re-binds
  // surviving nodes, but the guard makes that dependency explicit instead of
  // relying on it — never mutate a forgotten node.
  if (match.node.wasForgotten()) return;
  if (!Node.isPropertyAccessExpression(match.node)) return;

  const receiver = match.node.getExpression(); // e.g. `subscription`
  receiver.replaceWithText(`${receiver.getText()}.items.data[0]`);
}

export const stripeSubscriptionPeriodToItems: Codemod = { change, find, apply };

/*
 * ── AC8 — observation after codemod #2 (factual input for US-2) ────────────
 * Derivable from the `Change` data (mechanically identical in both codemods):
 *  - the last two segments of `target.symbol` ("charges"/"create",
 *    "subscriptions"/"retrieve"): both find()s open on the SAME 6-line walk
 *    (isCallExpression; callee + receiver isPropertyAccessExpression/getName).
 *  - all reporting: filePath/line/snippet, branch name, PR body.
 * Hand-written, NOT derivable:
 *  - where the edit lands. #1 rewrites the matched CallExpression; #2 rewrites
 *    a PropertyAccessExpression on the call's RESULT — ~25 further lines of
 *    call -> AwaitExpression -> VariableDeclaration -> findReferencesAsNodes,
 *    plus receiver-vs-name, dedup and wasForgotten guards. `target.symbol` is
 *    one dotted string for one node; it cannot say "property P of the object
 *    returned by S", so here it names the anchor, not the rewritten node.
 *  - the transform. #1 renames a segment and adds object keys; #2 lengthens
 *    the chain with an ElementAccessExpression. `migration.op` is request-
 *    shaped — no value describes moving a RESPONSE field, so 'param_move' is
 *    a label, not an instruction.
 *  - the prose-only constants: `automatic_payment_methods` (#1), `[0]` and its
 *    multi-item caveat (#2).
 * Conclusion: a `target.symbol`-driven generic find() is feasible only where
 * the symbol IS the edited node (#1). #2 first needs two new Change fields —
 * an anchor/target split and a response-side op. apply() stays hand-written.
 */
