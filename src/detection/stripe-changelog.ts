/**
 * Pure parsing of the Stripe changelog Markdown into `Change[]` — the
 * "detection" half of US-2. Deliberately has ZERO I/O and ZERO ts-morph:
 * everything here is a string -> data transform, testable on fixtures with no
 * network and no AST. The network fetch lives in `./index.ts`; the AST
 * matcher that turns a `Change.target.symbol` into `find()` lives in
 * `../matcher/symbol.ts` (CLAUDE.md: AST stays in src/matcher/).
 *
 * ## Sources (verified 2026-09-01, no API key required)
 * - Index: https://docs.stripe.com/changelog.md — `## <date>.<release>`
 *   headings, each followed by one or more `### <domain>` tables of
 *   `Title(link) | Affected Products | Breaking change? | Category`.
 * - Detail page: https://docs.stripe.com/changelog/<release>/<date>/<slug>.md
 *   — a `## Impact` section (migration prose) and a `## Changes` section with
 *   one table per SDK, including `#### Node.js` with columns
 *   `Parameter(s) | Change (Removed/Added) | Resources or methods`.
 *
 * ## The forme #1 / forme #2 discriminant (the load-bearing rule here)
 * Every cell in the Node.js table's "Resources or methods" column is a list
 * of Markdown links whose URL is a Stripe API doc path, `/api/<resource>/<segment>`:
 *   - segment is a METHOD (`create`, `update`, `confirm`, `create_preview`...)
 *     => the change is on the REQUEST => the CallExpression itself is the
 *     affected node => "forme #1", auto-executable by a generic
 *     `target.symbol`-driven matcher.
 *   - segment is `object` => the change is on the RESPONSE => the affected
 *     node is a property read on a call's *result*, which `target.symbol`
 *     cannot express (see the AC8 observation in
 *     src/changes/stripe-subscription-current-period-to-items.ts) => "forme
 *     #2", detected and reported, never auto-executed.
 * A link is EXCLUDED from both (never emitted) when its link text names a
 * nested/array path (contains "[]" or a nested `.field` chain, e.g.
 * `InvoiceCreatePreviewParams.schedule_details.phases[]`): the edit would not
 * land on a top-level key of the options object, so neither form applies.
 *
 * `migration.op` is only ever mapped for `Removed` rows (-> `'removed'`).
 * Every other value of the `Change` column (`Added`, ...) is left alone
 * rather than forced into an existing enum value — the stance established in
 * US-3 (src/changes/stripe-subscription-current-period-to-items.ts, AC8): a
 * row that doesn't fit is simply not turned into a Change, not mislabeled.
 */
import type { Change } from '../types.js';

export interface ChangelogEntry {
  /** Verbatim link text from the index row — becomes `Change.title`. */
  title: string;
  /** Absolute (or origin-relative) URL of the detail page, verbatim from the index. */
  url: string;
  affectedProducts: string;
  breaking: boolean;
  category: string;
  /** The heading this row was found under, e.g. "2026-08-26.preview". */
  release: string;
}

// The channel suffix (`.acacia`, `.preview`, ...) is OPTIONAL (US-12, P0
// constat 2): 99 of the 140 releases on the live changelog (2011-06-21 up to
// 2024-06-20, including `2023-08-16` — the exact pin of
// `fixtures/implicit-pinned-stripe`) predate channel names and are bare
// `## <date>` headings. Their sections have the identical table shape (same
// columns, same detail-page structure) — verified on 2023-08-16, 2022-11-15,
// 2024-06-20 — so requiring a channel silently made 71% of the index
// invisible to `parseChangelogIndex`. This is an in-situ extension of the
// existing rule, not a rewrite: the matched group is still exactly the
// `release` string other code already treats as an opaque, verbatim value.
const RELEASE_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2}(?:\.\S+)?)\s*$/gm;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/;

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return withoutEdges.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

