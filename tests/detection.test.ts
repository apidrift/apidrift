import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDetectedChanges,
  classifyLink,
  extractImpact,
  findUnclassifiedBreakingRows,
  pageIsReadable,
  parseChangelogIndex,
  parseNodeJsChangesTable,
  parseReleaseHeadings,
  snakeToCamel,
} from '../src/detection/stripe-changelog.js';
import { detectChanges, type Fetcher } from '../src/detection/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, '..', 'fixtures', 'stripe-changelog');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

const INDEX_MD = readFixture('index-excerpt.md');
const FORM1_URL =
  'https://docs.stripe.com/changelog/dahlia/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-intents.md';
const FORM1_MD = readFixture('removes-payment-method-types-parameter-from-payment-intents-setup-intents.md');
const FORM2_URL =
  'https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md';
const FORM2_MD = readFixture('deprecate-subscription-current-period-start-and-end.md');
const MIXED_URL = 'https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-singular-coupon-promotion-code.md';
const MIXED_MD = readFixture('deprecate-singular-coupon-promotion-code.md');

// ── index parsing ───────────────────────────────────────────────────────────

test('parseChangelogIndex: tags every row with its `## <date>.<release>` heading', () => {
  const entries = parseChangelogIndex(INDEX_MD);
  assert.ok(entries.length > 10, 'expects many rows across the two release sections in the fixture');
  assert.ok(entries.every((e) => /^\d{4}-\d{2}-\d{2}\.\S+$/.test(e.release)));

  const releases = new Set(entries.map((e) => e.release));
  assert.deepStrictEqual([...releases].sort(), ['2026-08-26.dahlia', '2026-08-26.preview']);
});

test('parseChangelogIndex: finds our form #1 fixture entry, verbatim title, flagged Breaking', () => {
  const entries = parseChangelogIndex(INDEX_MD);
  const entry = entries.find((e) => e.url === FORM1_URL);
  assert.ok(entry, 'expected the payment_method_types row to be parsed');
  assert.strictEqual(
    entry!.title,
    'Removes support for specifying payment method types in Payment Intents and Setup Intents',
  );
  assert.strictEqual(entry!.breaking, true);
  assert.strictEqual(entry!.release, '2026-08-26.preview');
  assert.strictEqual(entry!.category, 'api');
});

test('parseChangelogIndex: Non-breaking rows are still parsed (breaking: false), not dropped', () => {
  const entries = parseChangelogIndex(INDEX_MD);
  const nonBreaking = entries.find((e) => e.title.startsWith('Adds a customer update deep link'));
  assert.ok(nonBreaking);
  assert.strictEqual(nonBreaking!.breaking, false);
});

// ── Impact extraction (verbatim, never empty) ───────────────────────────────

test('extractImpact: returns the "## Impact" section verbatim, non-empty', () => {
  const impact = extractImpact(FORM1_MD);
  assert.ok(impact.length > 0);
  assert.ok(impact.includes('you must remove it before upgrading'), 'must be the real prose, not paraphrased');
  assert.ok(!impact.includes('## Changes'), 'must not bleed into the next section');
});

test('extractImpact: throws rather than returning an empty/undefined detail', () => {
  assert.throws(() => extractImpact('# Some page\n\n## Why is this a breaking change?\n\nbecause.\n'));
});

// ── forme #1 / forme #2 discriminant ────────────────────────────────────────

test('classifyLink: a method URL (/api/<resource>/<method>) classifies as "method"', () => {
  const c = classifyLink({ text: 'PaymentIntentConfirmParams', url: '/api/payment_intents/confirm?api-version=2026-08-26.preview#confirm_payment_intent' });
  assert.deepStrictEqual(c, { kind: 'method', resourcePath: 'payment_intents', segment: 'confirm' });
});

test('classifyLink: an object URL (/api/<resource>/object) classifies as "object"', () => {
  const c = classifyLink({ text: 'Subscription', url: '/api/subscriptions/object?api-version=2025-03-31.basil' });
  assert.deepStrictEqual(c, { kind: 'object', resourcePath: 'subscriptions', segment: 'object' });
});

