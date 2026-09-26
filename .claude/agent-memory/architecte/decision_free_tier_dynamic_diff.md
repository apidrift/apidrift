---
name: decision-free-tier-dynamic-diff
description: Design du Free tier post-EPIC-free-dynamic-diff — VendorSource rend des Change (jamais des Codemod), Vision B (sans clé = détecte et liste), cache en tmpdir, --offline fail-close.
metadata:
  type: project
---

Décisions d'architecture du lot `EPIC-free-dynamic-diff` (US-12→US-16, cadrées
le 2026-09-10). Le Free tier abandonne la bibliothèque de codemods embarquée
comme chemin produit par défaut : diff d'API calculé à la volée depuis le
changelog public, contre le pin résolu localement, fix confié à l'IA de
l'utilisateur (BYOT).

- **`VendorSource` rend des `Change[]`, jamais des `Codemod`.** Un `Codemod` =
  Change + find() + apply() ; le find() d'un change détecté est dérivable par
  `genericSymbolCodemod` et relève de l'AST, donc de `src/matcher/`. Sinon la
  détection dépendrait de ts-morph au cœur de son parsing et ses tests d'un
  `Project`. Câblage : `diff.autoExecutable.map(genericSymbolCodemod)` →
  `RunOptions.codemods`.
- **VISION B (décision humaine du 2026-09-19, US-14) : sans clé API, le CLI
  DÉTECTE et LISTE, ne corrige pas, et sort en code dédié.** Ceci ABROGE deux
  règles du cadrage du 2026-09-10 qu'il ne faut plus recommander : « détection
  SSI un modèle est configuré » et « registre = contenu du mode sans clé ». Le
  no-network est porté par le FLAG `--deterministic-only` (pas par la policy
  d'inférence, qui vaut aussi sans clé), et le listing passe par `planChanges`
  en lecture seule — jamais par `run()`, qui copie le repo avant de constater
  l'absence de LLM.
- **Le registre statique tourne dans TOUS les modes**, pas seulement le mode
  déterministe : `src/cli.ts` le passe en `alwaysRun` à `runPlanned` à chaque
  run (hors cap : il porte un `apply()`, donc coûte 0 token). C'est le tier 1
  de « Deterministic-first ». Il est la *totalité* d'un run seulement sous
  `--deterministic-only`.
- **Le cap coût ne s'applique que si un modèle est résolu.** Sans modèle,
  aucun token n'est dépensable : capper remplacerait la liste — le livrable de
  ce mode — par un refus, et entraînerait à `--yes` par réflexe.
- **Le cap coût (N=5, sur les MATCHÉS) vit dans une passe de plan en lecture
  seule**, entre le walk et `run()`, jamais dans `pipeline.ts`. Piège : filtrer
  les 0-match en amont supprime le garde anti-silence
  `PipelineResult.warning` (commit 78dbfe2) — il faut le reproduire.
- **Cache en `os.tmpdir()`, jamais dans le repo cible** (blast radius : des
  fichiers dans le git status de l'utilisateur) ni dans le repo APIdrift
  (visible ⇒ versionnable ⇒ devient une bibliothèque). Décorateur de `Fetcher`.
- **`--offline` fail-close inconditionnel, même sur cache frais** — sous
  `--offline` le cache n'est pas consulté du tout.

**Why:** le fil conducteur des cinq décisions est le même — rendre
structurellement impossible que le cache redevienne une bibliothèque de fixes,
et qu'un résultat vide se lise comme « rien n'a changé ». Vision B pousse le
même fil un cran plus loin : un utilisateur sans clé ne doit pas lire « rien à
faire » alors que des sites concernés existent. Voir
[[decision-changelog-silent-failures]] pour les modes de panne concrets,
[[decision-walk-channel-line]] pour la règle du walk et
[[decision-cli-exit-codes]] pour le code de sortie que Vision B introduit.

**How to apply:** ces décisions sont écrites en détail dans les
`definition_of_ready` d'US-12→US-16 (`node scripts/board.mjs list`) et dans
`architecture/architecture.json`. Avant de les recommander, vérifier ce qui a
été réellement mergé : au 2026-09-19, US-12 et US-13 sont mergées (aucun
appelant hors tests), US-14/15/16 sont cadrées et non implémentées.
