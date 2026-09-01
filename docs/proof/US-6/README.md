# US-6: proof on 2 more real OSS repos (DoD MVP: 3 repos total)

US-1 proved the pipeline end-to-end on one real repo (`sahat/hackathon-starter`, the 1st Stripe
change, `charges.create` -> `paymentIntents.create`). This US adds two more, reproducing US-1's
methodology, prioritizing proof value per the task envelope:

| # | Repo | Pattern | Tier | Stars / License | Baseline | Post-fix |
|---|------|---------|------|------------------|----------|----------|
| 1 | [`agnaistic/agnai`](./agnaistic-agnai/) | **2nd Stripe change** (`current_period_*` -> `items.data[0].current_period_*`) | 1 (deterministic) | ~776 / AGPL-3.0 | 68/68 passing | 68/68 passing, non-draft — **but see the SDK/API-version finding in that README before treating this as a safe upstream fix** |
| 2 | [`feross/studynotes.org`](./feross-studynotes.org/) | 1st Stripe change (`charges.create` -> `paymentIntents.create`) | 1 (deterministic) | ~162 / none detected | 9/9 passing | draft — the repo's own linter (part of `npm test`) catches a real collateral-formatting bug in the fixer, see that README |

Each subdirectory has the full US-1-shaped artifact set: `README.md`, `baseline-test-output.txt`,
`post-fix-verify-output.txt`, `fix.patch`, `PR.md`. `agnaistic-agnai/` additionally has
`post-fix-typecheck-output.txt` (the repo's own `typecheck` script, run separately since it's not
part of `scripts.test` but is part of the repo's real CI — see that README).

## `--detect` / tier-2 (AI) path — not exercised, documented as a limitation
No `ANTHROPIC_API_KEY` (or equivalent) was available in this environment (checked: absent from
`env`). Per the task's explicit fallback instruction, both repos here use the **deterministic**
tier instead of `--detect`/`--ai`. This was also the deciding factor against one strong
`--detect`-shaped candidate found during the search (`boxyhq/saas-starter-kit`, ~4.9k stars,
Apache-2.0 — its webhook handler destructures `current_period_end`/`current_period_start`
straight off `event.data.object as Stripe.Subscription`, which the deterministic codemod
explicitly does not handle by design — see `stripe-subscription-current-period-to-items.ts`'s
"NOT handled, on purpose" note — making it a textbook case for the tier-2 agent, which needs an
LLM this environment doesn't have). **This remains open**: re-running `--detect --ai` against
`boxyhq/saas-starter-kit` (or a similar destructuring-shaped repo) with a real `ANTHROPIC_API_KEY`
would be the natural next proof point for the AI tier on a real repo, and is recorded here rather
than attempted with a stub/mock LLM (which would prove the harness, not the real tier-2 fix
quality on real code).

## Two findings worth the architect/PO's attention (not fixed in this US)
Both discovered by actually running the pipeline against real code, not by inspection — same
spirit as US-1's `node_modules`/`.gitignore` fixes, but **not** applied here because, unlike those,
neither has an obviously-correct one-line fix (both are product/design decisions):

1. **`formatText()` blast radius** (`src/fixer/index.ts`): the fixer reformats the *entire*
   touched file with default `FormatCodeSettings`, not just the range it edited. On
   `feross/studynotes.org` this alone turns a correct fix into a draft, because the repo's
   `npm test` starts with a style linter. Full analysis in that repo's README.
2. **No API-version awareness in the subscription codemod**: `agnaistic/agnai` pins
   `new Stripe(key, { apiVersion: '2023-08-16' })`, a version from before the vendor changelog
   entry the 2nd codemod is based on (2025-03-31, Basil) — for this specific caller, the *original*
   code was correct and the "fix" migrates to a shape the account's pinned API version may never
   return. Full analysis in that repo's README.

## Candidates considered and not pursued
Documented here rather than fully run, per the task's guidance (mirroring US-1's own list):

- **`mayeaux/nodetube`** (~2,365 stars, MIT) — best-fit pattern for the subscription codemod found
  (`const response = await stripe.subscriptions.retrieve(id); ... response.current_period_end`),
  real `mocha`/`supertest` suite. `npm ci` fails outright: a `youtube-dl` transitive dependency's
  `postinstall` script crashes fetching a binary, unrelated to apidrift or Stripe, on current
  npm/Node. Not pursued.
- **`ttaub/nodecommerce`** (~45 stars, no license) — real `charges.create` callback-style match.
  `npm install` fails: `bcrypt`'s native build requires `make`, unavailable in this sandbox. Not
  pursued.
- **`odota/core`** (OpenDota, ~1,627 stars, MIT) — exact-shape match
  (`const sub = await stripe.subscriptions.retrieve(id); ... sub.current_period_end`) in
  production code. Its test suite (`node --test test/test.ts`) requires Postgres, Redis,
  Cassandra, and Minio running locally, and targets a Node test-runner feature set the CI pins to
  Node 22.14 — standing up that infrastructure was judged out of scope for a proof task. Not
  pursued.
- **`boxyhq/saas-starter-kit`** (~4,921 stars, Apache-2.0) — see "`--detect`/tier-2" above; needs
  the AI tier, not available here.
- **`Flame-Petrov/studentcheck-server`** (0 stars, no license) — exact-shape match, and has a
  real custom `npm test` (six plain-Node test files, no framework). Weak as "real-world" evidence
  (unlicensed, no community traction) compared to the two repos actually used; kept as a fallback
  that was not needed.
- **`mjhea0/node-stripe-charge`** (~271 stars, MIT) — real `charges.create` match, plain `mocha`
  test runner (no lint-in-test, unlike `studynotes.org`). Its baseline itself is **red**: a
  `before each` DB-setup hook times out (needs a live database this sandbox doesn't have) before
  any assertion runs. Since a green baseline is a precondition of the methodology, not pursued.

## PR upstream vs. internal proof — human decision, not made here (2×)
Per this US's constraints, no PR/fork/push was made against either target repo — see each
subdirectory's README for the repo-specific considerations (in both cases stronger arguments for
internal-proof-only than US-1's original case: `agnai`'s fix is conditionally wrong at runtime
depending on the account's pinned Stripe API version; `studynotes.org` has no detected license and
its generated fix is currently a draft, not a mergeable PR).

## DoD
- `npx tsc --noEmit`: clean.
- `npm test` (apidrift's own suite): unchanged — no files under `src/`, `tests/`, or `fixtures/`
  were modified by this US. Everything above was discovered by running the existing, already-done
  US-1/US-2/US-3/US-4/US-5 tool against new real code, not by changing the tool.
