---
name: feedback-ecarts-cadrage
description: Le dev déclare chaque écart au cadrage dans le champ `ecarts` du rapport ; la QA rend un verdict par écart
metadata:
  type: feedback
---

Un écart au cadrage de l'architecte **déclaré** est un livrable, pas une faute.
L'écart **silencieux**, lui, en est une.

**Protocole :**
- Le **dev** déclare tout écart au cadrage dans le champ dédié `ecarts` de son
  rapport (`board/schema/report.schema.json`) : un objet **par écart**, avec
  `quoi` et `justification`. Un par un, jamais un compteur, jamais un paragraphe
  qui en agrège plusieurs — chacun doit pouvoir être arbitré séparément.
- La **QA** rend un **verdict par écart**, pas un verdict global :
  - `acceptable` — l'écart est justifié, on continue ;
  - `acceptable avec réserve` — on accepte et on ouvre une entrée de backlog ;
  - `bloquant` — renvoi au dev avec l'obstacle.
- L'**orchestrateur** journalise les écarts et leurs verdicts depuis le checkout
  principal (le dev n'écrit pas sur le board — voir [[feedback-board-writes]]).

**Pourquoi :** sur US-7 et US-9, le dev a déclaré **10 écarts** au total ; la QA
les a arbitrés **un par un** et les a **tous acceptés** (dont un « acceptable
avec réserve » renvoyé au backlog : la phrase produite pour un vendor non-Stripe
était malhonnête mais sur un chemin inatteignable). Le mécanisme fonctionnait —
mais **aucun champ de rapport ne le portait**. Chaque agent improvisait son nom :
`ecarts_dor` (US-7), `ecarts_cadrage` (US-9, réduit à un simple **compteur `7`**,
donc inarbitrable en l'état), `ecarts_dor_arbitres` côté QA. Un champ formel
rend la déclaration attendue plutôt qu'astucieuse, et l'arbitrage traçable.

**Ce que ça protège :** le cadrage architecte reste opposable sans devenir un
carcan. Le dev qui trouve mieux sur le terrain le dit ; il n'a ni à obéir à un
cadrage faux, ni à s'en écarter en douce.
