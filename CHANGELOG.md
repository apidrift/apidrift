# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) (with
the `0.x` caveat that any minor version may include breaking changes).

## [Unreleased]

## [0.2.0] - 2026-09-01

### Added

- Second supported Stripe change: `Subscription.current_period_start`/`_end`
  moved to `SubscriptionItem` (API `2025-03-31.basil`). First codemod whose
  edit lands on a property read of a call's result rather than the call
  itself — validates the four-piece convention (`Change`+`Codemod`,
  registry, fixture, tests) generalizes past the original charges→intents
  case.
- Automated detection MVP: an opt-in `apidrift run <repo> --detect [--release
  <id>]` flag polls the real Stripe changelog, parses it into `Change`
  records with zero manual registry edits, and classifies each into
  auto-executable ("form #1", the edit lands on the request — a generic
  `target.symbol`-driven matcher applies) versus report-only ("form #2", a
  response field moved — needs a hand-written codemod). The registry stays
  hardcoded and unaffected when the flag is off; the generic matcher
  fail-closes when a receiver's root doesn't resolve to the vendor module,
  so an unrelated `db.subscriptions.retrieve(...)` is never matched.

### Fixed

- Release workflow no longer passes `--provenance` to `npm publish`: npm's
  sigstore provenance check rejects publishes whose source repo is private,
  and this repo is currently private. Re-add `--provenance` once the repo
  goes public.
- First codemod (charges→paymentIntents) now adds `automatic_payment_methods`
  instead of leaving a conditional `return_url` requirement unmet.
- PR body shows a runner summary line instead of a raw test-output tail when
  the target suite is green.
- Subscription codemod: an optional-chained read (`sub?.current_period_end`)
  keeps its original null-short-circuit instead of moving the `?.` guard
  past the inserted `.items.data[0]` segment; a binding reassigned to a
  non-subscription source stops being tracked; both hand-written codemods'
  `find()` now reject a receiver whose root is provably not the vendor
  module (closing the same false-positive class the detection matcher
  guards against, for the cases where it's cheap to check).

## [0.1.0] - 2026-08-30

First published release, as `@apidrift/cli` on npm.

### Added

- Initial working engine: Stripe, JS/TS, deterministic codemod fixer tier,
  AI agent fixer tier (`src/fixer/agent.ts`, `ANTHROPIC_API_KEY`), verifier
  (runs the target repo's own unmodified tests), `LocalGitHost` (Free) and
  `GitHubHost` (Pro/Enterprise).
- Three entry points on one engine: `src/cli.ts` (Free), `src/runner.ts`
  (Enterprise, via `action.yml`), `src/service/` (Pro, skeleton).
- `npm test` covers the deterministic happy path, the draft-on-red-suite
  moat, the AI fixer path, and the AI guardrail (agent cannot edit tests).

### Changed

- Relicensed from MIT to the **Apache License 2.0** — no field-of-use
  restriction; see the "License" section in `README.md`, `LICENSE`, and
  `NOTICE`.
- Renamed the npm package from `apidrift` (taken by an unrelated project)
  to **`@apidrift/cli`**. The CLI binary is unaffected — it's still invoked
  as `apidrift` (e.g. `npx @apidrift/cli run .`).
- Added open-source project hygiene: `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, issue/PR templates.
