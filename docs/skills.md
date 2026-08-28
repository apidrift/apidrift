# Claude Code skills — roster

Skills encode the tasks we repeat every time we support a new vendor change.
Not yet authored; this is the plan. Core first.

## Core

- **change-record** — scaffold a normalized `Change` from a Stripe changelog /
  spec-diff entry, in the schema in `src/types.ts`.
- **astgrep-rule** — write and validate the AST matcher for one usage pattern,
  with its fixture. (Highest-frequency task.)
- **codemod-fix** — write the deterministic transform for a matched pattern,
  with a before/after fixture and test.
- **pr-body** — compose the PR body in the house format (see `src/pr.ts`).

## Support

- **fixture-repo** — generate a realistic JS/TS repo using a given old pattern,
  to test the pipeline end to end.
- **adr** — write a short architecture decision record.

## Slash command idea

- `/add-change` — chains change-record → astgrep-rule → codemod-fix →
  fixture-repo into one pass. This is "support a new change" as one command.
