# Real-world proof: RandomAPI/Randomuser.me-Node

**Verdict, honestly: the pipeline worked end to end, the fix did NOT ship green.**
apidrift found the real call site, applied the intended migration, ran the repo's
own tests, and correctly turned the result into a **draft** — because the repo's
installed Stripe SDK (`stripe@4.25.0`) predates PaymentIntents, so the migrated
code crashes at runtime. This is the moat doing its job on a real repo. It is
**not** a "green PR on a real repo" proof (that one is `docs/proof/US-1`).

Local test only. Nothing was pushed, forked or opened on the third-party repo.

## Target
- **URL:** https://github.com/RandomAPI/Randomuser.me-Node (MIT, ~1.5k stars)
- **HEAD at clone time:** `ac8e874f5adbb8a29aa35edc9b3f616f5e9756ed` (2022-07-04, `master`)
- **Call site:** `routes/index.js:71` `stripe.charges.create({...}, callback)`, client built
  at line 11 by `const stripe = require("stripe")(settings.stripePrivateKey)`
- **Installed SDK:** `stripe@4.25.0` (declared `^4.11.0`)
- Clone lived in `/tmp/apidrift-realworld/` (not committed here).

## What was run
`apidrift v0.3.1 run <clone> --deterministic-only` — **not** `--ai`.
- No `ANTHROPIC_API_KEY` was available in this session, and `--ai` refuses to start without one.
- For this change it would not have mattered: `stripe.charges.create` has a deterministic
  codemod, and apidrift is deterministic-first, so the LLM tier is never called. The AI fixer
  was therefore **not exercised** by this proof. A real `--ai` proof needs a change with no
  codemod (e.g. via `--detect`).

Output: `apidrift-run-output.txt`. Artifacts: `PR.md`, `fix.patch`.

## Getting a meaningful baseline (needs setup the README does not mention)
The repo's tests need infrastructure; without it the verifier's verdict would be noise.

| Baseline state | Result |
|---|---|
| `npm ci --ignore-scripts`, no MongoDB | 0 passing, 345 failing (mongoose buffering timeout) |
| + local `mongo:4.4` (Docker, bound to 127.0.0.1) | 333 passing, 12 failing (`.viewsMin/` missing) |
| + `npm run build` (gulp, produces `.viewsMin/`) | **344 passing, 0 failing** |

Even then the baseline is **flaky**: the test `Nat check … should retrieve random nat when
invalid nat is specified` (`spec/api/modern/1.0.js:188`, `expected [...] to include 'IN'`)
depends on random data. Baseline over 3 runs: 343p/1f, 344p/0f, 344p/0f.
Full passing baseline output: `baseline-test-output.txt`.

## Result on the fixed code
`fix.patch` (1 file, +5/-3): `charges.create` -> `paymentIntents.create`, `source` ->
`payment_method`, plus `confirm: true` and `automatic_payment_methods`. Correct for the
modern Stripe API.

Same suite, patched copy, 3 runs: 342p/2f, 342p/2f, 343p/1f (vs. 0-1 failures at baseline).
The extra failure is **deterministic and caused by the fix**:

```
Randomuser.me > Website
  should return 200 when posting to /donate with valid info and valid email:
  Uncaught TypeError: Cannot read properties of undefined (reading 'create')
```

`stripe@4.25.0` has no `paymentIntents` resource. Full output: `post-fix-test-output.txt`.
Verdict: **draft** ("tests failed"). Correct verdict, correct reason.

## Findings (nothing was changed in the product; these are observations)
1. **The PR.md verification excerpt shows the wrong failure.** It displays only the flaky
   `Nat check` failure (line 188 of the spec), not the `/donate` `TypeError` that the fix
   actually caused. A reviewer reading the draft would blame an unrelated random test.
   Same family as the "misleading verification excerpt" recorded in `docs/proof/US-1`.
2. **apidrift does not check that the installed SDK supports the target API.** It knows how
   to read the pinned *API version* (US-7/US-9) but not whether the SDK in `node_modules`
   even ships the new resource. Here the draft is right, but only because the tests happen to
   exercise the route; a repo with a thinner suite would get a green PR that breaks in prod.
3. **The AI tier was not exercised** (see above).
4. **The verifier hands the full process environment to the target's test process**
   (`src/verifier/index.ts`: `{ ...process.env, CI: 'true' }`). In BYOT mode that includes
   `ANTHROPIC_API_KEY`, visible to any third-party test code and npm dependency executed by
   `npm test`. Not exploited here (no key in the environment, and this repo's own code only
   reads `process.env.spec`), but worth scrubbing before pointing `--ai` at untrusted repos.
5. **A real repo's tests may need services** (here MongoDB) and a build step. Unmet, the
   result is a red baseline that the tool cannot tell apart from a red fix.

## Reproduce
```bash
git clone https://github.com/RandomAPI/Randomuser.me-Node && cd Randomuser.me-Node
git checkout ac8e874f5adbb8a29aa35edc9b3f616f5e9756ed
npm ci --ignore-scripts && npm run build
docker run -d --rm -p 127.0.0.1:27017:27017 mongo:4.4
npx tsx <apidrift>/src/cli.ts run . --deterministic-only --out /tmp/out
```
