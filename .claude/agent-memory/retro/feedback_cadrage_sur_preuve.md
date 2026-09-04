---
name: feedback-cadrage-sur-preuve
description: Un critère d'acceptation qui nomme un artefact vendor n'atteint le dev qu'après vérification par l'architecte sur l'artefact réel
metadata:
  type: feedback
---

Un critère d'acceptation ou une prescription de conception qui **nomme un
artefact vendor** — chemin de fichier dans un paquet, contenu d'un fichier, table
de correspondance de versions — n'est transmis au dev qu'**après vérification par
l'architecte sur l'artefact réel** : tarball `npm pack`, paquet installé, source
publiée. Jamais sur la doc du vendor seule, jamais sur la mémoire, jamais sur le
souvenir d'un agent.

**Corollaire :** préférer **lire l'artefact** à maintenir une table. Une table de
correspondance codée en dur périme **silencieusement** — le vendor publie, la
table ne bronche pas, et le fix devient faux sans qu'aucun test ne rougisse.

**Pourquoi :** sur US-9, le cadrage nommait un fichier `API_VERSION` dans
`stripe-node` et fournissait une table SDK → version d'API. Vérification par
`npm pack` sur 18 tarballs (event 435) : le fichier `API_VERSION` **n'existe
pas**, et la table était fausse **2 fois sur 7** (v12 = `2022-11-15`, pas
`2023-04-06` ; v18 perdait le canal `.basil`). Coût : une session entière —
architecte tué avant journalisation (event 416), reprise à zéro (event 432) —
au lieu d'une correction. La conclusion retenue est dans
[[decision-implicit-sdk-pin]] : lire `apiVersion.js` + seuil majeur ≥ 12, jamais
une table.

**Frontière PO / architecte :**
- Le **PO** pose le **besoin** et l'**invariant** ("ne pas appliquer un fix à une
  cible épinglée sur une version antérieure au change").
- Il ne pose **pas la conception** : chemin de module, forme du type, taille et
  contenu d'une table de correspondance. Un cadrage PO qui descend à ce niveau
  ressemble à de la précision et n'est qu'une **prémisse non vérifiée**.
- L'**architecte** tranche sur preuve, cite l'artefact ouvert, et c'est cette
  version-là qui atteint le dev.

Même logique que [[feedback-arch-doc-tracks-code]] : ce qu'on transmet à
l'aval doit être un **fait daté et vérifié**, pas une intention.
