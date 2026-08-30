# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) (with
the `0.x` caveat that any minor version may include breaking changes).

## [Unreleased]

### Fixed

- Release workflow no longer passes `--provenance` to `npm publish`: npm's
  sigstore provenance check rejects publishes whose source repo is private,
  and this repo is currently private. Re-add `--provenance` once the repo
  goes public.

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
