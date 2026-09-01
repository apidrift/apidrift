---
name: feedback-arch-doc-tracks-code
description: Constraints in architecture/architecture.json must be dated facts verified in the code, never intentions or speculative scoping
metadata:
  type: feedback
---

Every entry in a component's `constraints[]` in `architecture/architecture.json`
must be a **fact read from the code**, anchored to the US/PR that made it true.
Never write a constraint about a change that is merely scoped, and when a US
lands, re-read the delivered diff and convert "DÉFAUT CONNU, à corriger dans
US-X" / "LIMITE NON exercée" into what actually happened ("CORRIGÉ en US-X",
"LIMITE LEVÉE en US-X").

**Why:** after US-3, `architecture.json` carried three false claims at once
(`Match.node` still typed `CallExpression`, a `fixtures/shopfront-checkout` that
never existed, a fixed `PR.md` artifact name). They came from writing
constraints at *scoping* time about a change whose scoping was later abandoned.
A false architecture doc is worse than a thin one — the next agent designs
against it.

**How to apply:** on any US-closing or doc-realignment task, read the delivered
branch/PR before editing (`git diff main...HEAD --stat`, then the touched
sources) and cite the file that proves each constraint. Correct only what is
factually false; don't reword what is still true and don't add speculative
constraints to "be safe". When a scoping is abandoned, remove its traces rather
than leaving them as future intent — see
[[decision-evidence-before-abstraction]].
