# APIdrift

[![CI](https://github.com/apidrift/apidrift/actions/workflows/ci.yml/badge.svg)](https://github.com/apidrift/apidrift/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40apidrift%2Fcli)](https://www.npmjs.com/package/@apidrift/cli)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

**Dependabot, but for third-party API changes.**

When a vendor you depend on changes their API, APIdrift finds where your code
uses it, fixes the code, runs your own tests to prove the fix is safe, and opens
a pull request. Push model, not pull — you don't have to notice the change.

This repo is a **working tool**: one vendor (Stripe), one language (JS/TS), a
real git branch + PR artifact, **on-the-fly change detection** (the Stripe
changelog, walked from the API version your repo is pinned to), and **two
fixer tiers** — an **AI agent** (the general mechanism, with your own token)
and a deterministic AST codemod (the fast path for the changes it covers).

## How a run works (the default)

`apidrift run .` needs no flag and no release number:

1. **Detect, on the fly.** APIdrift reads the Stripe API version your repo is
   pinned to (set on your client, or imposed by the installed `stripe`
   package) and walks Stripe's public changelog from there to the latest
   release on your line.
2. **Fix with AI (BYOT).** With `ANTHROPIC_API_KEY` set, the AI fixer migrates
   every change that touches your code, using *your* key. Built-in codemods
   handle the changes they cover first, at no token cost.
3. **Verify.** Your own, unmodified test suite gates every fix.

```bash
# npx installs @apidrift/cli, which provides the `apidrift` command
ANTHROPIC_API_KEY=sk-ant-... npx @apidrift/cli run .   # detect + fix (BYOT)
npx @apidrift/cli run .                                # no key: detect + list, exit 20 if drift
apidrift run . --deterministic-only                    # offline: built-in codemods only
apidrift --help
```

- **No key?** APIdrift still detects and **lists** every change that affects
  your repo, with its call sites, then exits `20`. It never tells you there is
  nothing to do when there is — set a key to get the fix.
- **`--deterministic-only`** is the explicit offline mode: no network, no
  model, built-in codemod library only, exit `0`. A choice you make, never a
  fallback for a missing key.
- **Cost cap.** Before any detected change reaches the model, APIdrift counts
  how many actually match your code. Above 5 it lists them and stops; re-run
  with `--yes` or `--max-changes <n>`.

**What leaves your machine.** The changelog walk reads Stripe's PUBLIC docs
and sends none of your code, ever. The AI fixer sends the affected source to
*your* model provider — that is the tradeoff of getting a fix instead of a
listing.

Exit codes: `0` run complete, nothing left unfixed in this repo · `1` the run
stopped (bad argument, unreachable changelog, unresolvable pin, cost cap) ·
`20` drift detected, not fixed because no model is configured.

## Ship the Free tier

Free = the CLI.

Publish it:

```bash
npm run build && npm test             # prepublishOnly runs these too
npm publish                           # ships dist/ + action.yml + README + LICENSE + NOTICE
```

The published package is lean (no fixtures/tests). Bedrock/Vertex are optional
deps — Free users never install them.

### CI/CD (GitHub Actions)

- **`.github/workflows/ci.yml`** — runs typecheck + build + test on every push and
  PR (Node 20 & 22). This is the build pipeline.
- **`.github/workflows/release.yml`** — publishes to npm when you cut a GitHub
  Release, with **provenance** (supply-chain attestation). Flow:

  ```bash
  npm version minor          # or patch — bumps package.json + creates a git tag
  git push --follow-tags
  # then create a Release for that tag on GitHub -> the workflow publishes
  ```

`repository` in `package.json` must point at the real repo URL (needed for
provenance) and `package-lock.json` must be committed (needed by `npm ci`) —
both already true in this repo.

## Quick Start (2 minutes)

Against your own repo, straight from npm (`@apidrift/cli`, binary `apidrift`):

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # your token (BYOT)
npx @apidrift/cli run .               # detect on the fly + fix with AI
```

To try it from a clone of this repo without a key or a network connection,
run the bundled sample repo in offline mode:

```bash
npm install
npx tsx src/cli.ts run ./fixtures/acme-payments --deterministic-only
```

Real output (offline mode, colors stripped; the sample repo has not run
`npm install`, hence the `api version:` line):

```text
apidrift v0.4.0  scanning ./fixtures/acme-payments
inference: deterministic-only (no model — codemod library only)

offline mode (--deterministic-only): the changelog walk did NOT run and nothing was fetched.
only the built-in codemod registry ran. To detect what Stripe changed since your pinned API version, drop it and re-run.

● Migrate deprecated Charges.create to PaymentIntents.create
  vendor: stripe  confidence: high  via: deterministic
  branch: apidrift/stripe-charges-create-to-payment-intents
    src/checkout.js:8  stripe.charges.create({
  tests passed
  PR: ./apidrift-out/apidrift-stripe-charges-create-to-payment-intents.md
  patch: ./apidrift-out/apidrift-stripe-charges-create-to-payment-intents.patch

● Read subscription billing periods off subscription items (Basil 2025-03-31)
  vendor: stripe  confidence: medium  via: deterministic
  branch: apidrift/stripe-subscription-current-period-to-items
  api version: takes effect from 2025-03-31.basil — this repo's code sets no apiVersion, and APIdrift could not check the implicit one: node_modules/stripe is not installed here. stripe-node v12+ pins IMPLICITLY to the API version current at its own release, so "no pin in the code" is not "latest" — install dependencies and re-run, or confirm yours is 2025-03-31.basil or later.
    src/billing.js:14  subscription.current_period_start
    src/billing.js:15  subscription.current_period_end
  tests passed
  PR: ./apidrift-out/apidrift-stripe-subscription-current-period-to-items.md
  patch: ./apidrift-out/apidrift-stripe-subscription-current-period-to-items.patch

done — 2 pull requests in ./apidrift-out
tip: set ANTHROPIC_API_KEY and pass --ai to also fix changes without a codemod.
```

**Where the results are.** One PR body + one patch per change that matched,
written to `./apidrift-out/` (change it with `--out <dir>`; nothing is written
inside the scanned repo):

- `apidrift-<change-id>.md` — the ready-to-review PR description
- `apidrift-<change-id>.patch` — apply it with `git am`

**If nothing concerns your repo**, you see this line right after
`done — 0 pull requests`, and the exit code is 0:

```text
✓ no known API change affects this repo — nothing to fix (checked 2 known changes)
```

It only appears when every known change was checked and none touched your
code. As soon as APIdrift finds call sites it did not change, for any reason and
whether or not it prints a warning about them, that line is not shown.

Drop `--deterministic-only` and the same repo goes through the default path:
the changelog walk (pass `--since <api-version>` here, since the sample repo
has no installed `stripe` package to read the pin from), then the AI fixer if
a key is set.

Contributors: `npm run demo` runs the pipeline on the same fixture (offline) and
`npm test` proves the happy path AND the "moat" (draft on red).

## What it does, end to end

For each known change, on a disposable copy of the target repo:

1. **Detect** — `src/detection` walks the Stripe changelog from the repo's
   pinned API version and turns each breaking change into a normalized
   `Change` record; the built-in codemod registry (`src/changes`) adds its own.
2. **Locate** — `src/matcher` uses the TypeScript AST (via ts-morph) to find
   exactly where the changed symbol is used. AST, never regex.
3. **Fix** — `src/fixer` applies a deterministic codemod when one exists, else
   the AI agent (BYOT), touching only the matched code.
4. **Verify** — `src/verifier` runs the target repo's **own, unmodified** test
   suite in the workspace. This is the moat: a red suite never ships as a real PR.
5. **Open PR** — `src/githost` creates a real branch + commit and emits the PR
   body and patch. Green → PR; red → **draft** with the failure attached.

## Why you can trust it

- **It can't merge broken code.** A PR only leaves draft if your tests pass.
- **Your tests are read-only.** The fixer edits source, never tests, so it
  can't "win" by weakening what checks it. (`npm test` proves this path.)
- **Blast radius only.** It edits only files that use the changed API.
- **Your code can stay home.** The engine is designed to run inside your CI
  (the `GitHost` abstraction makes the hosted vs self-hosted split trivial).

## The AI fixer

The fix step has two tiers (see `src/fixer`):

1. **Deterministic codemod** — when a change ships a hand-written `apply`, use it.
   Fast, free, no tokens. This is the fast path / cache.
2. **AI agent** (`src/fixer/agent.ts`) — for any change with no codemod (the
   common case, and most of what the changelog walk detects). An agentic loop
   with tools (`read_file`, `write_file`, `run_tests`) migrates the code. On by
   default when `ANTHROPIC_API_KEY` is set (or with `--ai`); `--deterministic-only`,
   `apidrift.json` or `APIDRIFT_INFERENCE` turn it off. The LLM client is
   injectable (`src/fixer/llm.ts`) so it runs for real with a key and is proven
   by tests with a mock (`tests/ai-fixer.test.ts`).

Guardrails are enforced **in code**, not just the prompt: the agent may edit
only blast-radius files, never tests, never outside the repo — and the verifier
still gates everything. Turn it on:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx @apidrift/cli run .   # AI fixer: ON
```

## Project layout

```
src/
  types.ts            Change record + shared types (the pivot of the system)
  detection/          the default change feed: Stripe changelog walk from the pinned version
  changes/            built-in registry: one Codemod per supported change (tier 1)
  matcher/            ts-morph AST matching
  fixer/
    index.ts            picks tier 1 (codemod) or tier 2 (AI agent)
    agent.ts            the AI agentic loop + code-enforced guardrails
    llm.ts              injectable LLM (AnthropicLLM | mock)
  verifier/           runs the target repo's own tests (the moat)
  githost/            GitHost interface (the seam between tiers)
    local.ts            Free: branch + patch, code stays local
    github.ts           Pro/Enterprise: push + open PR via Octokit
  pipeline.ts         host-injectable engine (workspace | in-place modes)
  cli.ts              Free entrypoint  -> `apidrift run <repo>`
  runner.ts           Enterprise entrypoint -> runs in the client's CI
  service/            Pro entrypoint -> job.ts (runForRepo) + poller.ts (skeleton)
action.yml            the composite GitHub Action (Enterprise = one file)
examples/
  enterprise-workflow.yml   drop-in workflow for a consumer repo
fixtures/acme-payments/      a realistic target repo on the old Stripe API
tests/pipeline.test.ts       happy path + the draft-on-failure moat
docs/
  USAGE.md            how users use each tier (Free / Pro / Enterprise)
  architecture.md     runtime architecture (AI, diffing, git)
  YC.md               the north star (RFS mapping, pitch)
```

## The three surfaces (see docs/USAGE.md)

- **Free** — `npx @apidrift/cli run .` (LocalGitHost: branch + patch stay local;
  only the AI fixer, with your key, sends affected source to your provider).
- **Enterprise** — add `examples/enterprise-workflow.yml` to a repo; the engine
  runs in the client CI via `action.yml`, code never leaves.
- **Pro** — `src/service/job.ts` is the per-repo job our backend runs; `poller.ts`
  outlines the upstream (poll + diff + fan-out).

## Adding a supported change

A change ships as all four, or it doesn't ship:

1. a `Change` + `Codemod` in `src/changes/`,
2. registered in `src/changes/index.ts`,
3. a before/after case in `fixtures/`,
4. a test in `tests/`.

## Roadmap (see `docs/backlog.md`)

- More vendors and languages, once Stripe + JS/TS is proven on real repos.
- Scheduled detection (a background poller) on top of today's per-run changelog walk.
- `GitHubHost` (Octokit) and `GitLabHost` behind the existing interface.
- Self-hosted runner (GitHub Action / GitLab CI component).

## Contributing

Bug reports, new `Change`/`Codemod` pairs (see "Adding a supported change"
above), and fixes are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for
the workflow, coding conventions (`docs/conventions.md`), and the DoD each PR
must clear (`npx tsc --noEmit` + `npm test`). Please read the
[Code of Conduct](./CODE_OF_CONDUCT.md) before participating.

Found a security issue? Please **do not** open a public issue — see
[SECURITY.md](./SECURITY.md) for how to report it privately.

## License

APIdrift (the engine and the Free CLI) is open source under the
**[Apache License 2.0](./LICENSE)** — use it, self-host it, modify it,
redistribute it, including inside a commercial organization, with no
field-of-use restriction. See [`LICENSE`](./LICENSE) for the full text and
[`NOTICE`](./NOTICE) for attribution. Pro and Enterprise are separate,
closed-source offerings built on top of this same engine (hosting,
support, SLAs) — they don't change the license of what's in this repo.

See [CHANGELOG.md](./CHANGELOG.md) for release history.
