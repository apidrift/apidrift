# US-6 proof #1: real OSS repo, 2nd Stripe change (subscription `current_period_*`)

## Target repo
- **URL:** https://github.com/agnaistic/agnai
- **Branch:** `dev` (default branch)
- **HEAD SHA at clone time:** `fccee00f5f7628d150760c787c4be87e6b1a652c` (2026-06-13, cloned 2026-09-01)
- **License:** AGPL-3.0
- **Stars:** ~776 (an AI character-chat platform with a real hosted-billing backend)
- **Distinct from US-1:** not `sahat/hackathon-starter`; and unlike US-1, this exercises the
  **2nd Stripe change** (`stripe-subscription-current-period-to-items`, added by US-3/US-5),
  never proven on a real repo before this US.
- Clone location during the run: `/tmp/us6-target/agnai` (outside the apidrift tree, read-only —
  never pushed to, never forked, no `gh pr create` against it). The clone itself is not committed
  to this repo.

## Why this candidate
Reproducing US-1's `--deterministic-only` methodology for the subscription codemod requires a
repo with, in one file, `const x = await stripe.subscriptions.<retrieve|create|update>(...)`
followed by a read of `x.current_period_start`/`x.current_period_end` — the codemod is
intentionally file-local (no interprocedural tracking, no destructuring support; see
`src/changes/stripe-subscription-current-period-to-items.ts`). Searching GitHub code search for
this shape surfaced mostly unlicensed/untested toy SaaS boilerplates (see "Candidates considered
and not pursued" below); `agnai`'s billing module (`srv/api/billing/*.ts`) is a rare real,
licensed, tested match — with **two** independent call sites in **two** files:
- `srv/api/billing/checkout.ts`: `const subscription = await stripe.subscriptions.retrieve(...)`,
  then both `subscription.current_period_start` and `subscription.current_period_end` are read.
- `srv/api/billing/modify.ts`: `const next = await stripe.subscriptions.update(...)`, then
  `next.current_period_end` is read (exercises the `update` branch of
  `SUBSCRIPTION_RETURNING_METHODS`, not just `retrieve`).

A third occurrence, `srv/api/billing/stripe.ts`'s `resyncSubscription`, reads
`subscription.current_period_start/_end` on a value obtained from a local wrapper
(`findValidSubscription`), not a direct `stripe.subscriptions.*` call — correctly **not** matched
(no interprocedural tracking, by design). A fourth, `srv/domains/subs/cmd.ts`'s
`cmd.subscription.current_period_start`, reads off a function **parameter** — also correctly
**not** matched (no plain identifier binds `cmd.subscription` to a subscriptions call in that
file). Both non-matches were expected and confirmed by inspection before running the tool, not
discovered as regressions.

## Test suite / install
`agnai` uses `pnpm` (a `pnpm-lock.yaml`, no `package-lock.json`) and its CI
(`.github/workflows/pipeline.yml`) runs, in order: `pnpm install --frozen-lockfile`,
`pnpm run format`, `pnpm run typecheck`, `pnpm run build:server`, `pnpm run test`. `pnpm` isn't
preinstalled in this sandbox; used `npx --yes pnpm@10.6.1` (the version pinned in that workflow)
for install/build/test — apidrift's own verifier only ever runs `npm test` inside the workspace
(the install itself always happens beforehand, in the clone, exactly as US-1's `linkNodeModules`
expects), so this is consistent with how any user would run apidrift against a pnpm-managed repo.

The `test` script is `mocha --inline-diffs --exit "tests/**.spec.js"`. The `tests/*.spec.ts` files
are compiled **in place** to `tests/*.spec.js` (and `srv/**/*.ts` to `srv/**/*.js`) by
`pnpm run build:server` (`tsc -p srv.tsconfig.json`, no separate `outDir`) — these `.js`/`.js.map`
files are git-ignored build artifacts, not checked in (`git status` stays clean after building).

## Baseline (before any fix)
Commands: `npx pnpm@10.6.1 install --frozen-lockfile && npx pnpm@10.6.1 run build:server && npx pnpm@10.6.1 run test`
in the clone.
Result: **68 passing, 0 failing**, exit code 0, 144ms (see `baseline-test-output.txt`). These are
pure unit tests (prompt templating, scenario resolution, sentence trimming) — no DB, no network,
no Stripe mocking. `pnpm run typecheck` also passes clean on the unmodified repo.

## Coverage of the modified files — read before trusting "tests still pass"
None of the 68 tests import or exercise `srv/api/billing/checkout.ts` or `modify.ts` (they cover
prompt/parser/scenario logic only). Exactly the same caveat US-1 flagged for
`hackathon-starter`'s `postStripe`: the suite staying green is real, but it is not evidence the
fixed billing code behaves correctly at runtime — see the SDK-version finding below, which is a
concrete instance of that gap actually mattering.

## Run against the real repo
```
npx tsx src/cli.ts run /tmp/us6-target/agnai --deterministic-only --out /tmp/us6-out-agnai
```
- **Matches:** 6 reported — `srv/api/billing/checkout.ts:88-89`, `srv/api/billing/modify.ts:63`,
  plus the same 3 reads in the **already-compiled** `checkout.js`/`modify.js` sitting next to the
  `.ts` sources (the widened glob from US-1, `**/*.{js,ts,jsx,tsx}`, has no way to distinguish
  hand-written `.js` from a `tsc`-emitted one colocated with its `.ts`). Only the 2 `.ts` files are
  git-tracked in the workspace's baseline commit (the `.js`/`.map` build artifacts are
  git-ignored), so `host.diff()` — and therefore `fix.patch`/`PR.md`'s diff section — correctly
  contains only the `.ts` changes. **Observation, not fixed here:** `PR.md`'s prose ("Updated 6
  usages across 4 files") still counts the untracked `.js` copies, which is misleading — the real,
  shippable diff only touches 2 files / 3 fields. Filed as an open item below rather than patched,
  since distinguishing "real extra file" from "build artifact of a tracked sibling" in
  `src/pr.ts`/`buildPrBody` is a real design question, not a one-line fix.