test('classifyLink: a nested/array link text is excluded regardless of URL', () => {
  const c = classifyLink({
    text: 'InvoiceCreatePreviewParams.schedule_details.phases[]',
    url: '/api/invoices/create_preview?api-version=2025-03-31.basil#create_create_preview-schedule_details-phases',
  });
  assert.deepStrictEqual(c, { kind: 'excluded' });
});

test('classifyLink: a non-API URL is excluded', () => {
  assert.deepStrictEqual(classifyLink({ text: 'x', url: 'https://docs.stripe.com/payments/payment-methods' }), {
    kind: 'excluded',
  });
});

test('snakeToCamel: matches the documented examples', () => {
  assert.strictEqual(snakeToCamel('payment_intents'), 'paymentIntents');
  assert.strictEqual(snakeToCamel('subscriptions'), 'subscriptions');
  assert.strictEqual(snakeToCamel('create_preview'), 'createPreview');
});

// ── Node.js table parsing ───────────────────────────────────────────────────

test('parseNodeJsChangesTable: form #1 pure page has one row, five method links', () => {
  const rows = parseNodeJsChangesTable(FORM1_MD);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0].parameters, ['payment_method_types']);
  assert.strictEqual(rows[0].changeKind, 'Removed');
  assert.strictEqual(rows[0].links.length, 5);
});

test('parseNodeJsChangesTable: form #2 pure page has a Removed row and an Added row', () => {
  const rows = parseNodeJsChangesTable(FORM2_MD);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].changeKind, 'Removed');
  assert.strictEqual(rows[1].changeKind, 'Added');
});

// ── fan-out: buildDetectedChanges ───────────────────────────────────────────

const indexFetchedAt = '2026-09-01';
const pageFetchedAt = '2026-09-01';

function entryFor(url: string, title: string, release: string) {
  return { title, url, affectedProducts: 'Payments', breaking: true, category: 'api', release };
}

test('buildDetectedChanges: form #1 pure page fans out to 5 auto-executable Changes', () => {
  const entry = entryFor(
    FORM1_URL,
    'Removes support for specifying payment method types in Payment Intents and Setup Intents',
    '2026-08-26.preview',
  );
  const detected = buildDetectedChanges({
    entry,
    pageMarkdown: FORM1_MD,
    indexUrl: 'https://docs.stripe.com/changelog.md',
    indexFetchedAt,
    pageFetchedAt,
  });

  assert.strictEqual(detected.length, 5);
  assert.ok(detected.every((d) => d.autoExecutable), 'every link in this page is method-shaped');
  assert.ok(detected.every((d) => d.classification === 'method'));

  const symbols = detected.map((d) => d.change.target.symbol).sort();
  assert.deepStrictEqual(symbols, [
    'stripe.paymentIntents.confirm',
    'stripe.paymentIntents.create',
    'stripe.paymentIntents.update',
    'stripe.setupIntents.create',
    'stripe.setupIntents.update',
  ]);

  for (const d of detected) {
    assert.strictEqual(d.change.vendor, 'stripe');
    assert.strictEqual(d.change.source, 'changelog');
    assert.strictEqual(d.change.kind, 'breaking');
    assert.strictEqual(d.change.confidence, 'low', 'machine-derived Change is always low confidence');
    assert.strictEqual(d.change.migration.op, 'removed');
    assert.ok(d.change.migration.detail.length > 0, 'migration.detail must never be empty');
    assert.ok(d.change.migration.detail.includes('payment_method_types'));
    assert.ok(d.change.migration.detail.includes('you must remove it before upgrading'), 'must carry the verbatim Impact prose');
    assert.strictEqual(d.change.references.length, 2);
    assert.ok(d.change.references[0].startsWith(FORM1_URL));
    assert.ok(d.change.references[0].includes(pageFetchedAt));
    assert.ok(d.change.references[1].includes('changelog.md'));
    assert.strictEqual(d.change.title, entry.title, 'title is the index title, verbatim');
  }

  // ids are deterministic and unique
  const ids = detected.map((d) => d.change.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'ids must be unique across the fan-out');
  assert.ok(ids.every((id) => id.startsWith('stripe-2026-08-26-preview-')));
});

