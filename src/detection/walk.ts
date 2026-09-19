/**
 * WHICH releases a walk covers, and WHY it stopped where it did — PURE
 * (US-13, AC12): a string[] -> data transform, zero I/O, zero Markdown, zero
 * ts-morph. Every bound case below is therefore testable on an array of
 * release names (tests/walk.test.ts); before this, the selection lived inline
 * in `changesSince` and could only be reached through a fetcher and a fixture
 * index.
 *
 * ## The line, and why it is NOT "the same channel"
 * US-12 shipped `channelOf(release) === channelOf(from)`, a strict equality.
 * Measured on the live changelog 2026-09-10, from the bound `2023-08-16`
 * (the pin of `fixtures/implicit-pinned-stripe`): strict equality reaches 3
 * releases / 14 Breaking pages and stops at `2024-06-20`; the STABLE LINE
 * reaches 27 releases / 69 pages and ends at `2026-08-26.dahlia`. The 24
 * releases strict equality misses include `2025-03-31.basil`, which carries 25
 * of the 28 auto-executable changes in that range. The walk was not "a little
 * incomplete": it missed essentially all of the signal.
 *
 * So the line is: **everything that does not end in `.preview`**, ordered by
 * `apiVersionDate()`. `.preview` is a PARALLEL, experimental line — a bound on
 * the stable line must never be dragged into it (measured: from
 * `2026-03-25.dahlia`, a perfectly up-to-date repo, ignoring the channel
 * retains 20 Breaking changes, all of them from `.preview` releases — signal /
 * noise 0/20), and the reciprocal holds: a `.preview` bound walks `.preview`
 * only.
 *
 * ## AC1bis — there is deliberately NO list of channel names here
 * Not `['acacia', 'basil', 'clover', 'dahlia']`, not a "channel succession"
 * model, not anywhere. Such a table would expire IN SILENCE the day Stripe
 * opens a new channel — the same silently-expiring table US-9 and US-13's
 * framing both refused. It is also unnecessary: verified on the 140 headings
 * of the live index, the stable line is strictly monotonic in DATE (123
 * non-preview headings, 5 successive non-interleaved segments: no channel ->
 * acacia -> basil -> clover -> dahlia; 17 dates carry two headings, but NO date
 * carries more than one non-preview heading and no date is preview-only). Order
 * by date and the channel succession simply falls out. A future channel lands
 * in the stable line by default — that is the wanted behaviour, and it is a
 * VISIBLE outcome (the release is named in the report and in every PR through
 * `change.apiVersion`), never a silent one.
 *
 * `.preview` is consequently the ONLY channel-name literal in this module.
 */
import { apiVersionDate } from '../changes/api-version.js';

/**
 * The one channel-name literal this module is allowed to contain (AC2). The
 * exclusion of `.preview` used to be a SIDE EFFECT of US-12's strict channel
 * equality; introducing the continuity above removes that side effect, so the
 * exclusion has to be written down as a condition of its own or it disappears
 * without a single existing test going red.
 */
const PREVIEW_CHANNEL_SUFFIX = '.preview';

/** The named condition of AC2. `'2026-04-22.preview'` -> true; `'2025-03-31.basil'`, `'2023-08-16'` -> false. */
export function isPreviewRelease(release: string): boolean {
  return release.endsWith(PREVIEW_CHANNEL_SUFFIX);
}

/** Two releases are on the same line iff they are both preview or both not — see the module docs. */
function onSameLine(release: string, from: string): boolean {
  return isPreviewRelease(release) === isPreviewRelease(from);
}

/**
 * Can this bound be ORDERED at all? `apiVersionDate` returns `null` for
 * `'latest'`, `''`, a truncated date — values a caller can genuinely hold (an
 * `--since` typo, a hand-written config). Exposed so the caller can stop
 * BEFORE spending a 200 KB index fetch on a bound it will not be able to
 * compare against anything (AC3c).
 */
export function boundIsReadable(from: string): boolean {
  return apiVersionDate(from) !== null;
}

