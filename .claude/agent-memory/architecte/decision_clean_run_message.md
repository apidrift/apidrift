---
name: decision-clean-run-message
description: Le message "repo propre" du CLI (US-17) - prédicat complet, pourquoi skipped inhibe, et pourquoi la décision vit dans une fonction pure et non dans un test sous-processus.
metadata:
  type: project
---

Le message de run propre (`no known API change affects this repo — nothing to fix
(checked N known changes)`, US-17) ne s'affiche que si
`checked > 0 && opened === 0 && warned === 0 && blocked === 0 && skipped === 0`.
`skipped` (src/cli.ts, branche `needsAi` faux) **inhibe** le message ; le cas
`needsAi` (pas de verify ET 0 match) ne l'inhibe pas. N = `results.length`.
La décision vit dans une fonction pure exportée d'un petit module dédié, pas
dans `src/cli.ts` (qui exécute `main()` au chargement) ni dans un test
sous-processus.

**Why:** c'est le pendant du garde-fou 78dbfe2 ([[decision-detection-change-shape]]) :
le silence du terminal est une affirmation. Un repo où on a MATCHÉ des call
sites sans rien appliquer (faute de LLM) n'est pas propre — dire l'inverse
recrée exactement le faux bulletin de santé que 78dbfe2 a supprimé, avec une
cause différente. Inversement, inhiber sur `needsAi` rendrait le message
inatteignable dès qu'un change sans codemod est au registre. Le test
sous-processus (précédent réel : tests/api-version.test.ts,
tests/installed-sdk.test.ts) ne peut PAS atteindre les branches `warned` et
`skipped` sans réseau : le warning n'est émis que pour un codemod sans
`apply()`, donc via `--detect`.

**How to apply:** refuser tout PR qui retire un terme du prédicat « pour que le
message s'affiche plus souvent ». US-14 (détection par défaut) et US-16
(taxonomie de pannes, [[decision-changelog-silent-failures]]) devront RELIRE
cette ligne : elle ne doit jamais s'afficher quand la détection a échoué
silencieusement. Couleur verte ou neutre, jamais rouge/ambre — ces deux couleurs
appartiennent aux warnings et au cas `pinned-api-version`
([[decision-api-version-gating]]).
