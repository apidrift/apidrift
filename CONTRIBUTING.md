# Contributing to APIdrift

Thanks for considering a contribution. This project is small and opinionated
on purpose (see `CLAUDE.md`'s scope guards) — the fastest way to get a PR
merged is to keep it aimed at the same target.

## Before you start

- Skim `CLAUDE.md` for the north star and the explicit **scope guards**
  (no generic multi-vendor engine, no automated detection yet, no web
  UI/auth/billing). PRs outside that scope will likely be asked to move to
  `docs/backlog.md` first.
- For anything more than a small fix, open an issue to align on the approach
  before writing code — it saves everyone a rewrite.

## Setup

```bash
npm install
npm test              # happy path + the "moat" (draft-on-red-suite)
npx tsc --noEmit       # typecheck
npm run demo           # pipeline against fixtures/acme-payments
```

## Adding a supported API change

A change ships as all four pieces, or it doesn't ship — see the README
section "Adding a supported change":

1. a `Change` + `Codemod` in `src/changes/`,
2. registered in `src/changes/index.ts`,
3. a before/after case in `fixtures/`,
4. a test in `tests/`.

`src/matcher/` uses the TypeScript AST via ts-morph — matching logic should
stay AST-based, never regex.

## Guardrails that must never regress

- The AI fixer (`src/fixer/agent.ts`) may edit source only, **never tests**.
  This is enforced in code, not just prompted — any change to the agent's
  tool implementations must keep `tests/ai-fixer.test.ts`'s guardrail test
  green.
- The verifier (`src/verifier/`) always runs the target repo's own,
  unmodified test suite. A red suite must never produce a non-draft PR.

## Definition of Done

Every PR must pass:

```bash
npx tsc --noEmit
npm test
```

(This is the same gate `scripts/dod.sh` enforces for the internal dev
agent — see `CLAUDE.md`.)

## Commit style

[Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): short imperative subject` — types: `feat`, `fix`, `refactor`,
`test`, `docs`, `chore`, `perf`.

## Opening the PR

- Target `main`.
- Describe *why*, not just *what* — the diff already shows what changed.
- Keep it focused: one logical change per PR (e.g. one supported API change,
  or one fix).

## License of your contribution

APIdrift is licensed under the [Business Source License 1.1](./LICENSE)
(BUSL-1.1), converting to Apache 2.0 four years after each release. By
submitting a contribution, you agree it's provided under the same terms,
and you grant the maintainers the rights needed to relicense your
contribution together with the rest of the project at the Change Date (or
under a commercial license, consistent with the project's dual-license
model) — the same arrangement used by other BUSL projects (e.g. Sentry).
If that's not something you can agree to, please open an issue to discuss
before sending a PR.

## Code of Conduct

Participation in this project is governed by our
[Code of Conduct](./CODE_OF_CONDUCT.md).
