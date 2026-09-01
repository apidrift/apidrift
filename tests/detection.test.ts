import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDetectedChanges,
  classifyLink,
  extractImpact,
  parseChangelogIndex,
  parseNodeJsChangesTable,
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
});
