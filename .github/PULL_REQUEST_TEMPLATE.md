## What & why

<!-- What changed, and why. The diff already shows what — focus on why. -->

## Checklist

- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] If this adds a supported API change: it ships as all four pieces
      (`Change`+`Codemod` in `src/changes/`, registered in
      `src/changes/index.ts`, a fixture case, a test) — see `CONTRIBUTING.md`.
- [ ] If this touches `src/fixer/agent.ts` or `src/verifier/`: the guardrail
      tests (`tests/ai-fixer.test.ts`, `tests/pipeline.test.ts`) still pass —
      tests stay read-only to the fixer, and a red suite never yields a
      non-draft PR.
- [ ] I agree this contribution is licensed under the terms in
      `CONTRIBUTING.md` § License of your contribution.

## Related issue

<!-- Fixes #... / Refs #... -->
