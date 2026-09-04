---
name: feedback-board-writes
description: board.json, backlog.json et architecture.json ne s'écrivent que depuis le checkout principal, jamais depuis un worktree de feature
metadata:
  type: feedback
---

`board/board.json`, `board/backlog.json` et `architecture/architecture.json` sont
des **fichiers de pilotage partagés**, pas du code produit. Ils ne s'écrivent que
depuis le **checkout principal**, par l'orchestrateur. Aucun agent isolé dans un
worktree de feature ne les touche — ni à la main, ni via `scripts/board.mjs`.

**Pourquoi :** un worktree de feature est forké du `main` d'un instant t. Le
board qu'il contient est un **instantané périmé**. Y écrire un event produit un
fichier qui contient la nouvelle ligne *et* qui a perdu tout ce qui a été
journalisé sur `main` depuis le fork ; le merge de la branche fait alors **reculer
le board en silence**, sans conflit git pour le signaler.

**Deux occurrences, même cause racine :**
- US-3 (2026-09-01) : référentiel divergent entre le worktree et `main`.
- US-8 (2026-09-04, event 380) : `dev#5` a exécuté `board.mjs` depuis son
  worktree forké de `05b61e4`. Le commit `b26635a` embarquait dans la PR #11 un
  board sans les events d'US-7 ni la DoR d'US-8 posée par l'architecte. Rattrapé
  par le revert `67331ef`, **avant** merge — par chance, pas par contrôle.

**Comment appliquer :**
- **dev** : ce que tu veux voir journalisé (`peer_message`, écart, escalade) part
  dans ton **rapport** à l'orchestrateur. Il journalise depuis le checkout
  principal. Ne lance pas `scripts/board.mjs` depuis un worktree.
- **qa** : avant tout merge, vérifier que
  `git diff main...<branche> -- board/ architecture/` est **VIDE**. Non vide =
  bloquant, la branche est nettoyée avant fusion. C'est le contrôle qui manquait
  aux deux occurrences.
- **orchestrateur** : seul écrivain de ces fichiers, toujours depuis `main`.

Les écarts au cadrage remontent par le champ `ecarts` du rapport — voir
[[feedback-ecarts-cadrage]] — précisément pour que le dev n'ait jamais besoin
d'écrire sur le board.