test('buildDetectedChanges: form #2 pure page is detected and classified, never auto-executable', () => {
  const entry = entryFor(
    FORM2_URL,
    'Adds subscription item-level billing periods and removes subscription-level periods',
    '2025-03-31.basil',
  );
  const detected = buildDetectedChanges({
    entry,
    pageMarkdown: FORM2_MD,
    indexUrl: 'https://docs.stripe.com/changelog.md',
    indexFetchedAt,
    pageFetchedAt,
  });

  assert.strictEqual(detected.length, 1, 'only the Removed row produces a Change; the Added row is skipped');
  assert.strictEqual(detected[0].classification, 'object');
  assert.strictEqual(detected[0].autoExecutable, false);
  assert.strictEqual(detected[0].change.target.symbol, 'stripe.subscriptions.object');
});

test('buildDetectedChanges: mixed page exercises the discriminant in both directions inside one page', () => {
  const entry = entryFor(
    MIXED_URL,
    'Removes coupon and promotion code parameters with stackable discounts',
    '2025-03-31.basil',
  );
  const detected = buildDetectedChanges({
    entry,
    pageMarkdown: MIXED_MD,
    indexUrl: 'https://docs.stripe.com/changelog.md',
    indexFetchedAt,
    pageFetchedAt,
  });

  const objectForm = detected.filter((d) => d.classification === 'object');
  const methodForm = detected.filter((d) => d.classification === 'method');

  // Exact fan-out count, computed by hand from the fixture: `discount` -> 2
  // object links; `promotion_code` -> 4 method links; `coupon` -> 5 method
  // links (create_preview, subscriptions x2, customers x2) plus 4 nested/
  // array links (`Foo.bar.phases[]`) that must be excluded entirely — not
  // counted as either form.
  assert.strictEqual(detected.length, 11);
  assert.strictEqual(objectForm.length, 2);
  assert.strictEqual(methodForm.length, 9);

  assert.ok(objectForm.length > 0, 'the `discount` row is response-shaped (forme #2)');
  assert.ok(objectForm.every((d) => !d.autoExecutable));
  assert.ok(
    objectForm.some((d) => d.change.target.symbol === 'stripe.invoices.object') &&
      objectForm.some((d) => d.change.target.symbol === 'stripe.subscriptions.object'),
  );

  assert.ok(methodForm.length > 0, 'the `promotion_code` row is request-shaped (forme #1)');
  assert.ok(methodForm.every((d) => d.autoExecutable));
  const promotionCodeSymbols = methodForm
    .filter((d) => d.change.migration.detail.startsWith('`promotion_code`'))
    .map((d) => d.change.target.symbol)
    .sort();
  assert.deepStrictEqual(promotionCodeSymbols, [
    'stripe.customers.create',
    'stripe.customers.update',
    'stripe.subscriptions.create',
    'stripe.subscriptions.update',
  ]);
});

// ── network orchestration (hermetic: fetcher is a fixture map, never fetch()) ─

function fixtureFetcher(map: Record<string, string>): Fetcher {
  return async (url: string) => {
    if (!(url in map)) throw new Error(`unexpected fetch: ${url} (test fixtures are hermetic)`);
    return map[url];
  };
}

// The fixture index's "2026-08-26.preview" release has several OTHER Breaking
// rows besides FORM1_URL — detectChanges fetches every Breaking row for the
// requested release, it doesn't cherry-pick. None of those rows are one of
// US-2's three required fixture samples, so any detail-page URL we don't
// recognize gets a minimal stub (empty Node.js table -> contributes nothing),
// while an index URL or a Non-breaking / other-release row would still throw
// if fetched — proving detectChanges' filtering is exactly what it claims.
const CHANGELOG_DETAIL_URL_RE = /^https:\/\/docs\.stripe\.com\/changelog\//;
const STUB_DETAIL_MD = [
  '# stub — not a US-2 fixture, only used to satisfy detectChanges fetching every Breaking row',
  '',
  '## Impact',
  '',
  'n/a for this test.',
  '',
  '## Changes',
  '',
  '#### Node.js',
  '',
  '| Parameter | Change | Resources or methods |',
  '| --- | --- | --- |',
].join('\n');

