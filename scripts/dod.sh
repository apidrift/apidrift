#!/usr/bin/env bash
# Definition of Done — SEUL fichier à adapter à ta pile.
# Doit sortir avec un code != 0 si la qualité n'est pas au rendez-vous.

set -e

# --- Node / TS (apidrift) ---
npx tsc --noEmit
npm test --silent
