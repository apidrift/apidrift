import { FETCH_TIMEOUT_MS } from './detection/index.js';
import type { PinnedApiVersion } from './matcher/api-version.js';

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
 *   - reportOnly : forme #2 changes detected in the walked range (US-16).
 *     They are never matched against this repo's code (there is no site to
 *     find), so they cannot set `skipped` — but "no known API change affects
 *     this repo" next to a list of response-shaped changes that DO is exactly
 *     the false bill of health this predicate exists to refuse. Optional and
 *     additive: absent or 0 leaves every pre-US-16 caller unchanged.
 * `needsAi` deliberately inhibits nothing: a change that was correctly
 * evaluated and does not concern this repo is exactly the clean case.
 */
export function cleanRunNote(counts: {
  checked: number; opened: number; warned: number; blocked: number; skipped: number;
  incomplete?: boolean; reportOnly?: number;
}): string | null {
  const { checked, opened, warned, blocked, skipped, incomplete, reportOnly } = counts;
  if (incomplete) return null;
  if (reportOnly !== undefined && reportOnly > 0) return null;
  if (!(checked > 0 && opened === 0 && warned === 0 && blocked === 0 && skipped === 0)) return null;
  return `no known API change affects this repo — nothing to fix (checked ${checked} known change${checked === 1 ? '' : 's'})`;
}