/**
 * Every `## <date>[.<channel>]` heading the index publishes, in document
 * order, duplicates included — the RELEASE LINE itself, independent of whether
 * a release carries any exploitable table row (US-13).
 *
 * `parseChangelogIndex` cannot answer this: it returns ROWS, so a release with
 * no row is invisible to it. Measured on the live index (2026-09-10): 2 of 140
 * headings carry no exploitable row, and such a release is perfectly LEGITIMATE
 * — not a hole. The walk's `to` ("the last release published on this line")
 * must be read off the headings, or a row-less last release would silently
 * shift `to` backwards.
 *
 * Uses the SAME `RELEASE_HEADING_RE` as `parseChangelogIndex`, untouched
 * (US-12 owns that regex).
 */
export function parseReleaseHeadings(markdown: string): string[] {
  return [...markdown.matchAll(RELEASE_HEADING_RE)].map((m) => m[1]);
}

/**
 * Parses the changelog index into one entry per index-table row, tagged with
 * the `## <date>.<release>` heading it appeared under. Domain sub-headings
 * (`### Payments`, ...) are not tracked — nothing downstream needs them.
 */
export function parseChangelogIndex(markdown: string): ChangelogEntry[] {
  const headingMatches = [...markdown.matchAll(RELEASE_HEADING_RE)];
  const entries: ChangelogEntry[] = [];

  for (let i = 0; i < headingMatches.length; i++) {
    const match = headingMatches[i];
    const release = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < headingMatches.length ? (headingMatches[i + 1].index ?? markdown.length) : markdown.length;
    const section = markdown.slice(start, end);

    for (const line of section.split('\n')) {
      const cells = splitTableRow(line);
      if (!cells || cells.length < 4 || isSeparatorRow(cells)) continue;

      const linkMatch = LINK_RE.exec(cells[0]);
      if (!linkMatch) continue; // header row ("Title | ...") has no link either

      const breakingCell = cells[2];
      if (breakingCell !== 'Breaking' && breakingCell !== 'Non-breaking') continue;

      entries.push({
        title: linkMatch[1],
        url: linkMatch[2],
        affectedProducts: cells[1],
        breaking: breakingCell === 'Breaking',
        category: cells[3],
        release,
      });
    }
  }

  return entries;
}

/**
 * One index ROW with a title link whose Breaking column is neither
 * `'Breaking'` nor `'Non-breaking'` — the exact rows `parseChangelogIndex`
 * silently `continue`s past today (US-16, AC2c).
 */
export interface UnclassifiedBreakingRow {
  /** The heading this row was found under, verbatim — same contract as `ChangelogEntry.release`. */
  release: string;
  /** The detail page URL, verbatim from the row's link. */
  url: string;
  /** Verbatim link text — for the message this feeds (`src/cli-summary.ts`). */
  title: string;
  /** The raw, unrecognized value read from the Breaking column. */
  breakingCell: string;
}

/**
 * A SEPARATE pass over the same document, deliberately NOT folded into
 * `parseChangelogIndex` (US-16, AC2c — decision humaine 3 du 2026-09-19: that
 * function's contract and its existing tests are frozen, additions only).
 * Shares its row-splitting rules byte for byte (`splitTableRow`,
 * `isSeparatorRow`, `LINK_RE`) so the two passes can never classify the same
 * row differently by accident.
 *
 * Live measurement (2026-09-26): 0 rows of this shape on 877 link-carrying
 * rows, in both English and French — this exists to make a vendor format
 * drift LOUD (a named gap, US-16 AC3 sortie 3), not to fire on anything
 * observed today.
 */
export function findUnclassifiedBreakingRows(markdown: string): UnclassifiedBreakingRow[] {
  const headingMatches = [...markdown.matchAll(RELEASE_HEADING_RE)];
  const rows: UnclassifiedBreakingRow[] = [];

  for (let i = 0; i < headingMatches.length; i++) {
    const match = headingMatches[i];
    const release = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < headingMatches.length ? (headingMatches[i + 1].index ?? markdown.length) : markdown.length;
    const section = markdown.slice(start, end);

    for (const line of section.split('\n')) {
      const cells = splitTableRow(line);
      if (!cells || cells.length < 4 || isSeparatorRow(cells)) continue;

      const linkMatch = LINK_RE.exec(cells[0]);
      if (!linkMatch) continue; // header row, same exclusion as parseChangelogIndex

      const breakingCell = cells[2];
      if (breakingCell === 'Breaking' || breakingCell === 'Non-breaking') continue; // the recognized shape

      rows.push({ release, url: linkMatch[2], title: linkMatch[1], breakingCell });
    }
  }

  return rows;
}

