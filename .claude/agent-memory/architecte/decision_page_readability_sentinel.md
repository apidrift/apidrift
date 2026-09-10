---
name: decision-page-readability-sentinel
description: Comment distinguer « page illisible » de « page sans changement Node.js » sur le changelog Stripe — sentinelle sur le vocabulaire de headings anglais, « Impact » exclu car identique en français.
metadata:
  type: project
---

Sur une page de détail du changelog Stripe récupérée en HTTP 200, la règle qui
sépare « on n'a pas su lire » de « il n'y a légitimement rien pour Node » :

**Une page est réputée LUE ssi elle porte au moins un heading de niveau 2 du
vocabulaire anglais TRADUISIBLE — `What's new` / `Changes` / `Upgrade` /
`Related changes`. `Impact` est EXCLU de la sentinelle : il est identique en
français.** Sinon → gap nommé, portant l'URL.

Mesuré le 2026-09-10 sur les 69 pages Breaking réelles du walk depuis
`2023-08-16` :
- 69/69 portent `## What's new` (apostrophe U+2019) ; 67/69 `## Impact` ;
  36/69 `## Changes` ; 56/69 `#### Node.js`. Onze combinaisons distinctes, un
  vocabulaire fermé de six headings.
- **Piège à ne pas ouvrir** : « `#### Node.js` présent mais rien extrait » est
  un discriminant FAUX. Sur une page sans `## Changes`, ce heading vit sous
  `## Upgrade` et contient de la prose numérotée (« Upgrade your Node SDK to
  v19.1.0 »), pas un tableau de paramètres — 20 faux gaps. Vérifié sur
  `clover/2025-09-30/billing-mode-default-flexible.md`.
- Traduction vérifiée (`Accept-Language: fr`, 3 pages) : Changes→Modifications,
  What's new→Nouveautés, Upgrade→Mise à niveau, Related changes→Modifications
  associées. Corps des tableaux et `#### Node.js` non traduits.

**Why:** sans cette règle, `detectChanges` ne lève que si le *fetcher* lève —
une page française parse à zéro et sort en « rien à faire », le faux négatif
parfait ([[decision-changelog-silent-failures]] mode 1). Mais 33 des 69 pages
n'ont légitimement aucun `## Changes` : en faire une erreur casserait tous les
runs. La sentinelle est le seul point où les deux contraintes se rencontrent.

**How to apply:** c'est une liste littérale de chaînes anglaises, donc elle
périme. Elle est acceptable là où la table de versions d'US-9 était refusée
([[decision-implicit-sdk-pin]]) **parce qu'elle périme en CRIANT** : si Stripe
renomme ses sections, toutes les pages deviennent des gaps → sur-signalement
bruyant, jamais un silence. Toujours juger une table à sa direction d'erreur,
pas à son existence. Calibrage exigé en test : 0 gap sur fixture anglaise,
1 par page sur la même fixture traduite (le scénario N==M d'US-16 sortie 3).
Porté par US-13 AC5/AC5bis.
