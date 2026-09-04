# Conventions Git

Simple et standard. `main` est la branche longue ; tout le travail se fait sur
des branches feature fusionnées par PR.

## Branches
- `main` : intégrable en continu.
- `feature/<US-ID>-<slug>` : une branche par US. Ex. `feature/US-12-connexion`.

## Commits — Conventional Commits
`type(scope): sujet court à l'impératif`, puis référence l'US.

```
feat(auth): verrouillage après 3 échecs

Refs: US-12
```

Types : `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.

## Pull Requests
- Titre : `<US-ID> <titre de l'US>`. Ex. `US-12 Connexion utilisateur`.
- Cible : `main`. Fusion après passage de la porte DoD (tests + lint verts) et de
  la revue de l'agent QA.
- La description reste terse : le lien vers l'US et les critères couverts.

## Fichiers de pilotage — jamais depuis un worktree

`board/board.json`, `board/backlog.json` et `architecture/architecture.json` ne
s'écrivent **que depuis le checkout principal**, par l'orchestrateur. Un worktree
de feature en contient un instantané forké d'un `main` périmé : y écrire fait
reculer le board au merge, en silence, sans conflit git pour le signaler.

**Contrôle avant merge, bloquant :**

```
git diff main...<branche> -- board/ architecture/   # doit être VIDE
```

Non vide → la branche est nettoyée avant fusion. C'est le contrôle qui a manqué
deux fois (US-3 le 2026-09-01, US-8 le 2026-09-04 — rattrapé par le revert
`67331ef`). Ce que le dev veut voir journalisé passe par son rapport ; les écarts
au cadrage par le champ `ecarts` de `board/schema/report.schema.json`, arbitrés
un par un par la QA.

## Nomenclature
Les identifiants d'US (`US-12`) circulent partout — board, branche, commits, PR —
pour que la traçabilité soit continue, du besoin jusqu'à la fusion.