/** Slices out the body of a `#`-heading section, up to the next heading of equal-or-lower level. */
function extractSection(markdown: string, heading: string, level: number): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^${'#'.repeat(level)}\\s+${escaped}\\s*$`, 'm');
  const match = headingRe.exec(markdown);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const nextHeadingRe = new RegExp(`^#{1,${level}}\\s+`, 'm');
  const nextMatch = nextHeadingRe.exec(rest);
  return nextMatch ? rest.slice(0, nextMatch.index) : rest;
}

const LEVEL_2_HEADING_RE = /^##[ \t]+(.+?)[ \t]*$/gm;

/**
 * The level-2 section headings of an English detail page whose text Stripe
 * TRANSLATES. `Impact` is deliberately absent: verified live on 2026-09-10
 * with `Accept-Language: fr`, `## Impact` is spelled identically in French
 * (`Changes` -> `Modifications`, `What's new` -> `Nouveautés`, `Upgrade` ->
 * `Mise à niveau`, `Related changes` -> `Modifications associées`), so it
 * cannot tell an English page from a French one and is useless as a sentinel.
 *
 * Both apostrophes are listed for `What's new` because the live pages use the
 * TYPOGRAPHIC one (U+2019) — all 69 of them — and a straight-quote variant
 * would otherwise read as unreadable. Neither spelling exists in French, so
 * accepting both costs the discriminant nothing.
 */
const TRANSLATABLE_SECTION_HEADINGS: readonly string[] = [
  'What’s new',
  "What's new",
  'Changes',
  'Upgrade',
  'Related changes',
];

/**
 * Did we actually READ this page, as opposed to fetching 200 OK and finding
 * nothing we recognize? (US-13, AC5 — the invariant the QA found uncovered.)
 *
 * `detectChanges` only ever raised when the FETCHER raised. A page served in
 * the wrong language parses to zero rows with no exception at all, and came
 * out as `autoExecutable: 0, reportOnly: 0, gaps: 0` — indistinguishable from
 * "this release changed nothing". `httpFetcher` sends `Accept-Language: en-US`
 * precisely to avoid that, but a header is a rempart, not a proof.
 *
 * THE RULE: a page counts as read iff it carries at least one level-2 heading
 * from the closed, translatable English vocabulary above. Measured on the 69
 * real Breaking pages of the reference walk: 69/69 carry `## What's new`, and
 * the whole level-2 vocabulary is six values across eleven combinations.
 *
 * What this rule deliberately does NOT call a hole — all three are the normal,
 * majority case:
 *   - a read page with no `## Changes` (33 of 69);
 *   - a `## Changes` with no `#### Node.js` table;
 *   - a Node.js table with no `Removed` row.
 * And it must NEVER key off `#### Node.js`: 56 of 69 pages carry one, but on a
 * page without `## Changes` it sits under `## Upgrade` holding upgrade prose
 * ("Upgrade your Node SDK to v19.1.0"), not a parameter table — reading it as
 * signal would manufacture 20 false holes.
 *
 * Direction of error, assumed: if Stripe renamed its section vocabulary, EVERY
 * page would become a hole — loud over-reporting, never a silent "nothing to
 * do". That is what makes this literal list acceptable where US-9's version
 * table was not: this one expires screaming.
 */
export function pageIsReadable(markdown: string): boolean {
  for (const match of markdown.matchAll(LEVEL_2_HEADING_RE)) {
    if (TRANSLATABLE_SECTION_HEADINGS.includes(match[1])) return true;
  }
  return false;
}

