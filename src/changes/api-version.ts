/**
 * Comparing two Stripe API versions. PURE: zero AST, zero I/O, zero ts-morph —
 * a string -> string/boolean transform, so it is testable without a repo.
 *
 * ## The format (verified 2026-09-03 on https://docs.stripe.com/changelog.md)
 * A Stripe API version is `YYYY-MM-DD` optionally followed by `.<channel>`:
 * `2023-08-16` (no channel — every version before Acacia has none),
 * `2025-03-31.basil`, `2026-08-26.dahlia`, `2026-08-26.preview`.
 *
 * ## The one rule that matters: compare the DATE, never the whole string
 * Only the first 10 characters carry ordering information.
 *   - `'2026-03-25.dahlia' < '2026-03-25.preview'` is true lexicographically,
 *     yet `.preview` is a channel running in PARALLEL at the same date, not a
 *     successor. Comparing full strings would invent an order between them.
 *   - `acacia < basil < clover < dahlia` sorting alphabetically is a
 *     coincidence of Stripe's naming, not a contract. The next channel name
 *     need not continue the alphabet.
 * ISO dates are zero-padded, so a lexicographic compare of the `YYYY-MM-DD`
 * head IS a chronological compare — no `new Date()`, which would drag in
 * timezone parsing traps for no benefit.
 *
 * ## Deliberate non-goal
 * No channel logic whatsoever. A `.preview` pinned at the same date as a
 * stable channel compares EQUAL, hence is not blocked. That is an accepted,
 * documented limitation (evidence base: zero observed cases), not an oversight.
 */

/** `YYYY-MM-DD`, the only part of an API version that carries an order. */
const DATE_HEAD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The comparable date head of an API version, or `null` if the value is not a
 * Stripe API version at all (`'latest'`, `''`, `'v2'`, a truncated date...).
 *
 * `null` is the "I cannot read this" signal and must never be softened into a
 * guess: callers treat it as unknown, never as "recent enough".
 */
export function apiVersionDate(version: string): string | null {
  const head = version.slice(0, 10);
  return DATE_HEAD.test(head) ? head : null;
}

/**
 * Is `pinned` STRICTLY older than `changeApiVersion` — i.e. does the target
 * run on an API version that predates the change, so applying the change would
 * migrate correct code to a shape the vendor will never return to it?
 *
 * Equality is NOT "before": a target pinned exactly on the change's version
 * receives the change. And an unreadable version on either side returns
 * `false` (do not block on something we could not parse — the "cannot tell"
 * case is handled by disclosure, see src/pr.ts, not by blocking).
 */
export function isPinnedBefore(pinned: string, changeApiVersion: string): boolean {
  const p = apiVersionDate(pinned);
  const c = apiVersionDate(changeApiVersion);
  if (p === null || c === null) return false;
  return p < c;
}

/**
 * Of several pinned versions found in one repo, the one to compare against:
 * the OLDEST. Two clients constructed with different versions are not a
 * special case — we cannot know which call site belongs to which client, so
 * the safe reading is "this repo may run on the oldest of them".
 *
 * Values that aren't readable dates are skipped (the resolver never emits
 * them; this stays total anyway). Returns `undefined` for an empty input.
 */
export function oldestApiVersion(versions: readonly string[]): string | undefined {
  let oldest: string | undefined;
  let oldestDate: string | undefined;
  for (const version of versions) {
    const date = apiVersionDate(version);
    if (date === null) continue;
    if (oldestDate === undefined || date < oldestDate) {
      oldest = version;
      oldestDate = date;
    }
  }
  return oldest;
}