// ════════════════════════════════════════════════════════════════════════════
// US-16 — the FIVE distinct outputs (AC3), each a PURE function so the
// pairwise-distinctness test (AC3/AC7) needs no subprocess at all. `cli-run.ts`
// calls every one of these; it never re-derives the wording inline, so the
// sentence a human reads on a real run is the exact one the pure-function test
// compares. Every one of the five ends with an `action:` line (AC7): what a
// human can do NEXT is as load-bearing as what was established.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Sortie (1) — FETCH KO (AC1). Names the URL and the ROOT cause, never the
 * generic `TypeError: fetch failed` undici wraps every network error in:
 *   - a timeout (THIS project's own `AbortSignal.timeout`, `src/detection/index.ts`)
 *     rejects with a `TimeoutError`, named as such and with the bound it hit;
 *   - anything else undici raises carries the real cause on `err.cause` (e.g.
 *     `{ code: 'ENOTFOUND' }` for DNS, `'ECONNREFUSED'` for a refused
 *     connection) — read it rather than the wrapper's own uninformative message;
 *   - failing both of those, `err.message` — which is where an HTTP non-200
 *     (`detection: GET <url> -> HTTP 500`, from `httpFetcher`) already lands,
 *     unchanged (AC1c).
 */
export function fetchFailureNote(url: string, err: Error): string {
  const cause = (err as Error & { cause?: { code?: string; message?: string; name?: string } }).cause;
  const isTimeout = err.name === 'TimeoutError' || cause?.name === 'TimeoutError';
  const reason = isTimeout
    ? `timeout after ${FETCH_TIMEOUT_MS / 1000}s`
    : cause?.code
      ? `${cause.code}${cause.message ? ` — ${cause.message}` : ''}`
      : err.message;
  return [
    `could not read the Stripe changelog at ${url}`,
    `  cause: ${reason}`,
    '  nothing was analysed.',
    '  action: check your network access to docs.stripe.com, retry, or re-run with --deterministic-only to use the built-in registry with no network at all.',
  ].join('\n');
}

/**
 * Sortie (2) — INDEX ILLISIBLE, fatal (AC2). Two triggers, one family — "we
 * read the index and could not make sense of it", never a network failure:
 *   - `'zero-headings'`: not one `## <date>[.<channel>]` heading recognized
 *     (US-14 AC7b, `WalkStatus: 'index-empty'`).
 *   - `'zero-classable-rows'`: >= 1 heading, but the WHOLE index carries not
 *     one row with a title link and a recognized Breaking/Non-breaking cell
 *     (US-16 AC2b, `WalkStatus: 'index-unclassable'`) — one document section
 *     further than the first case, and distinct from it on purpose: a reader
 *     who sees "index-empty" ruled out must not have to wonder if this is the
 *     same failure restated.
 */
export function indexIllegibleNote(
  url: string,
  variant: { kind: 'zero-headings' } | { kind: 'zero-classable-rows'; headingCount: number },
): string {
  const what = variant.kind === 'zero-headings'
    ? `the changelog index at ${url} was read and parsed to ZERO release headings.`
    : `the changelog index at ${url} carries ${variant.headingCount} release heading(s) but ZERO classable row (a title link with a recognized Breaking/Non-breaking cell) anywhere in it.`;
  const why = variant.kind === 'zero-headings'
    ? 'this is NOT a network failure — the document arrived. Its format is not one we recognize, so we cannot tell "nothing changed" from "we understood none of it".'
    : 'this is NOT a network failure, and it is NOT the zero-heading case either — the document arrived and its headings parsed, but not one table row did.';
  return [
    what,
    `${why} Please report it.`,
    '  action: report the changelog format drift; verify no proxy is serving a translated or reformatted variant before trusting this run.',
  ].join('\n');
}

/**
 * Sortie (3) — PAGES ILLISIBLES, never fatal (AC2bis/AC3). The walk read the
 * index and continued: `unread` (N) of `attempted` (M) Breaking pages of this
 * range could not be read, each named with its release, URL and reason. When
 * N == M > 0 — every attempted page failed — a language-negotiation or proxy
 * issue is named as the likely cause (the P2 fait_1 scenario: a lost
 * `Accept-Language` header serves French in HTTP 200, and every page becomes
 * a hole with no exception at all).
 */
export function pagesUnreadableNote(args: {
  unread: number;
  attempted: number;
  gaps: readonly { release: string; url: string; reason: string }[];
}): string {
  const { unread, attempted, gaps } = args;
  const allFailed = attempted > 0 && unread === attempted;
  const lines = [
    `${unread} page(s) could not be read — the index was read; ${unread} of ${attempted} Breaking page(s) in this range could not be.`,
  ];
  for (const gap of gaps) {
    lines.push(`  ${gap.release}  ${gap.url}`);
    lines.push(`    ${gap.reason}`);
  }
  if (allFailed) {
    lines.push('  every attempted page failed: suspect a language-negotiation (Accept-Language) issue or a proxy serving something else before trusting this run\'s coverage.');
  }
  lines.push(`  action: review the page(s) above by hand${allFailed ? '; check for a language/proxy issue first' : ''}.`);
  return lines.join('\n');
}

/**
 * Sortie (4) — A JOUR (AC3/US-9 AC7). `from` names the bound; `provenance`
 * says WHERE it came from — the pin a human wrote (file:line), the pin the
 * installed SDK imposes implicitly (vX), or an explicit `--since` override.
 * "Checked, not assumed" without saying what was checked AGAINST is exactly
 * the gap US-9 AC7 closed for the pipeline's skip note; this is the same
 * discipline applied to the walk's own "up to date" verdict.
 */
export function pinProvenanceNote(
  pinned: PinnedApiVersion,
  sinceOverride: string | undefined,
  relPath: (absPath: string) => string,
): string {
  if (sinceOverride !== undefined) return `--since ${sinceOverride} (explicit override — the resolved pin was not used)`;
  if (pinned.status === 'pinned' && pinned.source === 'ast-client-option') {
    const v = pinned.versions[0];
    return `pinned explicitly in your source, ${relPath(v.filePath)}:${v.line}`;
  }
  if (pinned.status === 'pinned' && pinned.source === 'installed-sdk-default') {
    return `pinned IMPLICITLY by the installed Stripe SDK (v${pinned.sdkVersion}) — nothing in your source names a version`;
  }
  // Defensive: a walk only ever runs once the bound resolved (`resolveWalkBound`),
  // so `pinned.status === 'unresolved'` cannot reach here in practice.
  return 'resolved (source unavailable)';
}

/**
 * Sortie (5) — RIEN D'AUTO-CORRIGEABLE (AC3). The STRICT definition this
 * fires under (checked by the call site, not here): `status: 'behind'`, at
 * least one breaking change detected in the walked range, and `plan.matched`
 * EMPTY — no forme #1 matched a call site in this repo. Distinct from the
 * no-model listing (Vision B, exit 20): that one has matches; this one has
 * none, with or without a model configured.
 */
export function nothingAutoFixableNote(args: {
  releasesWalked: number;
  formOneNoSite: number;
  reportOnly: number;
  gaps: number;
}): string {
  const { releasesWalked, formOneNoSite, reportOnly, gaps } = args;
  return [
    `walked ${releasesWalked} release(s) on your line and found breaking change(s) — none of them is auto-fixable here.`,
    `  ${formOneNoSite} request-shaped change(s) matched no call site in this repo, ${reportOnly} response-shaped (report-only) change(s), ${gaps} page(s) could not be read.`,
    '  action: review the report-only change(s) listed above by hand — none of this is a codemod or an AI-fixable site.',
  ].join('\n');
}