/**
 * Returns the `## Impact` section verbatim (trimmed of surrounding
 * whitespace, nothing else touched) — this is the ONLY migration instruction
 * a detected Change carries (no `apply()`), so it must never be empty or
 * paraphrased. Throws rather than returning a fallback: a silent empty
 * `migration.detail` would surface as a literal "Migration: undefined" in the
 * AI fixer's prompt (src/fixer/agent.ts) and the PR body (src/pr.ts).
 */
export function extractImpact(markdown: string): string {
  const section = extractSection(markdown, 'Impact', 2);
  const text = section?.trim();
  if (!text) {
    throw new Error(
      'stripe-changelog: page has no non-empty "## Impact" section — refusing to build a Change ' +
        'with an empty migration.detail',
    );
  }
  return text;
}

export interface ChangelogRow {
  /** Backtick-quoted parameter name(s) from the first column, in order. */
  parameters: string[];
  /** Second column, verbatim ("Removed", "Added", ...). */
  changeKind: string;
  /** Every `[text](url)` link in the third column. */
  links: { text: string; url: string }[];
}

const PARAM_RE = /`([^`]+)`/g;
const LINK_ALL_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Parses the `#### Node.js` table inside a detail page's `## Changes`
 * section. Only the Node.js SDK table is read — the REST API / other-SDK
 * tables exist on the same page but carry the same information under
 * different naming conventions (see `cle_de_parsing` in the US-2 DoR), and
 * this project targets JS/TS.
 */
export function parseNodeJsChangesTable(markdown: string): ChangelogRow[] {
  const changesSection = extractSection(markdown, 'Changes', 2);
  if (!changesSection) return [];

  const nodeSection = extractSection(changesSection, 'Node.js', 4);
  if (!nodeSection) return [];

  const rows: ChangelogRow[] = [];
  for (const line of nodeSection.split('\n')) {
    const cells = splitTableRow(line);
    if (!cells || cells.length < 3 || isSeparatorRow(cells)) continue;
    if (cells[0] === 'Parameter' || cells[0] === 'Parameters' || cells[0] === 'Parameter(s)') continue; // header row

    const parameters = [...cells[0].matchAll(PARAM_RE)].map((m) => m[1]);
    if (parameters.length === 0) continue;

    const links = [...cells[2].matchAll(LINK_ALL_RE)].map((m) => ({ text: m[1], url: m[2] }));
    rows.push({ parameters, changeKind: cells[1], links });
  }

  return rows;
}

export type LinkClassification =
  | { kind: 'method'; resourcePath: string; segment: string }
  | { kind: 'object'; resourcePath: string; segment: string }
  | { kind: 'excluded' };

/** A link text naming a nested field or array index, e.g. `Foo.bar_baz.qux[]` or `Foo.bar_baz`. */
const NESTED_OR_ARRAY_TEXT_RE = /\[\]|\.[a-z_]/;

/** Strips origin, query string, anchor and a trailing `.md`, keeping only the `/api/...` path. */
function extractApiPathSegments(url: string): string[] | null {
  const withoutOrigin = url.replace(/^https?:\/\/[^/]+/, '');
  const withoutAnchor = withoutOrigin.split('#')[0];
  const withoutQuery = withoutAnchor.split('?')[0];
  const withoutExt = withoutQuery.replace(/\.md$/, '');
  const match = /^\/api\/(.+)$/.exec(withoutExt);
  if (!match) return null;
  const segments = match[1].split('/').filter(Boolean);
  return segments.length >= 2 ? segments : null;
}

/**
 * Classifies one `Resources or methods` link per the forme #1 / forme #2
 * discriminant. Pure URL-path + link-text logic — no ts-morph, no network.
 */
export function classifyLink(link: { text: string; url: string }): LinkClassification {
  if (NESTED_OR_ARRAY_TEXT_RE.test(link.text)) return { kind: 'excluded' };

  const segments = extractApiPathSegments(link.url);
  if (!segments) return { kind: 'excluded' };

  const segment = segments[segments.length - 1];
  const resourcePath = segments.slice(0, -1).join('/');
  if (!resourcePath) return { kind: 'excluded' };

  return { kind: segment === 'object' ? 'object' : 'method', resourcePath, segment };
}

