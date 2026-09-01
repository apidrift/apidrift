#!/usr/bin/env bash
# Petit wrapper pour journaliser un événement depuis un hook ou un agent.
# Usage : bash scripts/hooks/log-event.sh <type> <actor> <item_id> "<note>"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
node "$ROOT/scripts/board.mjs" event \
  --type "${1:-note}" --actor "${2:-unknown}" --item "${3:-}" --note "${4:-}"
