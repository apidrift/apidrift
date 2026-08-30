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

## License of your contribution, and sign-off (DCO)

APIdrift is licensed under the [Apache License 2.0](./LICENSE). By
submitting a contribution, you agree it's provided under the same terms.

We use the lightweight [Developer Certificate of
Origin](https://developercertificate.org/) instead of a separate CLA:
please sign off every commit (`git commit -s`, which adds a
`Signed-off-by: Your Name <you@example.com>` trailer) to certify that you
wrote the contribution or otherwise have the right to submit it. This is
what makes it safe for the maintainers to keep reusing your contribution
across this Apache-2.0 codebase and, unmodified or as a base, in
APIdrift's separate closed-source Pro/Enterprise offerings — Apache-2.0
already permits that reuse, the DCO just keeps provenance on record.

## Code of Conduct

Participation in this project is governed by our
[Code of Conduct](./CODE_OF_CONDUCT.md).
