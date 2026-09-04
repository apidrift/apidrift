---
name: project-portes-humaines-sans-lavish
description: lavish-axi est absent du PATH sur ce poste ; les portes humaines passent par le board + un texte direct
metadata:
  type: project
---

`lavish-axi` n'est **pas installé** sur ce poste — 4 confirmations tracées
(events 438, 465, 475 et le commit `7bde2c4`). Les agents du socle
(`orchestrateur`, `po`, `architecte`, `qa`) référencent pourtant `lavish-axi
<fichier>` comme moyen d'ouvrir une porte humaine.

**Comment faire en attendant :** ouvrir la porte quand même, sans bloquer —
`event --type gate` sur le board qui dit ce qui est attendu de l'humain, plus la
présentation **en texte direct** dans la réponse. Un artefact HTML posé dans
`/tmp` reste utile pour une démo (US-9 : `/tmp/apidrift-us9-demo.html`), mais il
n'a pas d'emplacement conventionnel dans le repo — candidat connu pour une
future US de tooling.

Ne pas re-tester `lavish-axi` à chaque porte : c'est un fait d'environnement
stable, pas un incident. Le retour humain est récupéré empilé, journalisé en
`human_feedback`, et le flux continue sur les autres US pendant ce temps.
