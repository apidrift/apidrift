# US-6 proof #2: real OSS repo, 1st Stripe change (`charges.create` -> `paymentIntents.create`) — the moat catches a real regression

## Target repo
- **URL:** https://github.com/feross/studynotes.org
- **Branch:** `master` (default branch)
- **HEAD SHA at clone time:** `7556fd62512213dc227d00674ed146a57a792be5` (2022-06-13, cloned
  2026-09-01)
- **License:** none detected by GitHub (`NOASSERTION`) — source is public on GitHub under a
  well-known maintainer's account (feross, of `standard`/WebTorrent/etc.); flagged explicitly since
  US-1's repo (`hackathon-starter`) was MIT. See "PR upstream vs internal proof" below.
- **Stars:** ~162
- **Distinct from US-1 and from the sibling repo in this US:** neither `sahat/hackathon-starter`
  nor `agnaistic/agnai`; exercises the **1st** Stripe change (same codemod as US-1) on a
  **second, independent** real repo, per this US's "acceptable fallback" clause (no exploitable
  2nd-change-or-`--detect` candidate was found with a green baseline that didn't need heavy
  infrastructure — see "Candidates considered and not pursued" in the top-level US-6 report).

## Why this candidate
`routes/order.js` has `stripe.charges.create({ amount, currency, source, description,
receipt_email }, cb)` — a direct, callback-style call (the codemod's `apply()` only inspects the
first argument, an object literal, so callback- vs. promise-style is irrelevant to it). The `test`
script (`standard && tape test/*.js`) only runs `tape` against `test/util.js`, a small
dependency-free utility test file that never imports `routes/order.js` — so the baseline is green
without a database, without network, and without mocking Stripe.

## Baseline (before any fix)
Command: `npm install && npm test` in the clone.
Result: **9/9 tape assertions passing**, `standard` lint clean, exit code 0 (see
`baseline-test-output.txt`).

## Coverage of the modified file
`test/util.js` never touches `routes/order.js` — same "suite stays green but doesn't exercise the
changed code" caveat as US-1's `hackathon-starter` and this US's `agnai` proof. Here it matters
less than usual, because what actually turns the suite red post-fix is **not** a behavioral test
of the Stripe call — it's the `standard` **linter**, which `npm test` runs first, over the *whole*
repo, and which does inspect the changed file's formatting.

## Run against the real repo
```
npx tsx src/cli.ts run /tmp/us6-target/studynotes.org --deterministic-only --out /tmp/us6-out-studynotes
```
- **Match:** `routes/order.js:19` — `stripe.charges.create({`
- **Patch:** `fix.patch` — `charges` -> `paymentIntents`, `source` -> `payment_method`,
  `confirm: true` and `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }`
  added, exactly per the codemod's documented rule (same as US-1/US-4).
- **Tests after fix:** re-applied `fix.patch` to a fresh copy, reran `npm test` —
  **`standard` fails with 6 lint errors, `tape` never runs** (`post-fix-verify-output.txt`):
  ```
  standard: Use JavaScript Standard Style (https://standardjs.com)
    routes/order.js:9:26: Missing space before function parentheses.
    routes/order.js:10:30: Missing space before function parentheses.
    routes/order.js:18:29: Missing space before function parentheses.
    routes/order.js:30:39: Missing space before function parentheses.
    routes/order.js:40:28: Missing space before function parentheses.
    routes/order.js:45:16: Missing space before function parentheses.
  ```
- **draft:** `true` — apidrift correctly refused to open a non-draft PR on a red suite (`PR.md`
  says "⚠️ Tests did not pass — opened as a draft for a human to finish").

## Root cause — a real, generalizable "blast radius" bug, found but *not* fixed here
None of the 6 flagged lines are anywhere near the one call site the codemod actually rewrote
(`stripe.charges.create` at line 19). Diffing `fix.patch` shows **every** `function (arg)` in the
whole file lost its space (`function (req, res, next)` -> `function(req, res, next)`), including
ones in code the codemod never touched (`order.save(function (err, order) {`, the outer
`}, function (err, r) {` callback, etc.).

Root cause, traced to `src/fixer/index.ts`:
```ts
for (const filePath of touched) {
  const sf = project.getSourceFile(filePath);
  if (sf) sf.formatText({ indentSize: 2, convertTabsToSpaces: true });
}
```
`Project#formatText()` (ts-morph, wrapping the TS language service's
`getFormattingEditsForDocument`) reformats the **entire file**, not just the AST range the
codemod actually edited, and only `indentSize`/`convertTabsToSpaces` are overridden — every other
`FormatCodeSettings` field (including
`insertSpaceAfterFunctionKeywordForAnonymousFunctions`, which TypeScript defaults to `false`)
falls back to the compiler default. `studynotes.org`'s existing style (and `standard`'s rule) is
the opposite: a space *is* required before the parenthesis. The result: a one-call-site fix
collaterally rewrites unrelated, untouched lines to not match the repo's own style, and on a repo
whose `npm test` starts with a linter, that collateral damage — not the actual fix — is what
turns the suite red.

**Verified as the actual root cause**, not just plausible: reproduced independently by re-running
`git apply fix.patch` and `npm test` twice, and by inspecting `fix.patch` for `agnai` (this US's
sibling repo), where the same `formatText()` call produced the same style of collateral edit
(`.catch(() => {})` -> `.catch(() => { })`) — harmless there only because that repo's lint isn't
part of `npm test`.

**Why not fixed in this US:** this is squarely a case of "found a genuinely generalizable bug",
but the *correct* fix is a design decision, not a mechanical correction — the two options are
(a) stop calling whole-file `formatText()` and instead format only the AST range each codemod
actually edited (safer, but ts-morph's public API doesn't expose range-scoped formatting as
directly), or (b) pass a fuller `FormatCodeSettings` that better matches common style guides,
which just trades one arbitrary default for another and cannot actually detect a target repo's
real style. `src/fixer/index.ts` is shared by every codemod and is exercised by most of the
existing test suite's fixture-based assertions; changing its formatting behavior without a
dedicated design pass risks regressing those in ways this proof-focused US is not scoped to
validate. Recorded here as a candidate follow-up US for the architect/PO (same recommendation
made in the sibling `agnai` README).

## PR upstream vs. internal proof — human decision, not made here
Per this US's constraints, no PR/fork/push was made against `feross/studynotes.org`. Two things
for the human to weigh here, beyond US-1's original question:
1. **No license was detected** on this repo (`NOASSERTION`) — unlike US-1's MIT-licensed target,
   which is a stronger argument for internal-proof-only regardless of the technical outcome below.
2. **The fix as generated is currently a draft**, not a mergeable PR — a human would need to
   either accept the collateral formatting diff (and probably run `standard --fix` before
   merging) or wait for the `formatText()` finding above to be addressed, before this could ever
   be a real upstream PR.

## DoD
- `npx tsc --noEmit` (apidrift itself): clean.
- `npm test` (apidrift's own suite): unchanged pass count from before this US — no `src/`,
  `tests/`, or `fixtures/` files were modified (the `formatText()` finding above is recorded, not
  patched — see rationale above).