function fixtureFetcherWithDetailStubFallback(map: Record<string, string>): Fetcher {
  return async (url: string) => {
    if (url in map) return map[url];
    if (CHANGELOG_DETAIL_URL_RE.test(url)) return STUB_DETAIL_MD;
    throw new Error(`unexpected fetch: ${url} (test fixtures are hermetic)`);
  };
}

test('detectChanges: hermetic end-to-end — fetches the index plus every matching-release Breaking detail page, nothing else', async () => {
  const result = await detectChanges({
    fetcher: fixtureFetcherWithDetailStubFallback({
      'https://docs.stripe.com/changelog.md': INDEX_MD,
      [FORM1_URL]: FORM1_MD,
    }),
    release: '2026-08-26.preview',
  });

  // If detectChanges fetched anything outside the index URL or a
  // changelog/ detail page (e.g. some unrelated URL), fixtureFetcherWithDetailStubFallback
  // would throw and this test would fail.
  assert.strictEqual(result.autoExecutable.length, 5, 'only the real fixture page contributes auto-executable changes');
  assert.ok(result.autoExecutable.every((c) => c.confidence === 'low'));
  assert.ok(result.all.every((d) => d.classification === 'method'), 'this release/fixture pair has no forme #2 sample');
});

test('detectChanges: a release absent from the index yields nothing (no crash, no network beyond the index)', async () => {
  const result = await detectChanges({
    fetcher: fixtureFetcher({ 'https://docs.stripe.com/changelog.md': INDEX_MD }),
    release: '1999-01-01.doesnotexist',
  });
  assert.deepStrictEqual(result.autoExecutable, []);
  assert.deepStrictEqual(result.all, []);
  assert.deepStrictEqual(result.gaps, []);
});

// ════════════════════════════════════════════════════════════════════════════
// US-13 — module A
// ════════════════════════════════════════════════════════════════════════════

const ISOLATION_INDEX_MD = readFixture('index-page-isolation.md');
const NO_IMPACT_URL = 'https://docs.stripe.com/changelog/dahlia/2026-03-25/updates-available-checkout-session-ui-modes.md';
const NO_IMPACT_MD = readFixture('updates-available-checkout-session-ui-modes.md');
const NO_CHANGES_URL = 'https://docs.stripe.com/changelog/basil/2025-03-31/billing-mode-default-flexible.md';
const NO_CHANGES_MD = readFixture('billing-mode-default-flexible.md');
const FRENCH_MD = readFixture('removes-payment-method-types-parameter-from-payment-intents-setup-intents.fr.md');

// ── AC4: failure is isolated to ONE PAGE, and the hole carries its URL ──────

