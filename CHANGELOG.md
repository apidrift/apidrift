# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) (with
the `0.x` caveat that any minor version may include breaking changes).

## [Unreleased]

### Changed

- Relicensed from MIT to **Business Source License 1.1** (BUSL-1.1) — free
  for any use, including inside a commercial organization on your own
  repositories, with a carve-out against reselling APIdrift as a competing
  hosted service. Converts to Apache License 2.0 four years after each
  release. See the "License" section in `README.md` and `LICENSE`.
- Added open-source project hygiene: `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, issue/PR templates.

## [0.1.0] - 2026-08-28

### Added

- Initial working engine: Stripe, JS/TS, deterministic codemod fixer tier,
  AI agent fixer tier (`src/fixer/agent.ts`, `ANTHROPIC_API_KEY`), verifier
  (runs the target repo's own unmodified tests), `LocalGitHost` (Free) and
  `GitHubHost` (Pro/Enterprise).
- Three entry points on one engine: `src/cli.ts` (Free), `src/runner.ts`
  (Enterprise, via `action.yml`), `src/service/` (Pro, skeleton).
- `npm test` covers the deterministic happy path, the draft-on-red-suite
  moat, the AI fixer path, and the AI guardrail (agent cannot edit tests).
