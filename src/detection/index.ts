/**
 * Orchestrates the changelog poll: fetch the index, filter it to one release's
 * Breaking rows, fetch each detail page, and fan out `Change` records via
 * `stripe-changelog.ts`. This is the only file in `src/detection/` that
 * touches the network, and it does so behind an injectable `Fetcher` — same
 * shape as `Llm` (src/fixer/llm.ts) — so `npm test` never makes a real
 * request (see tests/detection.test.ts, which supplies fixture markdown).
 *
 * `src/service/poller.ts` (the Pro backend skeleton) is the intended upstream
 * consumer of `detectChanges` — its step 2 ("diff -> Change records") is
 * exactly this call. The Free CLI's `--detect` flag (src/cli.ts) is the other.
 *
 * Deliberately NOT here (see US-2 DoR, hors_scope_explicite):
 *  - no "already seen" snapshot between polls — `release` is explicit input;
 *  - no scheduler / cron / queue;
 *  - no writing into src/changes/index.ts — callers feed `autoExecutable`
 *    into `RunOptions.codemods` (src/pipeline.ts), the registry never changes.
 */
import {
  buildDetectedChanges,
  pageIsReadable,
  parseChangelogIndex,
  type ChangelogEntry,
  type DetectedChange,
} from './stripe-changelog.js';
import type { Change } from '../types.js';
// Type-only, erased at compile time: `./vendor-source.ts` is the contract
// module (zero runtime imports), and the hole shape is declared there because
// that is where a reader of `VendorDiff` meets it. Producing it here and
// naming it there beats declaring the same three fields twice.
import type { VendorDiffGap } from './vendor-source.js';

export type Fetcher = (url: string) => Promise<string>;

export const DEFAULT_CHANGELOG_INDEX_URL = 'https://docs.stripe.com/changelog.md';

/**
 * The one real network `Fetcher` this project ships — every caller that talks
 * to the live changelog (`src/cli.ts`, and `VendorSource` via
 * `stripe-source.ts`) goes through this, instead of each defining its own
 * `fetch()` wrapper.
 *
 * `Accept-Language: en-US` is not cosmetic (US-12, P0 constat 3, verified
 * live 2026-09-10): without it `docs.stripe.com` serves French, `## Changes`
 * becomes `## Modifications`, `extractSection` returns `null`, and every
 * detail page silently contributes ZERO changes — in HTTP 200, with no
 * exception to catch. The index page still parses fine either way (the table
 * header `Breaking`/`Non-breaking` is not translated), so nothing else in the
 * pipeline notices. Centralizing the header here — rather than leaving each
 * caller to remember it — is the fix: see
 * `tests/vendor-source.test.ts` for the regression test that fails if this
 * header is ever dropped.
 */
export const httpFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { 'Accept-Language': 'en-US' } });
  if (!res.ok) throw new Error(`detection: GET ${url} -> HTTP ${res.status}`);
  return res.text();
};

/**
 * An index this caller has ALREADY fetched and parsed (US-13, AC6).
 *
 * `changesSince` (`./stripe-source.ts`) reads the index once to decide which
 * releases to walk, then calls `detectChanges` per release — which used to
 * re-fetch and re-parse the very same 204,776-byte document every time: 28
 * requests for the 27-release reference walk. This is not a caching problem
 * (that is US-15, and it is strictly BETWEEN runs): it is the walk throwing
 * away something it is already holding. Hence a parameter, not a module.
 *
 * `fetchedAt` travels with the entries because it is what
 * `Change.references[]` stamps as the consultation date of the index — it must
 * be the date the index was actually read, not the date it was reused.
 */
export interface PreparsedIndex {
  entries: ChangelogEntry[];
  /** When the index this was parsed from was fetched (UTC, YYYY-MM-DD). */
  fetchedAt: string;
}

export interface DetectOptions {
  fetcher: Fetcher;
  /** The `<date>.<release>` heading to poll, e.g. "2026-08-26.preview". Required: this MVP targets one explicit release, it does not infer "what's new since last time" (out of scope). */
  release: string;
  indexUrl?: string;
  /** Injectable clock for the "consulted" date stamped into `references[]`. Defaults to today (UTC, YYYY-MM-DD). */
  fetchedAt?: () => string;
  /**
   * OPTIONAL (US-13, AC6). When absent — every pre-US-13 caller, including
   * `src/cli.ts --detect` — this function fetches and parses the index itself,
   * byte for byte the behaviour US-2 shipped. When present, it fetches no
   * index at all and uses these entries.
   */
  index?: PreparsedIndex;
}

export interface DetectionResult {
  /** Forme #1 only — safe to hand straight to `RunOptions.codemods` (via the generic matcher). */
  autoExecutable: Change[];
  /** Every DetectedChange for this release, both formes, for logging/audit — forme #2 is never in `autoExecutable`. */
  all: DetectedChange[];
  /**
   * One entry per PAGE of this release we could not read (US-13, AC4/AC5) —
   * fetch failure, parse failure, or a page we did not recognize as readable.
   * A page that reads fine and simply carries nothing for us is NOT in here:
   * that is the ordinary, majority case.
   */
  gaps: VendorDiffGap[];
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function detectChanges(opts: DetectOptions): Promise<DetectionResult> {
  const indexUrl = opts.indexUrl ?? DEFAULT_CHANGELOG_INDEX_URL;
  const clock = opts.fetchedAt ?? todayUtc;

  let indexEntries: ChangelogEntry[];
  let indexFetchedAt: string;
  if (opts.index) {
    indexEntries = opts.index.entries;
    indexFetchedAt = opts.index.fetchedAt;
  } else {
    const indexMarkdown = await opts.fetcher(indexUrl);
    indexFetchedAt = clock();
    indexEntries = parseChangelogIndex(indexMarkdown);
  }

  const entries = indexEntries.filter((entry) => entry.release === opts.release && entry.breaking);

  const all: DetectedChange[] = [];
  const gaps: VendorDiffGap[] = [];

  for (const entry of entries) {
    // ── US-13, AC4: the try/catch is around ONE PAGE ────────────────────────
    // It used to sit around this whole function (in `changesSince`), so the
    // first page that threw cost every other page of the release its changes
    // and produced a single hole named after the release. The failure of one
    // page is now exactly one hole, named after that page, and its siblings
    // still contribute. Nothing about WHEN we fail changed — `extractImpact`'s
    // guard is untouched — only how far the failure travels.
    try {
      const pageMarkdown = await opts.fetcher(entry.url);
      const pageFetchedAt = clock();

      // AC5: 200 OK is not "we read it". A page served in another language
      // parses to zero rows and raises nothing at all — the silent zero this
      // check exists to turn into a named hole. See `pageIsReadable`.
      if (!pageIsReadable(pageMarkdown)) {
        gaps.push({
          release: entry.release,
          url: entry.url,
          reason:
            'stripe-changelog: page carries none of the expected English section headings ' +
            '(What’s new / Changes / Upgrade / Related changes) — fetched, not read',
        });
        continue;
      }

      all.push(...buildDetectedChanges({ entry, pageMarkdown, indexUrl, indexFetchedAt, pageFetchedAt }));
    } catch (err) {
      gaps.push({ release: entry.release, url: entry.url, reason: (err as Error).message });
    }
  }

  return {
    autoExecutable: all.filter((d) => d.autoExecutable).map((d) => d.change),
    all,
    gaps,
  };
}
