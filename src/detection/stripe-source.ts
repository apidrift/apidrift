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
import { resolvePinnedApiVersion } from '../matcher/api-version.js';
import { detectChanges, DEFAULT_CHANGELOG_INDEX_URL, type Fetcher } from './index.js';
import { parseChangelogIndex, type ChangelogEntry } from './stripe-changelog.js';
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

/** `'2025-03-31.basil'` -> `'basil'`; `'2023-08-16'` (channel-less, US-12 P0 constat 2) -> `undefined`. */
function channelOf(release: string): string | undefined {
  const dot = release.indexOf('.');
  return dot === -1 ? undefined : release.slice(dot + 1);
}

function groupByRelease(entries: ChangelogEntry[]): VendorRelease[] {
  const byRelease = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    const list = byRelease.get(entry.release);
    if (list) list.push(entry);
    else byRelease.set(entry.release, [entry]);
  }
  // Chronological ascending, matching `VendorDiff.releases`'s contract —
  // string comparison works because every release starts with a zero-padded
  // `YYYY-MM-DD` (the same property `isPinnedBefore` relies on).
  return [...byRelease.entries()]
    .map(([release, releaseEntries]) => ({ release, entries: releaseEntries }))
    .sort((a, b) => a.release.localeCompare(b.release));
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
    const all = await releases();
    const channel = channelOf(from);
    // Same channel line, strictly after `from` — never cross from a stable
    // channel into `preview` (a parallel, experimental line) or vice versa.
    const inRange = all
      .map((r) => r.release)
      .filter((release) => release > from && channelOf(release) === channel);

    const autoExecutable = [] as VendorDiff['autoExecutable'];
    const reportOnly = [] as VendorDiff['reportOnly'];
    const gaps: VendorDiffGap[] = [];

    for (const release of inRange) {
      try {
        // Reuses `detectChanges` verbatim, one release at a time — the same
        // seam `src/cli.ts --detect` already exercises. Refetching the index
        // per release is deliberately NOT optimized here: caching the index
        // between calls is US-15's job, not this one's.
        const detection = await detectChanges({ fetcher: opts.fetcher, release, indexUrl, fetchedAt });
        autoExecutable.push(...detection.autoExecutable);
        reportOnly.push(...detection.all.filter((d) => !d.autoExecutable));
      } catch (err) {
        // A page that fails to fetch or parse must be NAMED, never silently
        // dropped as "this release had nothing" — the other half of the
        // gaps invariant (US-12 DoR, D1).
        gaps.push({ release, reason: (err as Error).message });
      }
    }

    const to = inRange.length > 0 ? inRange[inRange.length - 1] : from;
    return { from, to, releases: inRange, autoExecutable, reportOnly, gaps };
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
