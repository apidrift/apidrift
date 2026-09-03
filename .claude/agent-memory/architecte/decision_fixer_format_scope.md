---
name: decision-fixer-format-scope
description: Le fixer tier 1 formate la plage AST éditée (Node#formatText), jamais le fichier entier — et ts-morph expose bien le formatage à la plage
metadata:
  type: project
---

Décision d'architecture US-8 (2026-09-03) : le tier 1 du fixer formate la plage
AST réellement éditée via `Node#formatText(settings)` (appelé sur le nœud de
chaque `Match`), jamais `SourceFile#formatText()`. Fallback si le nœud est
oublié : plus proche ancêtre `Statement` capturé AVANT `apply()` ; sinon ne rien
formater. **Jamais** de fallback fichier-entier.

**Why:** le formatage fichier-entier viole « blast radius only » et a fait
basculer une PR par ailleurs correcte en draft sur `feross/studynotes.org`
(US-6) en réveillant le linter `standard` du repo cible. Mesuré au cadrage sur
le vrai fichier au SHA épinglé : fichier-entier → `standard` exit 1 (6 erreurs) ;
plage AST → exit 0, findings identiques à l'original ; **aucun formatage** →
exit 1 aussi (2 erreurs `indent`, car `addPropertyAssignment` indente mal) —
donc « laisser les codemods émettre du texte bien formé » est réfuté par la
mesure, pas par avis.

**How to apply:** deux faits à ne pas réapprendre.
1. `docs/proof/US-6/feross-studynotes.org/README.md` affirme que « ts-morph's
   public API doesn't expose range-scoped formatting » — **c'est faux**.
   ts-morph 24.0.0 : `Node#formatText` (`ts-morph.d.ts:3852`) délègue à
   `languageService.getFormattingEditsForRange`, et
   `LanguageService#getFormattingEditsForRange` + `SourceFile#applyTextChanges`
   sont publics si la plage brute est un jour nécessaire.
2. Les deux tiers du fixer n'ont pas le même mécanisme d'écriture : tier 1 passe
   par ts-morph et est le seul à formater ; tier 2 fait `fs.writeFileSync` du
   fichier entier rédigé par l'agent et son blast radius est borné par
   l'ensemble `editableFiles`, pas par un formateur. Ne jamais « harmoniser » en
   ajoutant un formatage au tier 2 : c'est un problème distinct.

Un dérapage de formatage constaté sur un repo réel est donc, par défaut, un
défaut du tier 1. Voir [[feedback-arch-doc-tracks-code]] avant de convertir la
contrainte `fixer` en « CORRIGÉ en US-8 » : lire le diff livré d'abord.
