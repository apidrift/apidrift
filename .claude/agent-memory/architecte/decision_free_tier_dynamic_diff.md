---
name: decision-free-tier-dynamic-diff
description: Design du Free tier post-EPIC-free-dynamic-diff — VendorSource rend des Change (jamais des Codemod), registre réaffecté au mode déterministe, cache en tmpdir, --offline fail-close.
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
- **Le registre statique n'est pas mis au placard, il est réaffecté** : contenu
  exact du mode `--deterministic-only` (donc de tout run sans clé API) et
  fixture de CI. Règle : détection SSI un modèle est configuré — un change
  détecté n'a pas d'`apply()`, fetcher pour aboutir à 100 % de skips serait du
  gaspillage. Le repli est légitime mais doit être ÉNONCÉ.
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
et qu'un résultat vide se lise comme « rien n'a changé ». Voir
[[decision-changelog-silent-failures]] pour les modes de panne concrets et
[[decision-walk-channel-line]] pour la règle du walk.

**How to apply:** ces décisions sont écrites en détail dans les
`definition_of_ready` d'US-12→US-16 (`node scripts/board.mjs list`) et dans
`architecture/architecture.json`. Avant de les recommander, vérifier ce qui a
été réellement mergé : au 2026-09-10 rien n'est implémenté, tout est cadré.
