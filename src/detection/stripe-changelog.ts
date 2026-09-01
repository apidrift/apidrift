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

const RELEASE_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2}\.\S+)\s*$/gm;
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
      };

      out.push({ change, autoExecutable: classified.kind === 'method', classification: classified.kind });
    }
  }

  return out;
}
