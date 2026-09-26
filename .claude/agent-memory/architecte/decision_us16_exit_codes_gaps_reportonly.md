---
name: decision-us16-exit-codes-gaps-reportonly
description: US-16 re-cadrage 2026-09-26 — exit code of "unread pages" and "report-only only" runs is an OPEN product question; index-row sentinel is fatal (settled); live facts behind it.
metadata:
  type: project
---

US-16 re-cadrée le 2026-09-26 après merge US-13/US-14 : verdict NOT READY sur deux arbitrages produit, remontés à l'humain.
- A : code de sortie quand gaps > 0 (pages illisibles). Reco architecte A3 : 0 si N<M, 1 si N==M>0.
- B : code quand seuls des forme #2 (report-only) sont détectés. Reco B1 : 0, en reformulant "0 = nothing left to do" dans l'aide/CLAUDE.md.

**Why:** CLAUDE.md définit 0 = "nothing left to do", ce que (3) et (5) contredisent ; mais la page live `dahlia/2026-03-25/updates-available-checkout-session-ui-modes.md` n'a toujours pas de `## Impact` (vérifié 2026-09-26) → gap PERMANENT sur quasi tout walk, donc "gaps>0 ⇒ non-zéro" rendrait la CI Free rouge en permanence. Les forme #2 ne sont pas matchés contre le repo, donc 20 ("affecte ce repo") ne s'y applique pas.

Tranché sans humain (même règle que AC2 + décision humaine 3 "fail-loud partout") : sentinelle de lignes d'index (≥1 heading, 0 ligne classable) = fatale exit 1. Mesure live 2026-09-26 : 877/877 lignes classables en en-US ET en fr — le tableau d'index n'est pas traduit ; le scénario "index français" de la QA US-13 est synthétique.

Piège retenu : lors du re-cadrage du 2026-09-10, j'ai écrasé AC5 avec le doublon d'AC4 (un patch `acceptance_criteria` remplace la liste entière). **How to apply:** avant tout `board.mjs update` sur `acceptance_criteria`, comparer la liste des IDs avant/après.

Relié : [[decision-cli-exit-codes]], [[decision-changelog-silent-failures]], [[decision-page-readability-sentinel]].
