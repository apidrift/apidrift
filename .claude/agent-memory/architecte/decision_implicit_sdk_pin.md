---
name: decision-implicit-sdk-pin
description: US-9 cadrage — le fichier API_VERSION de stripe-node n'existe pas ; la version d'API implicite se lit dans le paquet installé (seuil majeur >= 12 + apiVersion.js), jamais via une table
metadata:
  type: project
---

Cadrage US-9 (DoR écrite 2026-09-05, après un premier cadrage interrompu le
2026-09-03). Suite directe de [[decision-api-version-gating]] : US-7 ferme le
trou du pin **lisible**, US-9 celui du pin **invisible**.

**Faits vendor mesurés le 2026-09-05** (méthode : `npm pack` de 18 versions de
`stripe`, 8.222.0 → 22.6.1, dans un scratch jetable, puis lecture du core
publié — pas la doc, le tarball) :
- **`node_modules/stripe/API_VERSION` n'existe pas.** Ni dans un seul des 18
  tarballs, ni à la racine du dépôt git (raw master → HTTP 404). Homonymes qui
  induisent en erreur : `OPENAPI_VERSION` (v18+, vaut `v2442`, un build de
  spec) et `VERSION` (git seulement, la version du SDK).
- La seule source publiée est le fichier généré **`apiVersion.js`** :
  `lib/apiVersion.js` jusqu'à v11.17, `cjs/` + `esm/` à partir de v11.18. **La
  frontière de chemin ne suit pas le majeur** → sonder les candidats.
- **Le pin implicite commence au majeur 12 exactement.** `cjs/stripe.core.js` :
  `version: props.apiVersion || DEFAULT_API_VERSION`. `DEFAULT_API_VERSION` vaut
  `null` jusqu'en 11.18.0 (aucun en-tête `Stripe-Version` → défaut du compte,
  inconnaissable statiquement) et `apiVersion.ApiVersion` à partir de 12.0.0.
  Les deux sont publiées **le même jour** (2023-04-06, 22 min d'écart) : le
  seuil est le majeur, jamais la date.
- Pièges d'extraction AST : v22 écrit `exports.ApiMajorVersion =
  exports.ApiVersion = void 0;` avant l'affectation réelle (n'accepter que si
  le RHS est un `StringLiteral`) ; `ApiMajorVersion` vaut `'clover'`/`'dahlia'`
  (pas une date) ; le premier littéral du fichier est `'use strict'`.

**Décision : lire le paquet, zéro table.** Les deux fichiers répondent à deux
questions différentes — `package.json` à « ce SDK pose-t-il un pin ? » (un
seuil booléen), `apiVersion.js` à « lequel ? » (valeur lue, jamais dérivée).
Une table SDK→API est une **source de péremption silencieuse** dont le mode
d'échec est précisément le faux négatif muet que le garde existe pour fermer.
Preuve locale que ça dérive : la table proposée par le PO était déjà fausse
deux fois (v12 → il écrivait `2023-04-06`, la date de release du SDK, alors que
la version d'API est `2022-11-15` ; v18 → `2025-03-31` en perdant le canal
`.basil`).

**Règle pour `node_modules` absent : appliquer + divulguer, jamais bloquer,
jamais se taire.** Un clone non installé est le flux normal du tier Free.
Trois inconnues à ne surtout pas fusionner, ni entre elles ni avec « pas de
pin » : `sdk-not-installed` (on n'a pas pu regarder), `sdk-predates-implicit-pin`
(majeur ≤ 11 : on a regardé, le SDK ne pin pas, c'est le défaut du compte),
`sdk-version-unreadable` (hypothèse cassée). Invariant **testé**, pas
seulement intentionnel : aucune sortie ne peut affirmer l'absence de pin dans
un cas où l'on n'a pas pu regarder.

**How to apply :** quand une US arrive avec une conception déjà écrite par le
PO (chemin de module, forme de type, taille de table), aller mesurer l'artefact
réel AVANT d'accepter la premisse — ici le titre entier de l'US portait sur un
fichier inexistant. Et tracer l'écart PO→archi item par item dans la DoR
(retiré / remplacé par / motif), sinon le dev hérite d'une premisse fausse sans
savoir qu'elle a été écartée. Voir [[decision-evidence-before-abstraction]] :
la valeur est *lue à la source*, pas modélisée.
