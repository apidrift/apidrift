#!/usr/bin/env bash
# Hook SubagentStop : porte Definition of Done déterministe.
# Lit l'entrée JSON du hook sur stdin (ignorée ici), lance scripts/dod.sh.
# Exit 2 = bloque la complétion de l'agent et lui renvoie le message d'erreur.

cat >/dev/null  # consomme l'entrée JSON du hook

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if bash "$ROOT/scripts/dod.sh"; then
  # Journalise la porte franchie (trace).
  node "$ROOT/scripts/board.mjs" event --type gate --actor dod --note "DoD ok" >/dev/null 2>&1 || true
  exit 0
else
  echo "Porte DoD échouée : les tests/lint ne passent pas. Corrige avant de rapporter 'done'." >&2
  node "$ROOT/scripts/board.mjs" event --type gate --actor dod --note "DoD échouée" >/dev/null 2>&1 || true
  exit 2
fi