- **Patch:** `fix.patch` — `srv/api/billing/checkout.ts` (2 fields) and
  `srv/api/billing/modify.ts` (1 field), `current_period_start`/`current_period_end` ->
  `items.data[0].current_period_start`/`current_period_end`. One unrelated one-character diff
  (`.catch(() => {})` -> `.catch(() => { })`) is collateral from the fixer's whole-file
  `sf.formatText()` pass (`src/fixer/index.ts`) — see "formatText blast radius" below.
- **PR.md:** `PR.md` — "✅ All checks passed", diff embedded.
- **Tests after fix:** re-applied `fix.patch` to a fresh copy, reran
  `pnpm run build:server && pnpm run test` — **68 passing, 0 failing**, exit code 0, 144ms
  (`post-fix-verify-output.txt`). Same pass count as baseline (same non-coverage caveat as above).
- **draft:** `false`.

## Important finding: the fix is only correct for accounts already on the Basil API version
`pnpm run build:server` (`tsc -p srv.tsconfig.json`) **fails to typecheck** after the fix
(`post-fix-typecheck-output.txt`):
```
srv/api/billing/checkout.ts(88,59): error TS2339: Property 'current_period_start' does not exist on type 'SubscriptionItem'.
srv/api/billing/checkout.ts(89,58): error TS2339: Property 'current_period_end' does not exist on type 'SubscriptionItem'.
srv/api/billing/modify.ts(63,50): error TS2339: Property 'current_period_end' does not exist on type 'SubscriptionItem'.
```
`agnai` pins `stripe@13.11.0` (installed `node_modules/stripe/types/Subscriptions.d.ts` still
declares `current_period_end`/`current_period_start` on `Subscription`, not on
`SubscriptionItem` — that move only shipped in a later stripe-node major, matching the Basil
API version). More importantly, `srv/api/billing/stripe.ts` **explicitly pins the Stripe API
version**: `new Stripe(config.billing.private, { apiVersion: '2023-08-16' })` — a version from
**before** the 2025-03-31 Basil changelog entry our codemod is based on. Stripe's API versioning
is designed so that an integration pinned to an old version keeps receiving the old response
shape indefinitely, regardless of which `stripe-node` package version is installed. That means
for **this specific repo, as configured today, the original code was correct** and the codemod's
"fix" migrates it to a shape the account's pinned API version may never actually return —
turning a currently-working `current_period_end` read into a field that's likely `undefined` at
runtime, in addition to failing to typecheck.

**This was not caught by `npm test`** (the target repo's own `test` script is `mocha`-only; no
test in `agnai` exercises the billing module, and apidrift's verifier only ever runs the repo's
own `scripts.test`, exactly as designed — it does not run `scripts.typecheck`, which is a
*separate* CI step in `agnai`'s own `pipeline.yml`). apidrift's contract ("runs the target repo's
own test suite, unmodified") was honored to the letter here; it just isn't sufficient to catch
this class of problem when the repo's real CI runs more than `npm test`.

**Not fixed in this US, on purpose** — this is a genuine soundness gap in the *Change*/codemod
model (target.symbol-driven matching has no notion of "is this vendor version change even live
for this caller", i.e. no way to check a pinned `apiVersion` before deciding the migration
applies), not a narrow bug with an obvious one-line correction. Recorded here as a candidate
follow-up US for the architect/PO, alongside the two items below.

## Other observation: `formatText()` blast radius (see the sibling repo's README for the full case)
The fixer's `sf.formatText({ indentSize: 2, convertTabsToSpaces: true })` (`src/fixer/index.ts`)
reformats the **whole touched file** with TypeScript's default `FormatCodeSettings` for every
option it doesn't explicitly set. On this repo the only visible symptom was the cosmetic
`.catch(() => {})` -> `.catch(() => { })` diff line (harmless, not lint-gated here). The
**feross/studynotes.org** proof in this same US hits the same root cause in a way that actually
flips a real repo's `npm test` from green to draft — see that README for the full analysis. Not
fixed here (same reasoning: a real, generalizable "blast radius" issue, but the correct fix is a
design decision — which style to (not) impose — not an obvious bugfix).

## PR upstream vs. internal proof — human decision, not made here
Per this US's constraints, no PR/fork/push was made against `agnaistic/agnai`. Given the SDK-
version finding above, an upstream PR against the *current* `dev` branch would, if merged, likely
introduce a silent runtime regression (an `undefined` renewal date) until the maintainers also
bump `stripe-node` and their pinned `apiVersion` — this is a stronger argument for **internal proof
only** than US-1's equivalent question was. Recorded here, not decided here, per instructions.

## DoD
- `npx tsc --noEmit` (apidrift itself): clean.
- `npm test` (apidrift's own suite): unchanged pass count from before this US — no `src/`,
  `tests/`, or `fixtures/` files were modified by this US (see the two "observation, not fixed
  here" items above and the top-level US-6 report for why).
