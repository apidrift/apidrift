# APIdrift

[![CI](https://github.com/apidrift/apidrift/actions/workflows/ci.yml/badge.svg)](https://github.com/apidrift/apidrift/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40apidrift%2Fcli)](https://www.npmjs.com/package/@apidrift/cli)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

**Dependabot, but for third-party API changes.**

When a vendor you depend on changes their API, APIdrift finds where your code
uses it, fixes the code, runs your own tests to prove the fix is safe, and opens
a pull request. Push model, not pull — you don't have to notice the change.

This repo is a **working tool**: one vendor (Stripe), one language (JS/TS), a
real git branch + PR artifact, and **two fixer tiers** — a deterministic AST
codemod (fast path) and an **AI agent** (the general mechanism, enabled with
`ANTHROPIC_API_KEY`). Automated change detection is the documented next step.

## Ship the Free tier tonight

Free = the CLI. Your code never leaves your machine. Two inference modes:

- **deterministic-only** (default, no key): fixes anything covered by the codemod
  library. No model, nothing sent anywhere.
- **BYOT** (bring your own token): set `ANTHROPIC_API_KEY` and pass `--ai` to also
  fix changes with no codemod, using *your* key.

```bash
# try it (npx installs @apidrift/cli, which provides the `apidrift` command)
npx @apidrift/cli run .                    # deterministic-only
ANTHROPIC_API_KEY=sk-ant-... \
  npx @apidrift/cli run . --ai             # + AI fixer (BYOT)

apidrift run . --deterministic-only        # force no-model mode
apidrift --help
```

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
  npm version patch          # bumps package.json + creates a git tag
  git push --follow-tags
  # then create a Release for that tag on GitHub -> the workflow publishes
  ```

`repository` in `package.json` must point at the real repo URL (needed for
provenance) and `package-lock.json` must be committed (needed by `npm ci`) —
both already true in this repo.

## Quick Start (2 minutes)

From a clone of this repo, no API key needed:

```bash
npm install
npx tsx src/cli.ts run ./fixtures/acme-payments
```

Against your own repo, straight from npm (`@apidrift/cli` v0.3.0, binary
`apidrift`):

```bash
npx @apidrift/cli run .
```

Real output for the first command (`fixtures/acme-payments`, deterministic
mode, colors stripped; that sample repo has not run `npm install`, hence the
`api version:` line):

```text
apidrift v0.3.0  scanning ./fixtures/acme-payments
inference: deterministic-only (no model — codemod library only)

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

**Optional AI fixer (BYOT):** for changes with no built-in codemod, set
`ANTHROPIC_API_KEY` and add `--ai`. Without it, nothing leaves your machine.

Contributors: `npm run demo` runs the pipeline on the same fixture and
`npm test` proves the happy path AND the "moat" (draft on red).

## What it does, end to end

For each known change, on a disposable copy of the target repo:

1. **Detect** — the change is described as a normalized `Change` record
   (hardcoded in the MVP; emitted by a diff engine in production).
2. **Locate** — `src/matcher` uses the TypeScript AST (via ts-morph) to find
   exactly where the changed symbol is used. AST, never regex.
3. **Fix** — `src/fixer` applies a deterministic codemod, touching only the
   matched code, and reformats to house style.
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
   common case). An agentic loop with tools (`read_file`, `write_file`,
   `run_tests`) migrates the code. Selected by inference policy (`--ai`/`--deterministic-only`, `apidrift.json`, or env); the
   LLM client is injectable (`src/fixer/llm.ts`) so it runs for real with a key
   and is proven by tests with a mock (`tests/ai-fixer.test.ts`).

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
  changes/            the "change feed": one Codemod per supported change
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

- **Free** — `npm run demo` / `npx @apidrift/cli run .` (LocalGitHost, code stays local).
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

- AI fixer (tier 2) for changes with no deterministic codemod yet.
- Automated change detection: poll OpenAPI specs (oasdiff) + SDK releases.
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