/** `payment_intents` -> `paymentIntents`; `create_preview` -> `createPreview`; `subscriptions` -> `subscriptions`. */
export function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

function slugFromUrl(url: string): string {
  const withoutQuery = url.split('?')[0].split('#')[0];
  const last = withoutQuery.split('/').filter(Boolean).pop() ?? url;
  return last.replace(/\.md$/, '');
}

function kebab(s: string): string {
  return s.replace(/_/g, '-').replace(/\//g, '-');
}

export interface DetectedChange {
  change: Change;
  /** true only for forme #1 (request-shaped, method link) — the only form a generic matcher can execute. */
  autoExecutable: boolean;
  classification: 'method' | 'object';
  /**
   * The detail page this was read from, verbatim from the index row (US-13,
   * AC9). `change.references[0]` also carries it, but wrapped in
   * "(consulted <date>)" prose — a caller that has to report a forme #2 with
   * its page should not have to parse a sentence back apart to do it.
   */
  url: string;
}

/**
 * Fans a single changelog detail page out into one `DetectedChange` per
 * (Node.js table row x non-excluded link) — a row can name several methods
 * (verified on `deprecate-singular-coupon-promotion-code.md`: `promotion_code`
 * spans 4 methods). `Change.target.symbol` only ever names one symbol, so
 * this is fan-out, not a synthesized multi-symbol target.
 */
export function buildDetectedChanges(args: {
  entry: ChangelogEntry;
  pageMarkdown: string;
  indexUrl: string;
  indexFetchedAt: string;
  pageFetchedAt: string;
}): DetectedChange[] {
  const { entry, pageMarkdown, indexUrl, indexFetchedAt, pageFetchedAt } = args;
  const rows = parseNodeJsChangesTable(pageMarkdown);
  const slug = slugFromUrl(entry.url);

  const out: DetectedChange[] = [];
  // `## Impact` is only required (and only read) once we actually have
  // something to emit — a page whose Node.js table has nothing classifiable
  // never needs it, so it never has to pay `extractImpact`'s "must be
  // non-empty" guard.
  let impact: string | undefined;

  for (const row of rows) {
    // migration.op enum is never extended (US-3 stance): a row we can't map
    // (e.g. "Added") is not turned into a Change at all, auto-executable or not.
    if (row.changeKind !== 'Removed') continue;

    for (const link of row.links) {
      const classified = classifyLink(link);
      if (classified.kind === 'excluded') continue;

      impact ??= extractImpact(pageMarkdown);
      const namespace = classified.resourcePath.split('/').map(snakeToCamel).join('.');
      const methodOrObject = snakeToCamel(classified.segment);
      const symbol = `stripe.${namespace}.${methodOrObject}`;
      const primaryParam = row.parameters[0];

      const change: Change = {
        id: [
          'stripe',
          entry.release.replace(/\./g, '-'),
          slug,
          kebab(classified.resourcePath),
          kebab(classified.segment),
          kebab(primaryParam),
        ].join('-'),
        vendor: 'stripe',
        source: 'changelog',
        kind: 'breaking',
        title: entry.title,
        target: { type: 'symbol', symbol },
        migration: {
          op: 'removed',
          detail: `\`${row.parameters.join('`, `')}\` — ${impact}`,
        },
        references: [
          `${entry.url} (consulted ${pageFetchedAt})`,
          `${indexUrl} (consulted ${indexFetchedAt})`,
        ],
        confidence: 'low',
        // The release heading this row was found under IS the API version the
        // change takes effect from — already parsed, verbatim. This is the
        // path that needs the pinned-version guard most: confidence 'low', no
        // human in the loop, and the fix comes from the tier-2 AI agent.
        apiVersion: entry.release,
      };

      out.push({
        change,
        autoExecutable: classified.kind === 'method',
        classification: classified.kind,
        url: entry.url,
      });
    }
  }

  return out;
}
