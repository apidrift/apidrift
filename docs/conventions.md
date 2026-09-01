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

## Nomenclature
Les identifiants d'US (`US-12`) circulent partout — board, branche, commits, PR —
pour que la traçabilité soit continue, du besoin jusqu'à la fusion.
