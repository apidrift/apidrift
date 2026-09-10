---
name: decision-walk-channel-line
description: Ligne stable = « tout ce qui ne finit pas par .preview », ordonné par date — jamais « même canal », jamais une liste ordonnée de canaux ; la règle US-7 des 10 caractères ne se transpose PAS du garde au walk.
metadata:
  type: project
---

Un walk de releases Stripe doit exclure le canal `.preview` sauf si la borne
basse est elle-même `.preview`. Toute autre release (acacia/basil/clover/dahlia
ou heading sans canal) appartient à la ligne stable.

**Les deux formulations FAUSSES, toutes deux rencontrées en vrai (2026-09-10) :**
1. « même canal que la borne » (`channelOf(release) === channelOf(from)`) —
   c'est ce qu'US-12 a livré. Depuis `2023-08-16` le walk s'arrête à
   `2024-06-20` : 3 releases / 14 pages au lieu de 27 / 69, et rate les 25
   changes forme #1 concentrés sur `2025-03-31.basil`. Effet pervers : il fait
   « marcher » l'exclusion de preview par accident, donc elle disparaît en
   silence dès qu'on corrige la continuité — d'où l'exigence d'une condition
   nommée + test de mutation.
2. « un modèle de ligne ordonnée de canaux » (legacy → acacia → basil →
   clover → dahlia) — proposé en revue QA, REFUSÉ : c'est la table à péremption
   silencieuse de [[decision-implicit-sdk-pin]], et elle est **inutile**.
   Vérifié sur les 140 headings : la ligne stable est strictement monotone en
   DATE (123 headings non-preview, 5 segments successifs sans entrelacement),
   donc trier par `apiVersionDate()` produit la même séquence sans rien à
   maintenir.

**Why:** mesuré le 2026-09-10 sur le changelog live. Repo épinglé
`2026-03-25.dahlia` (pin implicite de stripe-node v21, repo sain) : walk naïf à
la règle US-7 (date seule) = 20 changements Breaking, tous issus de `.preview` ;
walk conscient du canal = 0. Signal/bruit 0/20. La règle « comparer les 10
premiers caractères, aucune logique de canal » (voir
[[decision-api-version-gating]]) reste JUSTE pour le garde — ignorer le canal y
produit au pire un blocage manquant, direction conservatrice — et devient FAUSSE
pour le walk, où ça produit des éditions. Même comparaison, sens de l'erreur
opposé.

**How to apply:** ne jamais uniformiser les deux. La logique de canal vit dans
`src/detection/walk.ts` ; `apiVersionDate`/`isPinnedBefore`/`oldestApiVersion`
(`src/changes/api-version.ts`) restent purs et inchangés. Ne PAS écrire une
liste de canaux stables en dur (`['acacia','basil','clover','dahlia']`) : ce
serait la table à péremption silencieuse déjà refusée en US-9, voir
[[decision-implicit-sdk-pin]]. La seule chaîne littérale légitime est
`'preview'` — un canal futur tombe alors par défaut dans la ligne stable, ce qui
est le comportement voulu. Structure vérifiée qui rend la règle sûre : aucune
date ne porte plus d'un heading non-preview, aucune date n'est preview-seule.
Corollaire : le change utilisé par le spike `docs/proof/spike-dynamic-diff-stripe`
est un change `.preview` — le mécanisme est prouvé, le canal ne l'est pas.
