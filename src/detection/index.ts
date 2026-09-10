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
import { buildDetectedChanges, parseChangelogIndex, type DetectedChange } from './stripe-changelog.js';
import type { Change } from '../types.js';

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

export interface DetectOptions {
  fetcher: Fetcher;
  /** The `<date>.<release>` heading to poll, e.g. "2026-08-26.preview". Required: this MVP targets one explicit release, it does not infer "what's new since last time" (out of scope). */
  release: string;
  indexUrl?: string;
  /** Injectable clock for the "consulted" date stamped into `references[]`. Defaults to today (UTC, YYYY-MM-DD). */
  fetchedAt?: () => string;
}

export interface DetectionResult {
  /** Forme #1 only — safe to hand straight to `RunOptions.codemods` (via the generic matcher). */
  autoExecutable: Change[];
  /** Every DetectedChange for this release, both formes, for logging/audit — forme #2 is never in `autoExecutable`. */
  all: DetectedChange[];
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function detectChanges(opts: DetectOptions): Promise<DetectionResult> {
  const indexUrl = opts.indexUrl ?? DEFAULT_CHANGELOG_INDEX_URL;
  const clock = opts.fetchedAt ?? todayUtc;

  const indexMarkdown = await opts.fetcher(indexUrl);
  const indexFetchedAt = clock();

  const entries = parseChangelogIndex(indexMarkdown).filter(
    (entry) => entry.release === opts.release && entry.breaking,
  );

  const all: DetectedChange[] = [];
  for (const entry of entries) {
    const pageMarkdown = await opts.fetcher(entry.url);
    const pageFetchedAt = clock();
    all.push(...buildDetectedChanges({ entry, pageMarkdown, indexUrl, indexFetchedAt, pageFetchedAt }));
  }

  return {
    autoExecutable: all.filter((d) => d.autoExecutable).map((d) => d.change),
    all,
  };
}