/**
 * Why the walk covers what it covers. One value per sentence a human is owed
 * (AC3) — US-16 writes the sentences, this is the DATA behind them.
 *
 * `'up-to-date'` and `'ahead-of-index'` are deliberately NOT merged: the first
 * means "you are on the last release the vendor published", the second means
 * "you are on something newer than anything this index publishes" (a preview
 * pin read against a stale index, a hand-typed bound). Same empty walk, two
 * different things to say, two different remedies.
 */
export type WalkStatus =
  /** At least one release to walk. */
  | 'behind'
  /** The bound IS the last release published on its line (AC3a). */
  | 'up-to-date'
  /** The bound is newer than anything the index publishes on its line (AC3b). */
  | 'ahead-of-index'
  /** `apiVersionDate(from)` is null — we cannot order this bound, so we do not walk (AC3c). */
  | 'unreadable-bound'
  /** The index publishes NOTHING on this line. Defensive: never observed on the live changelog. */
  | 'line-not-published';

export interface ReleaseSelection {
  /** Releases strictly after `from` on `from`'s line, chronological ascending — the intended walk path. */
  walked: string[];
  /**
   * The last release published on `from`'s line, READ FROM THE INDEX — never a
   * fallback onto `from` (AC3). It equals `from` only in the two cases where
   * the index has nothing to say: an unreadable bound (we never looked) and a
   * line the index does not publish at all.
   */
  to: string;
  /**
   * The `.preview` releases after `from` that the line rule excluded. Reported,
   * not silent: this is the number AC2's mutation test watches, and the one
   * that would silently become 20 real (wrong) changes if the condition were
   * ever dropped.
   */
  skippedPreview: string[];
  /** Convenience mirror of `status === 'unreadable-bound'` — the one case where nothing else in here is meaningful. */
  unreadableBound: boolean;
  status: WalkStatus;
}

/**
 * The whole release-selection rule, in one pure function.
 *
 * `releases` is every heading the index publishes, in any order and with any
 * channel — duplicates and unorderable values are tolerated. Ordering is
 * computed on `apiVersionDate()` ALONE and never on the full release string:
 * `'2026-03-25.dahlia' < '2026-03-25.preview'` is true lexicographically yet
 * means nothing chronologically, and the document order of the headings is not
 * reliable either (verified: `2026-04-22.preview` precedes `2026-04-22.dahlia`
 * in the live file while every other date has the stable channel first).
 */
export function selectReleases(releases: readonly string[], from: string): ReleaseSelection {
  const fromDate = apiVersionDate(from);
  if (fromDate === null) {
    // AC3c. We stop here rather than compare strings and be silently wrong —
    // which is what `release > from` did for `'latest'` and `''`.
    return { walked: [], to: from, skippedPreview: [], unreadableBound: true, status: 'unreadable-bound' };
  }

  const onLine: { release: string; date: string }[] = [];
  const offLine: { release: string; date: string }[] = [];
  const seen = new Set<string>();

  for (const release of releases) {
    if (seen.has(release)) continue;
    seen.add(release);

    const date = apiVersionDate(release);
    // Not orderable: we cannot place it in the line, so we never walk it. The
    // index heading regex cannot produce one of these today; staying total
    // here costs nothing.
    if (date === null) continue;

    if (!onSameLine(release, from)) {
      if (isPreviewRelease(release) && date > fromDate) offLine.push({ release, date });
      continue;
    }
    onLine.push({ release, date });
  }

  // Sort on the DATE only. Array.prototype.sort is stable, so two headings
  // sharing a date keep their index order — measured: no date carries more
  // than one non-preview heading, so this tie never decides anything real.
  const byDate = (a: { date: string }, b: { date: string }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  onLine.sort(byDate);
  offLine.sort(byDate);
  const skippedPreview = offLine.map((r) => r.release);

  const last = onLine[onLine.length - 1];
  if (!last) {
    return { walked: [], to: from, skippedPreview, unreadableBound: false, status: 'line-not-published' };
  }

  const walked = onLine.filter((r) => r.date > fromDate).map((r) => r.release);
  const status: WalkStatus = walked.length > 0
    ? 'behind'
    : last.date === fromDate
      ? 'up-to-date'
      : 'ahead-of-index';

  return { walked, to: last.release, skippedPreview, unreadableBound: false, status };
}
