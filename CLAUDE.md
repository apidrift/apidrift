# CLAUDE.md — APIdrift

## What this is

APIdrift watches a third-party API a team depends on and, when the vendor
changes it, opens a **verified pull request** that fixes the team's code.
"Dependabot, but for third-party API changes." Push model, not pull.

Distinction from the tools it sits between:
- `oasdiff` *detects* spec changes but never touches code.
- Codemod.com *applies* transforms, but a human must notice the change and run it.
- APIdrift is triggered by the change and delivers a **tested** fix unprompted.

## North star

This repo is the wedge for the YC RFS **"Self-Maintaining APIs"**. See
`docs/YC.md`. Keep the codebase pointed at one proof: *turn one real vendor
change into a tested PR on a real repo.*

## Current state (what's built)

A working tool: **Stripe**, **JS/TS**, real git branch + PR/patch artifact, and
**two fixer tiers** — deterministic codemod (fast path) and an **AI agent**
(`src/fixer/agent.ts`, enabled via `ANTHROPIC_API_KEY`, injectable LLM). Verified
by `npm test`: deterministic happy path, the moat, the AI path, and the AI
guardrail (agent cannot edit tests).

**The default Free path is the dynamic diff.** `apidrift run <repo>` with no flag
resolves the Stripe API version the repo is pinned to (written on the client, or
imposed by the installed `stripe` package), walks the Stripe changelog from that
version to the latest release on its line, and works on what it finds. Nobody types
a release number. Three things follow:
- **With a model** (`ANTHROPIC_API_KEY` + `--ai`): detected changes go through the
  cost cap (default 5, `--max-changes` / `--yes`) and then the pipeline.
- **Without a model**: apidrift still detects and LISTS every change that affects
  the repo, does not fix them, says an API key is required, and exits `20`. It never
  says "nothing to do" while sites are left unfixed.
- **`--deterministic-only`** (flag, `APIDRIFT_INFERENCE=deterministic-only`, or
  `apidrift.json`) is the explicit OFFLINE mode: built-in registry only, zero
  network, exit 0. That is a choice, never a consequence of a missing key.

## Scope guards — do NOT build these without a reason in `docs/backlog.md`

- ❌ generic multi-vendor / multi-language engine
- ❌ a detection scheduler / snapshot store / fan-out, and oasdiff / spec ingestion.
  What EXISTS and is bounded: Stripe changelog ingestion (`src/detection/`), one
  vendor, triggered by the user (the CLI, or a cron'd Action) on every run, no
  scheduler. It does not grow into a second vendor or a background poller.
- ❌ web UI, dashboard, auth, billing

The **AI fixer (tier 2)** is implemented in `src/fixer/agent.ts`. It is the
general mechanism (most changes have no deterministic codemod). It stays gated
by the verifier and may never edit tests — guardrails are enforced in the tool
code, not the prompt. Do not weaken those guardrails.

## Architecture (see `docs/architecture.md`)

1. `src/detection/` — the **default change feed**: Stripe changelog ingestion.
   `VendorSource` (`vendor-source.ts`, one implementation in `stripe-source.ts`)
   resolves the repo's pinned API version and returns the `Change`s published since
   it; `walk.ts` / `bound.ts` decide which releases the walk covers. It reads the
   vendor's PUBLIC changelog behind an injectable `Fetcher`, so tests never touch
   the network. That is NOT the tool's only network egress: the LLM providers
   (`src/fixer/providers.ts`, when a model is configured) and `GitHubHost`
   (`src/githost/github.ts`, Octokit, Enterprise/Pro) reach out too.
2. `src/changes/` — normalized `Change` records + the built-in `Codemod`s (the
   static registry). It is tier 1, and it is not the default feed any more: it runs
   on EVERY run, outside the cost cap (`alwaysRun`, it costs no token); it is the
   WHOLE content of a `--deterministic-only` run; and it is the fixture that lets a
   CI run with no key and no network.
3. `src/matcher/` — ts-morph AST matching. **AST, never regex.**
4. `src/fixer/` — picks tier 1 (`codemod.apply`) or tier 2 (`agent.ts`, AI);
   `providers.ts` resolves the LLM client, `llm.ts` is the injectable interface.
5. `src/verifier/` — runs the target repo's **unmodified** tests. The moat.
6. `src/githost/` — `GitHost` interface; `local.ts` (Free) and `github.ts`
   (Octokit, used by Enterprise/Pro) both implement it.
7. `src/pipeline.ts` orchestrates on a disposable workspace copy (or in-place)
   and is shared by every entry point below. `src/plan.ts` is its read-only
   counterpart: it counts, without any model, which detected changes match code in
   the repo (the cost cap and the no-key listing both read it).

**Three entry points, one engine** — only the packaging differs:
- `src/cli.ts` — Free, local; a four-line binary shim over `src/cli-run.ts`
  (`runCli(argv, deps)` returns the exit code, with `Fetcher` and `Llm` injectable so
  tests never touch the network). `resolveInference`/`resolveLlm` decide
  deterministic-only vs BYOT from flags/env/`apidrift.json`, and
  `resolveInference` also reports WHERE the policy came from (flag / env / file /
  default): an explicit `deterministic-only` is the offline mode, the same policy
  reached by having no key is not.
- `src/runner.ts` — Enterprise. Runs inside the client's own CI (see
  `action.yml`, `examples/enterprise-workflow.yml`); uses `GitHubHost` so only
  the `pulls.create` call leaves their runner.