test('AC4: a release of 3 pages whose middle page throws on parse still yields the other two pages\' changes, plus ONE gap naming the failing PAGE', async () => {
  const result = await detectChanges({
    fetcher: fixtureFetcher({
      'https://docs.stripe.com/changelog.md': ISOLATION_INDEX_MD,
      [FORM1_URL]: FORM1_MD,
      [NO_IMPACT_URL]: NO_IMPACT_MD,
      [FORM2_URL]: FORM2_MD,
    }),
    release: '2025-06-30.basil',
  });

  // This is the live shape of dahlia/2026-03-25: isolating per RELEASE (US-12)
  // returned 0 changes and one hole named after the release; isolating per PAGE
  // keeps the 5 + 1 that were always readable.
  assert.strictEqual(result.autoExecutable.length, 5, 'the page BEFORE the failure still contributes');
  assert.strictEqual(result.all.length, 6, 'and so does the page AFTER it (5 forme #1 + 1 forme #2)');

  assert.strictEqual(result.gaps.length, 1);
  assert.strictEqual(result.gaps[0].url, NO_IMPACT_URL, 'the hole names the PAGE, which is what makes it actionable');
  assert.strictEqual(result.gaps[0].release, '2025-06-30.basil');
  assert.match(result.gaps[0].reason, /## Impact/, 'the underlying error message is never swallowed');
});

test('AC4: extractImpact\'s guard is NOT relaxed — the very page that throws is still refused, it just no longer costs its siblings', () => {
  assert.throws(() => extractImpact(NO_IMPACT_MD), /no non-empty "## Impact" section/);
  assert.ok(pageIsReadable(NO_IMPACT_MD), 'and it is a perfectly READABLE page: this is a parse refusal, not an unreadable page');
});

test('AC4: a page whose FETCH fails is isolated the same way, and its gap carries the URL that failed', async () => {
  const UNREACHABLE = 'https://docs.stripe.com/changelog/basil/2025-06-30/unreachable.md';
  const index = [
    '## 2025-06-30.basil',
    '',
    '| Title | Affected Products | Breaking change? | Category |',
    '| --- | --- | --- | --- |',
    `| [Unreachable](${UNREACHABLE}) | Payments | Breaking | api |`,
    `| [Readable](${FORM1_URL}) | Payments | Breaking | api |`,
  ].join('\n');

  const result = await detectChanges({
    fetcher: async (url) => {
      if (url === 'https://docs.stripe.com/changelog.md') return index;
      if (url === FORM1_URL) return FORM1_MD;
      throw new Error(`simulated HTTP 503: ${url}`);
    },
    release: '2025-06-30.basil',
  });

  assert.strictEqual(result.autoExecutable.length, 5, 'a dead page never costs a live one its changes');
  assert.deepStrictEqual(result.gaps, [
    { release: '2025-06-30.basil', url: UNREACHABLE, reason: `simulated HTTP 503: ${UNREACHABLE}` },
  ]);
});

// ── AC5: "we could not read it" is not "there is nothing there" ─────────────

test('AC5: the readability sentinel is the TRANSLATABLE English heading vocabulary — and `## Impact`, identical in French, is explicitly excluded', () => {
  assert.ok(pageIsReadable('## What’s new\n\nprose\n'), 'the typographic apostrophe is what all 69 live pages use');
  assert.ok(pageIsReadable("## What's new\n\nprose\n"), 'the straight apostrophe is accepted too — neither spelling exists in French');
  assert.ok(pageIsReadable('## Changes\n\n#### Node.js\n'));
  assert.ok(pageIsReadable('## Upgrade\n\n#### Node.js\n'));
  assert.ok(pageIsReadable('## Related changes\n\n- a link\n'));

  assert.strictEqual(
    pageIsReadable('# A page\n\n## Impact\n\nCeci est en français.\n'),
    false,
    '`## Impact` is spelled identically in French, so it can never prove we read the page',
  );
  assert.strictEqual(pageIsReadable('# A page\n\n### Changes\n\nnot a level-2 heading\n'), false);
  assert.strictEqual(pageIsReadable('<html><body>Service unavailable</body></html>'), false);
});

test('AC5: a READ page with no `## Changes`, or with a `#### Node.js` of upgrade prose, is the ORDINARY case — zero changes and ZERO gaps', async () => {
  const index = [
    '## 2025-09-30.clover',
    '',
    '| Title | Affected Products | Breaking change? | Category |',
    '| --- | --- | --- | --- |',
    `| [Sets the default billing mode to flexible](${NO_CHANGES_URL}) | Billing | Breaking | api |`,
  ].join('\n');

  const result = await detectChanges({
    fetcher: fixtureFetcher({ 'https://docs.stripe.com/changelog.md': index, [NO_CHANGES_URL]: NO_CHANGES_MD }),
    release: '2025-09-30.clover',
  });

  assert.deepStrictEqual(result.all, [], '33 of the 69 live Breaking pages legitimately carry nothing for us');
  assert.deepStrictEqual(
    result.gaps,
    [],
    'this page DOES carry a `#### Node.js` — under `## Upgrade`, holding prose. Keying off it would manufacture 20 false gaps',
  );
});

// ── AC5bis: the calibration, English vs French, on the SAME index ───────────

/** The two-row index both halves of the calibration are served. */
const CALIBRATION_INDEX_MD = [
  '## 2026-08-26.dahlia',
  '',
  '| Title | Affected Products | Breaking change? | Category |',
  '| --- | --- | --- | --- |',
  `| [Removes payment method types](${FORM1_URL}) | Payments | Breaking | api |`,
  `| [Deprecates subscription periods](${FORM2_URL}) | Billing | Breaking | api |`,
].join('\n');

test('AC5bis: on the ENGLISH fixture the rule yields ZERO gaps', async () => {
  const result = await detectChanges({
    fetcher: fixtureFetcher({
      'https://docs.stripe.com/changelog.md': CALIBRATION_INDEX_MD,
      [FORM1_URL]: FORM1_MD,
      [FORM2_URL]: FORM2_MD,
    }),
    release: '2026-08-26.dahlia',
  });

  assert.deepStrictEqual(result.gaps, [], 'no false positive on pages we genuinely read');
  assert.strictEqual(result.autoExecutable.length, 5);
  assert.strictEqual(result.all.length, 6);
});

test('AC5bis: on the SAME index served in FRENCH the rule yields ONE gap PER PAGE (N == M) — the silent HTTP-200 zero becomes a named hole', async () => {
  // The stub serves the French page for BOTH rows: that is exactly what
  // docs.stripe.com does when the `Accept-Language: en-US` header is lost —
  // every page comes back translated, `## Changes` becomes `## Modifications`,
  // and the old code returned autoExecutable: 0, reportOnly: 0, gaps: 0.
  const result = await detectChanges({
    fetcher: fixtureFetcher({
      'https://docs.stripe.com/changelog.md': CALIBRATION_INDEX_MD,
      [FORM1_URL]: FRENCH_MD,
      [FORM2_URL]: FRENCH_MD,
    }),
    release: '2026-08-26.dahlia',
  });

  assert.deepStrictEqual(result.all, [], 'the French page parses to nothing — that part is unchanged and unavoidable');
  assert.strictEqual(result.gaps.length, 2, 'N == M: every page of the release is a hole, which is the LOUD failure mode we want');
  assert.deepStrictEqual(result.gaps.map((g) => g.url).sort(), [FORM2_URL, FORM1_URL].sort());
  for (const gap of result.gaps) {
    assert.match(gap.reason, /fetched, not read/);
    assert.strictEqual(gap.release, '2026-08-26.dahlia');
  }

  // The French page is NOT degenerate: it still carries a full `#### Node.js`
  // table with a `Removed` row. Only the SECTION headings are translated —
  // which is why the sentinel is the heading vocabulary and nothing else.
  assert.ok(FRENCH_MD.includes('#### Node.js'));
  assert.ok(FRENCH_MD.includes('| `payment_method_types` | Removed |'));
});

// ── AC6: the index is an OPTIONAL input, and US-2's behaviour is untouched ──

function countingFetcher(map: Record<string, string>): { fetcher: Fetcher; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const fetcher: Fetcher = async (url) => {
    counts.set(url, (counts.get(url) ?? 0) + 1);
    if (!(url in map)) throw new Error(`unexpected fetch: ${url} (test fixtures are hermetic)`);
    return map[url];
  };
  return { fetcher, counts };
}

test('AC6: given a pre-parsed index, detectChanges fetches NO index at all — only the detail pages', async () => {
  const { fetcher, counts } = countingFetcher({ [FORM1_URL]: FORM1_MD, [FORM2_URL]: FORM2_MD });

  const result = await detectChanges({
    fetcher,
    release: '2026-08-26.dahlia',
    index: { entries: parseChangelogIndex(CALIBRATION_INDEX_MD), fetchedAt: '2026-09-19' },
  });

  assert.strictEqual(counts.get('https://docs.stripe.com/changelog.md'), undefined, 'the index is not re-fetched');
  assert.strictEqual(result.all.length, 6, 'and the result is identical to the self-fetching path');
  assert.ok(
    result.all[0].change.references[1].includes('2026-09-19'),
    'the index consultation date travels with the entries — it is when the index was READ, not when it was reused',
  );
});

test('AC6 NON-REGRESSION: without the option, detectChanges fetches the index exactly once, exactly as US-2 shipped it', async () => {
  const { fetcher, counts } = countingFetcher({
    'https://docs.stripe.com/changelog.md': CALIBRATION_INDEX_MD,
    [FORM1_URL]: FORM1_MD,
    [FORM2_URL]: FORM2_MD,
  });

  await detectChanges({ fetcher, release: '2026-08-26.dahlia' });

  assert.strictEqual(counts.get('https://docs.stripe.com/changelog.md'), 1);
  assert.strictEqual(counts.get(FORM1_URL), 1);
  assert.strictEqual(counts.get(FORM2_URL), 1);
});

// ── US-16, AC2c: an unrecognized Breaking-column value is no longer silent ──

test('findUnclassifiedBreakingRows: a linked row whose Breaking cell is neither "Breaking" nor "Non-breaking" is returned, named — parseChangelogIndex keeps ignoring it, unchanged', () => {
  const md = [
    '## 2025-02-01.acacia',
    '',
    '| Title | Affected Products | Breaking change? | Category |',
    '| --- | --- | --- | --- |',
    '| [Ambiguous row](https://docs.stripe.com/changelog/acacia/2025-02-01/ambiguous.md) | Payments | Maybe | api |',
    '| [A normal row](https://docs.stripe.com/changelog/acacia/2025-02-01/normal.md) | Payments | Breaking | api |',
  ].join('\n');

  const rows = findUnclassifiedBreakingRows(md);
  assert.strictEqual(rows.length, 1, 'the recognized "Breaking" row is not this function\'s concern');
  assert.deepStrictEqual(rows[0], {
    release: '2025-02-01.acacia',
    url: 'https://docs.stripe.com/changelog/acacia/2025-02-01/ambiguous.md',
    title: 'Ambiguous row',
    breakingCell: 'Maybe',
  });

  // parseChangelogIndex's own contract is untouched: it still silently skips
  // the ambiguous row and returns only the recognized one (decision humaine 3
  // du 2026-09-19 — additions only, never a change to this function).
  const entries = parseChangelogIndex(md);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].title, 'A normal row');
});

