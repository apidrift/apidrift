---
name: decision-detection-change-shape
description: Architecture decision for US-2 detection — the changelog link URL classifies a change as request-shaped (generic matcher OK) or response-shaped (needs a hand-written codemod)
metadata:
  type: project
---

Cadrage US-2 (DoR écrite 2026-09-01). La limite AC8 d'US-3 — « un `find()`
générique piloté par `target.symbol` n'est faisable que là où le symbole EST le
nœud édité » — a un **discriminant machine-vérifiable dans la source de
détection elle-même**, ce qui la rend opérationnelle plutôt que théorique :

Dans le tableau `#### Node.js` de la section `## Changes` d'une page de détail
changelog, la cellule *Resources or methods* contient des liens. C'est le
**chemin d'URL** qui tranche (jamais le texte du lien, spécifique au SDK) :
- `/api/<resource>/<method>` → change côté **requête**, le nœud affecté EST le
  `CallExpression` → forme #1 → matcher générique faisable.
- `/api/<resource>/object` (ou ancre `#<resource>_object-<field>`) → change côté
  **réponse** → forme #2 → infaisable sans les deux champs `Change` manquants.
- chemin imbriqué (`Invoice#create_preview.schedule_details.phases[]`) → exclu.

Vérifié sur sources réelles : la page du change #2 ne pointe que `/object`
(cohérent avec ses ~25 lignes de `find()` manuel) ; `deprecate-singular-coupon-
promotion-code.md` porte les deux formes dans la même page.

**Why:** ça permet au poller de décider seul ce qu'il a le droit d'injecter dans
`run(dir, { codemods })`, sans humain et sans élargir le modèle `Change` — voir
[[decision-evidence-before-abstraction]].

**How to apply:** toute US de détection doit classer avant d'injecter. Deux
faits durs qui vont avec :
- Le changelog couvre les changements de **version d'API**, pas les
  dépréciations produit/SDK : le change #1 du registre (charges → paymentIntents)
  n'y figure pas, sa source est un guide de migration. Une détection par
  changelog ne peut pas redécouvrir les changes existants.
- Un `Change` détecté n'a pas d'`apply()` → tier 2 IA. Or `migration.detail` et
  `references[0]` alimentent à la fois `src/pr.ts` et le prompt de
  `src/fixer/agent.ts` : `detail` est la seule instruction que voit le fixer,
  il doit être auto-suffisant (paragraphe « ## Impact » verbatim).

**Blast radius — prérequis dur :** les deux `find()` du registre n'exploitent
que les 2 derniers segments de `target.symbol` (`db.subscriptions.retrieve()`
matche). Mineur sur 2 symboles relus par un humain, **disqualifiant** pour un
matcher générique nourri par un poller. Règle posée : résoudre la racine
jusqu'au module vendor via l'AST ; racine non résoluble = pas de match.

Sourcing des pages : [[reference-stripe-sourcing]].
