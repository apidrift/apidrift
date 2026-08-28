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
3. `src/fixer/` — deterministic transform + reformat to house style.
4. `src/verifier/` — runs the target repo's **unmodified** tests. The moat.
5. `src/githost/` — `GitHost` interface; `LocalGitHost` today, Octokit later.
6. `src/pipeline.ts` orchestrates on a disposable workspace copy.

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
- `npm test` — tool test suite (happy path + draft-on-failure)
- `npm run build` — compile to `dist/`
- `npx tsc --noEmit` — typecheck

## Definition of done (MVP)

`apidrift run <repo>` on a real JS/TS repo using an old Stripe pattern produces
a PR that applies the correct fix, passes the repo's tests in the sandbox, and
explains itself — demonstrated on 3 real repos.
