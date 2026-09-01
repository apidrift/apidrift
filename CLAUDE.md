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

## Scope guards — do NOT build these without a reason in `docs/backlog.md`

- ❌ generic multi-vendor / multi-language engine
- ❌ automated change detection (oasdiff / changelog ingestion) — still hardcoded
- ❌ web UI, dashboard, auth, billing

The **AI fixer (tier 2)** is implemented in `src/fixer/agent.ts`. It is the
general mechanism (most changes have no deterministic codemod). It stays gated
by the verifier and may never edit tests — guardrails are enforced in the tool
code, not the prompt. Do not weaken those guardrails.

## Architecture (see `docs/architecture.md`)

1. `src/changes/` — normalized `Change` records + `Codemod`s (the change feed).
2. `src/matcher/` — ts-morph AST matching. **AST, never regex.**
3. `src/fixer/` — picks tier 1 (`codemod.apply`) or tier 2 (`agent.ts`, AI);
   `providers.ts` resolves the LLM client, `llm.ts` is the injectable interface.
4. `src/verifier/` — runs the target repo's **unmodified** tests. The moat.
5. `src/githost/` — `GitHost` interface; `local.ts` (Free) and `github.ts`
   (Octokit, used by Enterprise/Pro) both implement it.
6. `src/pipeline.ts` orchestrates on a disposable workspace copy (or in-place)
   and is shared by every entry point below.

**Three entry points, one engine** — only the packaging differs:
- `src/cli.ts` — Free, local. `resolveInference`/`resolveLlm` decide
  deterministic-only vs BYOT from flags/env/`apidrift.json`.
- `src/runner.ts` — Enterprise. Runs inside the client's own CI (see
  `action.yml`, `examples/enterprise-workflow.yml`); uses `GitHubHost` so only
  the `pulls.create` call leaves their runner.
- `src/service/` — Pro (`job.ts` is the per-repo job; `poller.ts` is an
  unimplemented skeleton for the upstream poll+diff+fan-out).

`docs/architecture.md` describes the **target** architecture (upstream
scheduler polling vendor specs, ast-grep, always-on GitHub hosting) — read it
for the "why", not as a description of what's implemented today. Today: no
scheduler (changes are hardcoded in `src/changes/index.ts`), the matcher is
ts-morph not ast-grep, and `LocalGitHost` (patch file, no network) is the
default host.

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

- `npm run demo` — pipeline against `fixtures/acme-payments`
- `npm test` — tool test suite (happy path + draft-on-failure); runs via
  `tsx --test tests/*.test.ts` (Node's built-in test runner)
- `npx tsx --test tests/pipeline.test.ts` — run a single test file (swap the
  path for `tests/ai-fixer.test.ts` or `tests/config.test.ts`)
- `npm run build` — compile to `dist/`
- `npx tsc --noEmit` (or `npm run typecheck`) — typecheck
- `npx tsx src/cli.ts run <path> [--ai] [--deterministic-only] [--model <id>] [--out <dir>]`
  — run the CLI directly against any target repo without building first

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
  detection/UI/multi-vendor scope creep, AST not regex, tests read-only to the
  AI fixer, verification is the moat.

## Definition of done (MVP)

`apidrift run <repo>` on a real JS/TS repo using an old Stripe pattern produces
a PR that applies the correct fix, passes the repo's tests in the sandbox, and
explains itself — demonstrated on 3 real repos.
