---
name: decision-cli-exit-codes
description: Contrat de codes de sortie du CLI APIdrift — 0/1 historiques, 20 = dérive détectée non corrigée, plage 20-29 réservée aux verdicts sémantiques.
metadata:
  type: project
---

Arbitré le 2026-09-19 en cadrage d'US-14 (Vision B : sans clé API le CLI
détecte, liste, ne corrige pas, et sort non nul).

- `src/cli.ts` n'émettait que **0** (succès, `--help`, `--version`) et **1**
  (toutes les erreurs, y compris le cap breach). Vérifier ce fait avant de
  citer cette mémoire : `grep -n "process.exit" src/cli.ts`.
- **20 = « dérive détectée, sites trouvés, aucun fix produit faute de modèle
  configuré »**. Plage **20-29 réservée** aux verdicts sémantiques d'APIdrift
  (US-16 peut y allouer ses propres codes au lieu de tout ramener à 1).
- Pourquoi pas 2 : bash le réserve (builtin misuse) et surtout la convention
  grep/semgrep/diff est « 1 = résultats, 2 = erreur » — or ici **1 est déjà
  l'erreur**, donc 2 inverserait la lecture. Pourquoi pas 3-13 : codes internes
  documentés de Node, un plantage de Node doit rester distinguable d'un verdict.
  Pourquoi pas 64-78 : sysexits BSD. Pourquoi pas 126/127/128+N/255 : shell et
  signaux. La bande 14-63 est libre.
- **Règle de composition** : un échec qui ARRÊTE le run sort 1 et prime
  toujours ; un code 20-29 est le verdict d'un run COMPLET. Le cap breach (1)
  et le 20 sont mutuellement exclusifs par construction — le cap ne s'applique
  que si un modèle est résolu, le 20 seulement s'il n'y en a pas.
- Un test doit assertir la **valeur numérique** (`strictEqual(r.status, 20)`),
  jamais « non nul ».

**Why:** un code de sortie est une API publique scriptée par les CI des
utilisateurs ; « non nul » ne se teste pas et ne se documente pas. Et le
silence d'un exit 0 sur une dérive détectée est exactement le faux « rien à
faire » que tout l'EPIC existe pour fermer.

**How to apply:** ne jamais élargir 20 aux situations qui sortent 0 aujourd'hui
(change bloqué par pin, draft sur suite rouge, warning anti-silence) — quatre
tests de sous-processus assertent ces 0. Voir
[[decision-free-tier-dynamic-diff]] et [[decision-clean-run-message]].