- `src/service/` — Pro (`job.ts` is the per-repo job; `poller.ts` is an
  unimplemented skeleton for the upstream poll+diff+fan-out).

`docs/architecture.md` describes the **target** architecture (upstream
scheduler polling vendor specs, ast-grep, always-on GitHub hosting) — read it
for the "why", not as a description of what's implemented today. Today: no
scheduler (changes are read from the Stripe changelog by the user's own run,
`src/detection/`; `src/changes/index.ts` is only the tier-1 registry), the
matcher is ts-morph not ast-grep, and `LocalGitHost` (patch file, no network)
is the default host.

## Principles

- **Deterministic-first.** Reach for a codemod; use the AI tier only when there
  isn't one.
- **Verification is the moat.** Never open a non-draft PR on a red suite.
- **Tests are read-only to the fixer.** It edits source only — full stop.
- **Blast radius only.** Never touch CI config, secrets, or lockfiles.
- **One hard case fully solved beats ten half-done.**

## Conventions

A supported change ships as all four or not at all:
`Change`+`Codemod` in `src/changes/` · registered in `src/changes/index.ts` ·
a before/after case in `fixtures/` · a test in `tests/`.

## Commands

- `npm run demo` — pipeline against `fixtures/acme-payments`, in
  `--deterministic-only` (the offline mode: it demonstrates the built-in registry, NOT
  the default path — the default path fetches the changelog)
- `npm test` — tool test suite (happy path + draft-on-failure); runs via
  `tsx --test tests/*.test.ts` (Node's built-in test runner)
- `npx tsx --test tests/pipeline.test.ts` — run a single test file (swap the
  path for `tests/ai-fixer.test.ts` or `tests/config.test.ts`)
- `npm run build` — compile to `dist/`
- `npx tsc --noEmit` (or `npm run typecheck`) — typecheck
- `npx tsx src/cli.ts run <path> [--ai] [--deterministic-only] [--offline] [--since <api-version>] [--model <id>] [--out <dir>] [--max-changes <n>] [-y]`
  — run the CLI directly against any target repo without building first.
  No flag is required: the pinned API version of the repo is the lower bound.
  `--since` overrides that bound; `--deterministic-only` = offline, registry only,
  exit 0; `--offline` = refuse to run rather than reach the network, exit 1 (it
  stops, `--deterministic-only` runs). `--max-changes` / `--yes` matter only when a
  model is configured. Passing a retired flag is an explicit error naming its
  replacement, never silently ignored.
- Exit codes (US-16, decision humaine A3/B1 du 2026-09-26): `0` run complete —
  no site found in the repo is left without a fix; report-only (forme #2)
  changes and unreadable changelog pages are LISTED, never counted against
  this · `1` the run STOPPED (bad argument, unreachable or unreadable
  changelog, `--offline`, unresolvable pin, cost cap refused, or a range whose
  EVERY attempted page came back unreadable — nothing established) · `20`
  drift detected and not fixed because no model is configured
  (`20`–`29` is reserved for APIdrift verdicts)

## Agile agent team (agile-agents-socle)

This repo also hosts an agent team (from
[agile-agents-socle](https://github.com/clemuscle/agile-agents-socle)) whose
job is to drive day-to-day feature work on APIdrift itself — it's tooling
*for* the project, not part of the APIdrift product.

- Entry point: `claude --agent orchestrateur`. It turns a plain-language need
  into US → architecture → dev (isolated worktree) → qa → done, and only
  interrupts you at validation gates (via lavish).
- Agents: `.claude/agents/{orchestrateur,po,architecte,dev,qa,retro}.md`.
- Source of truth: `board/backlog.json` + `board/board.json` (edit only via
  `node scripts/board.mjs`, never by hand) and `architecture/architecture.json`
  (kept in sync with the "Architecture" section above). Human-readable views:
  `board/board.html`, `architecture/architecture.html`.
- Definition of Done is the deterministic gate in `scripts/dod.sh`
  (`npx tsc --noEmit` + `npm test`), enforced by a `SubagentStop` hook on the
  `dev` agent (`scripts/hooks/dod-gate.sh`) — red suite means the dev agent
  fixes it, it does not report `done`.
- Git for this workflow: `feature/<US-ID>-<slug>` off `main`, Conventional
  Commits referencing the US-ID, PR titled `<US-ID> <title>`. See
  `docs/conventions.md` and `docs/communications.md` for the full protocol.
- Everything above still applies to what the `dev` agent produces: no
  scheduler/UI/multi-vendor scope creep, AST not regex, tests read-only to the
  AI fixer, verification is the moat.

## Definition of done (MVP)

`apidrift run <repo>` on a real JS/TS repo using an old Stripe pattern produces
a PR that applies the correct fix, passes the repo's tests in the sandbox, and
explains itself — demonstrated on 3 real repos.
