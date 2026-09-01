---
name: decision-evidence-before-abstraction
description: Architecture stance on APIdrift — don't widen the Change model on speculation; US-3's delivered sample #2 is the Subscription current_period_* -> items.data[0] change
metadata:
  type: project
---

Standing architectural stance for this repo: **do not widen the `Change` /
`Codemod` abstraction on speculation.** When a new change reveals that
`Change.target.symbol` or `Change.migration.op` can't express it, record the gap
as a constraint in `architecture/architecture.json` and keep going — don't
extend the enum.

**Why:** the whole point of US-3 was to produce a *second informative sample* so
that US-2's data-driven matcher (AC3: trigger the pipeline without editing the
registry) is designed from evidence rather than fitted to N=1. Extending the
model with N=2 would just move the overfitting one step later. The PO sequenced
US-3 before US-2 for exactly this reason.

**How to apply:** when scoping any change in `src/changes/`, pick the candidate
that *maximizes information about what is derivable from the `Change` data vs.
what has to be hand-written in `find()`/`apply()`* — not the one that's cheapest
to implement. Prefer candidates that break a different axis: node kind, rewrite
shape, match strategy. Log the model gaps as `constraints` on the `changes`
component so US-2 inherits them.

**Settled by PR #6 (merged US-3, 2026-09-01) — do not relitigate:** sample #2 is
the *Subscription `current_period_start`/`current_period_end` moved onto
SubscriptionItem* change (Stripe API `2025-03-31.basil`), i.e.
`sub.current_period_end` -> `sub.items.data[0].current_period_end`. Two sessions
ran in parallel on US-3; an earlier Checkout `line_items` -> `price_data`
scoping was **abandoned** by human decision and has no open US. Any note (mine
or the board's) claiming Checkout is sample #2 is from that dead branch.

Consequence, now factual: `Match.node` **was widened** from `CallExpression` to
`Node` in `src/types.ts`, because the delivered codemod rewrites a
`PropertyAccessExpression` read off the *result* of a call. Each codemod narrows
itself (`Node.isCallExpression` / `Node.isPropertyAccessExpression`) — no casts.
And `target.symbol` names only the *anchor* call, never the edited node: the
model can't say "property P of the object returned by S". That is the strongest
evidence US-2 has.

**Method that worked:** before declaring DoR on a codemod US, write a throwaway
ts-morph prototype in `/tmp` (not in the repo) that runs the real `find()`/
`apply()` shape against a synthetic source covering the non-match cases. It
turns every "should work" in the DoR into a verified claim — including
idempotence — in one shot.

Sourcing candidates: see [[reference-stripe-sourcing]].
