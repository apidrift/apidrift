---
name: decision-cache-vs-nplus1
description: Un N+1 intra-run n'est jamais un problème de cache — arbitré vers US-13 (walk), pas US-15 (cache) ; et le test de comptage doit précéder le cache.
metadata:
  type: project
---

`changesSince` appelait `releases()` (1 fetch de l'index) puis `detectChanges`
par release, et `detectChanges` refetche l'index à chaque fois
(`src/detection/index.ts`) : 28 fetchs d'un document de 204 776 octets pour un
walk de 27 releases. Arbitré le 2026-09-10 : **c'est US-13 (AC6), pas US-15.**

- Cache et N+1 sont deux problèmes distincts : le cache adresse la même URL
  entre deux **runs**, le N+1 la même URL 28 fois **dans** un run.
- Un cache qui absorbe un N+1 intra-run fait le travail d'une correction de
  bug, et il le fait mal : 27 lectures disque + 27 re-parsings de 200 Ko
  subsistent.
- US-15 est priorité 3 et rien ne garantit qu'elle précède US-14, qui fait du
  walk le chemin **par défaut** — sinon 28 requêtes d'index par run chez tout
  utilisateur, avec un rate-limiting qui sortirait en « fetch KO » : une panne
  fabriquée par nous.

**Why:** la vraie correction est un passage de paramètre (le walk a déjà
l'index parsé en main et le jette), pas un module. Et laisser le N+1 rendrait
malhonnête l'AC5 d'US-15 (« supprimer le cache n'a d'autre effet que la
latence » — facteur 28 sur l'index).

**How to apply:** règle générale — avant d'accepter « le cache réglera ça »,
demander si le coût est intra-run ou inter-run. **Corollaire d'ordonnancement :
le test qui COMPTE les appels du fetcher par URL doit exister AVANT le cache.**
Une fois `cachingFetcher` branché, un N+1 redevient invisible (1 fetch réseau,
27 lectures de cache) et le test ne peut plus rougir. Même famille de piège que
[[decision-changelog-silent-failures]] : un défaut masqué par une couche qui a
l'air d'aider. Voir [[decision-free-tier-dynamic-diff]] pour le rôle du cache.
