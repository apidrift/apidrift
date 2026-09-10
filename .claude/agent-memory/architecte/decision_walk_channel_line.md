---
name: decision-walk-channel-line
description: Le walk de plage doit filtrer par ligne de canal (.preview = ligne parallèle) ; la règle US-7 des 10 caractères ne se transpose PAS du garde au walk.
metadata:
  type: project
---

Un walk de releases Stripe doit exclure le canal `.preview` sauf si la borne
basse est elle-même `.preview`. Toute autre release (acacia/basil/clover/dahlia
ou heading sans canal) appartient à la ligne stable.

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