test('findUnclassifiedBreakingRows: a header/separator row, or a row with no link, is never mistaken for one of these', () => {
  const md = [
    '## 2025-02-01.acacia',
    '',
    '| Title | Affected Products | Breaking change? | Category |',
    '| --- | --- | --- | --- |',
    '| No link here at all | Payments | Maybe | api |',
  ].join('\n');

  assert.deepStrictEqual(findUnclassifiedBreakingRows(md), []);
});

test('findUnclassifiedBreakingRows: zero on the live-shaped fixtures, matching the live measurement (0 of 877 rows)', () => {
  assert.deepStrictEqual(findUnclassifiedBreakingRows(INDEX_MD), []);
});

// ── the release LINE, headings and not rows ─────────────────────────────────

test('parseReleaseHeadings: returns every `## <date>[.<channel>]` heading, including one that carries no exploitable row', () => {
  const md = [
    '## 2015-08-07',
    '',
    'A release with prose only — 2 of the 140 live headings look like this, and they are legitimate.',
    '',
    '## 2024-09-30.acacia',
    '',
    '| Title | Affected Products | Breaking change? | Category |',
    '| --- | --- | --- | --- |',
    '| [A row](https://docs.stripe.com/changelog/acacia/2024-09-30/x.md) | Payments | Breaking | api |',
  ].join('\n');

  assert.deepStrictEqual(parseReleaseHeadings(md), ['2015-08-07', '2024-09-30.acacia']);
  assert.deepStrictEqual(
    [...new Set(parseChangelogIndex(md).map((e) => e.release))],
    ['2024-09-30.acacia'],
    'rows alone cannot see the row-less release — which is why `to` is read off the headings',
  );
});
