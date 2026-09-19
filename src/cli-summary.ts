/**
 * US-17 — say it out loud when a run is genuinely clean.
 *
 * Pure on purpose: src/cli.ts calls main() at import time, so the decision has
 * to live outside it to be testable. The counters are the ones cli.ts already
 * keeps; `checked` is `results.length`.
 *
 * Returns the RAW sentence (no ANSI, no colour — the call site paints it) or
 * null. Every term of the predicate is load-bearing; never drop one:
 *   - opened  : a PR was produced, so something WAS affected.
 *   - warned  : vendor-present-no-match (the 78dbfe2 anti-silence guard).
 *   - blocked : pinned-api-version, call sites found and left UNCHANGED.
 *   - skipped : matched but not applied — NOT a clean repo either.
 *   - incomplete : the walk's COVERAGE has a hole (a changelog page could not
 *     be read, or the bound is ahead of the index and nothing was walked).
 *     `checked` then undercounts what was really evaluated, and a cleanliness
 *     claim over an unread page is a false "nothing to do". Optional and
 *     additive: absent means "coverage complete" (offline mode, clean walk).
 * `needsAi` deliberately inhibits nothing: a change that was correctly
 * evaluated and does not concern this repo is exactly the clean case.
 */
export function cleanRunNote(counts: {
  checked: number; opened: number; warned: number; blocked: number; skipped: number;
  incomplete?: boolean;
}): string | null {
  const { checked, opened, warned, blocked, skipped, incomplete } = counts;
  if (incomplete) return null;
  if (!(checked > 0 && opened === 0 && warned === 0 && blocked === 0 && skipped === 0)) return null;
  return `no known API change affects this repo — nothing to fix (checked ${checked} known change${checked === 1 ? '' : 's'})`;
}
