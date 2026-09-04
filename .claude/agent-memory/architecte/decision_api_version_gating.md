---
name: decision-api-version-gating
description: US-7 cadrage — a Change fondé sur un changelog versionné ne s'applique pas à une cible épinglée avant lui ; où brancher le garde, comment comparer les versions Stripe, et la règle du sens de l'erreur
metadata:
  type: project
---

Cadrage US-7 (DoR écrite 2026-09-03). Origine : US-6 a prouvé sur
`agnaistic/agnai` qu'un run **vert** peut livrer un fix **faux**. Le codemod
subscription a migré du code correct parce que le repo épingle
`new Stripe(key, { apiVersion: '2023-08-16' })`, antérieur au changelog
`2025-03-31.basil` qui fonde le change.

**La règle qui structure tout : le sens de l'erreur.** Élargir la
reconnaissance d'un client vendor dans le **matcher** élargit ce qui est
*édité* (plus risqué) ; l'élargir dans un **garde** élargit ce qui est *bloqué*
(plus sûr). Les deux ne peuvent donc pas partager la même politique de
fail-closed. Conséquence posée : `resolveRootToVendor` (src/matcher/symbol.ts)
n'est PAS élargi par US-7 ; le finder large vit dans un module séparé
(`src/matcher/api-version.ts`) et ne sert que le garde. Corollaire mesuré au
prototype : la primitive existante ne reconnaît PAS
`const Stripe = require('stripe')`, `const { Stripe } = require('stripe')`, ni
`import * as S from 'stripe'` + `new S.Stripe(...)` — étroitesse acceptable
côté matcher, trou silencieux côté garde.

**Faits vendor vérifiés 2026-09-03** (sourcing : [[reference-stripe-sourcing]]) :
- format d'une version = `YYYY-MM-DD` + suffixe de canal OPTIONNEL
  (`acacia`/`basil`/`clover`/`dahlia`/`preview` ; rien avant Acacia).
- comparer **les 10 premiers caractères uniquement**. Comparer la chaîne
  entière est faux : `.preview` est un canal *parallèle* à la même date, et
  l'ordre alphabétique des noms de release est une coïncidence, pas un contrat.
- **le piège principal** : depuis `stripe-node` v12, l'absence d'option
  `apiVersion` ne veut PAS dire « dernière version » — le SDK épingle
  implicitement la version courante au moment de sa propre release.
  Donc « aucun pin trouvé dans l'AST » ≠ « pas de pin ». Ce trou est traité par
  US-9 — mécanisme exact et seuil mesurés dans [[decision-implicit-sdk-pin]].

**Fail-safe ≠ tout bloquer.** AC2 conditionne le refus à « détectable ET
antérieure ». Un `apiVersion` non lisible (variable d'env, spread, shorthand)
→ on applique et on **divulgue**, parce que bloquer sur toute config par
environnement tuerait l'outil sur la majorité des repos, de façon invisible.

**« Pas de régression silencieuse dans les deux sens »** — le sens 2 est le
moins évident et le plus dangereux : un change bloqué sans affichage laisse
lire « 0 pull requests » et conclure que le code est propre. Fait à corriger :
`src/cli.ts` incrémente un compteur `skipped` qu'il n'imprime jamais. Rendre
visible sans bruit = un bloc CLI dédié pour le blocage, et **une seule ligne**
dans la section existante de `PR.md`, émise seulement si le change porte une
`apiVersion`.

**Where the guard goes : le pipeline**, entre `matches.length === 0` et la
création de branche. Pas le matcher (confondrait « ton code n'utilise pas ça »
et « ça ne te concerne pas », et il faudrait le dupliquer dans chaque `find()`),
pas le fixer (trop tard, la branche existe, et un refus y ressort en `diff
vide` → `applied:false`, indistinguable du garde-fou de l'agent).

**How to apply :** sur toute US touchant la justesse d'un fix, se demander
d'abord *quelle direction d'erreur* le composant a, puis seulement ensuite
quelle donnée manque au modèle `Change`. Le champ ajouté ici (`apiVersion?`,
absent = non gaté) reste conforme à [[decision-evidence-before-abstraction]] :
un champ optionnel dont la valeur est *lue à la source* (le heading
`<date>.<canal>` du changelog, déjà parsé par `src/detection/`), pas un enum
élargi. La méthode du prototype ts-morph jetable dans `/tmp` a de nouveau payé :
elle a révélé les 3 formes de client non reconnues et le piège
`ShorthandPropertyAssignment`.
