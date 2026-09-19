/**
 * The ONE `VendorSource` implementation (US-12, AC2 — no registry, no second
 * vendor). Reassembles existing pieces, invents nothing:
 *   - Q1/Q3 reuse `detectChanges` and `parseChangelogIndex`
 *     (`./index.ts`, `./stripe-changelog.ts`) verbatim.
 *   - Q2 is `resolvePinnedApiVersion` (`../matcher/api-version.ts`),
 *     verbatim, three lines.
 *
 * `vendorSourceFor` is the ONLY function that ever compares a `vendor`
 * string against anything — and it does so to THROW, never to pick among
 * implementations. That throw is AC2's entire enforcement; do not add a
 * second branch here.
 */
import type { Project } from 'ts-morph';
import { apiVersionDate } from '../changes/api-version.js';
import { resolvePinnedApiVersion } from '../matcher/api-version.js';
import { detectChanges, DEFAULT_CHANGELOG_INDEX_URL, type Fetcher } from './index.js';
import { parseChangelogIndex, parseReleaseHeadings, type ChangelogEntry } from './stripe-changelog.js';
import { boundIsReadable, selectReleases } from './walk.js';
import type { VendorDiff, VendorDiffGap, VendorRelease, VendorSource } from './vendor-source.js';

const VENDOR = 'stripe' as const;

export interface StripeVendorSourceOptions {
  /** Injectable — same `Fetcher` shape `detectChanges` already uses. Real network only via `httpFetcher` (`./index.ts`), never redefined here. */
  fetcher: Fetcher;
  indexUrl?: string;
  /** Injectable clock, same contract as `DetectOptions.fetchedAt` — defaults to today (UTC). */
  fetchedAt?: () => string;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function groupByRelease(entries: ChangelogEntry[]): VendorRelease[] {
  const byRelease = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    const list = byRelease.get(entry.release);
    if (list) list.push(entry);
    else byRelease.set(entry.release, [entry]);
  }
  // Chronological ascending, matching `VendorDiff.releases`'s contract. The
  // key is `apiVersionDate()`, not the full release string: `.dahlia` and
  // `.preview` published the same day compare lexicographically but not
  // chronologically, and this module now has exactly one ordering rule
  // (US-13, AC3) rather than one here and another in `./walk.ts`. The full
  // string only ever breaks a same-date tie, so the order stays stable.
  return [...byRelease.entries()]
    .map(([release, releaseEntries]) => ({ release, entries: releaseEntries }))
    .sort((a, b) => {
      const da = apiVersionDate(a.release) ?? a.release;
      const db = apiVersionDate(b.release) ?? b.release;
      return da === db ? a.release.localeCompare(b.release) : da.localeCompare(db);
    });
}

/** The one `VendorSource` implementation. See module docs above. */
export function createStripeVendorSource(opts: StripeVendorSourceOptions): VendorSource {
  const indexUrl = opts.indexUrl ?? DEFAULT_CHANGELOG_INDEX_URL;
  const fetchedAt = opts.fetchedAt ?? todayUtc;

  async function releases(): Promise<VendorRelease[]> {
    const indexMarkdown = await opts.fetcher(indexUrl);
    return groupByRelease(parseChangelogIndex(indexMarkdown));
  }

  function resolveCurrentApiVersion(project: Project, projectRoot: string) {
    // Pure delegation (US-12 DoR, D1) — no logic of its own. Kept as a named
    // wrapper only so `VendorSource` has one shape to call through; the US-7/
    // US-9 tests already cover every branch of what this returns.
    return resolvePinnedApiVersion(project, VENDOR, projectRoot);
  }

  async function changesSince(from: string): Promise<VendorDiff> {
    // AC3c, BEFORE any I/O: a bound we cannot order (`'latest'`, `''`, a
    // truncated date) is not walkable, so downloading a 200 KB index to
    // discover that would be pure waste. The old code compared whole strings
    // (`release > from`) and walked anyway, silently wrong.
    if (!boundIsReadable(from)) {
      return {
        from,
        to: from,
        status: 'unreadable-bound',
        releases: [],
        autoExecutable: [],
        reportOnly: [],
        gaps: [],
      };
    }

    // AC6: the index is fetched ONCE per changesSince() — here — and then
    // handed to every `detectChanges` call below. It used to be re-fetched
    // per release: 28 requests for the 27-release reference walk.
    const indexMarkdown = await opts.fetcher(indexUrl);
    const indexFetchedAt = fetchedAt();
    const entries = parseChangelogIndex(indexMarkdown);

    // Headings, not rows: a release that publishes no exploitable table row is
    // legitimate (2 of the 140 live headings), and `to` — "the last release
    // published on this line" — has to see it.
    const selection = selectReleases(parseReleaseHeadings(indexMarkdown), from);

    const autoExecutable = [] as VendorDiff['autoExecutable'];
    const reportOnly = [] as VendorDiff['reportOnly'];
    const gaps: VendorDiffGap[] = [];

    for (const release of selection.walked) {
      try {
        // Reuses `detectChanges` verbatim, one release at a time — the same
        // seam `src/cli.ts --detect` already exercises. Per-PAGE failure
        // isolation now lives inside it (AC4), so a hole here names a page and
        // never costs that page's siblings their changes.
        const detection = await detectChanges({
          fetcher: opts.fetcher,
          release,
          indexUrl,
          fetchedAt,
          index: { entries, fetchedAt: indexFetchedAt },
        });
        autoExecutable.push(...detection.autoExecutable);
        reportOnly.push(...detection.all.filter((d) => !d.autoExecutable));
        gaps.push(...detection.gaps);
      } catch (err) {
        // Defensive net only: with per-page isolation in place, `detectChanges`
        // no longer throws for anything a page can do. A throw reaching here is
        // a bug in our own code — it must still cost one release, not the walk.
        gaps.push({ release, url: indexUrl, reason: `release-level failure (not one page): ${(err as Error).message}` });
      }
    }

    // `to` comes from the INDEX, never from `from` — "you are on the last
    // release" and "we could not read anything past you" are different facts
    // (AC3a/AC3b), and `status` is what tells them apart.
    return {
      from,
      to: selection.to,
      status: selection.status,
      releases: selection.walked,
      autoExecutable,
      reportOnly,
      gaps,
    };
  }

  return { vendor: VENDOR, releases, resolveCurrentApiVersion, changesSince };
}

/**
 * AC2's entire enforcement: the ONLY place a `vendor` string is compared
 * against anything, and it exists to THROW a message naming the vendor —
 * never to select an implementation. There is no registry to extend; a
 * second `if` branch here would BE the scope creep CLAUDE.md forbids.
 */
export function vendorSourceFor(vendor: string, opts: StripeVendorSourceOptions): VendorSource {
  if (vendor !== VENDOR) {
    throw new Error(`vendorSourceFor: unsupported vendor "${vendor}" — only "${VENDOR}" is supported`);
  }
  return createStripeVendorSource(opts);
}
