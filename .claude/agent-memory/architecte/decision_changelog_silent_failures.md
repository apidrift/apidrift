---
name: decision-changelog-silent-failures
description: Trois modes de panne silencieuse du parsing du changelog Stripe, vérifiés en live — langue, regex de heading, throw sur une page.
metadata:
  type: project
---

Le parsing du changelog Stripe a trois modes de panne qui se lisent comme
« ton repo est à jour ». Vérifiés le 2026-09-10 en exécutant les fonctions du
repo sur le changelog live.

1. **Négociation de langue.** Sans `Accept-Language: en-US`, docs.stripe.com
   sert du français. L'index parse quand même (les colonnes
   `Breaking`/`Non-breaking` ne sont pas traduites — aucun signal), mais sur les
   pages de détail `## Changes` devient `## Modifications` →
   `parseNodeJsChangesTable` rend `[]` → 0 change, sur chaque page, en HTTP 200.
   Unique rempart aujourd'hui : une ligne dans `src/cli.ts` (`httpFetcher`),
   hors de `src/detection/`, non testée. La réponse porte `vary: Accept` mais
   PAS `vary: Accept-Language`.
2. **Regex de heading trop strict.** `RELEASE_HEADING_RE` exige un canal après
   la date, donc ne voit que 41 des 140 releases publiées — invisible : tout ce
   qui précède `2024-09-30.acacia`, dont `2023-08-16`, le pin de
   `fixtures/implicit-pinned-stripe`.
3. **Un throw tue le walk entier.** `extractImpact` throw sans section
   `## Impact` ; la page live `dahlia/2026-03-25/updates-available-checkout-session-ui-modes.md`
   est dans ce cas. Sur 69 pages, la 37e annule les 36 précédentes.

**Why:** APIdrift n'a qu'un rôle, prévenir. Un échec qui se lit « rien à faire »
est le pire résultat possible — même invariant qu'US-9 sur le pin
([[decision-implicit-sdk-pin]]).

**How to apply:** avant de croire un « 0 change », vérifier lequel des trois cas
s'applique. Volumétrie de référence pour juger un résultat : un walk depuis
`2023-08-16` = 27 releases, 69 pages Breaking, dont **35 seulement** ont un
tableau `#### Node.js` — les 34 autres sont valides côté vendor et n'ont
simplement pas de `## Changes`. Donc « zéro tableau exploitable » sur une page
est le cas NORMAL : la fatalité de parse porte sur l'INDEX seul, jamais sur une
page. Voir aussi [[reference-stripe-sourcing]].
