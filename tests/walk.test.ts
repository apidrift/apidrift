/**
 * US-13, module A — release selection and the four bounds, tested PURELY
 * (AC12): every case below runs on an ARRAY OF STRINGS. No Markdown, no
 * fetcher, no network (AC13). Before `selectReleases` was extracted, none of
 * this could be reached without a fixture index and a stub fetcher.
 *
 * The release names are the real ones from the live changelog because the
 * measurements this US is built on are stated in those terms — they are still
 * just strings to the code under test.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundIsReadable, isPreviewRelease, selectReleases } from '../src/detection/walk.js';
import { changesSinceBound, resolveWalkBound } from '../src/detection/bound.js';
import { createStripeVendorSource } from '../src/detection/stripe-source.js';
import type { Fetcher } from '../src/detection/index.js';
import type { PinnedApiVersion, UnresolvedPinReason } from '../src/matcher/api-version.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

/**
 * The shape of the live index, reduced to its five stable segments plus the
 * parallel preview line: channel-less -> acacia -> basil -> clover -> dahlia,
 * with `.preview` releases interleaved BY DATE (2026-04-22.preview really does
 * precede 2026-04-22.dahlia in the live document — document order is not a
 * chronology, which is why nothing here relies on it).
 */
const LIVE_SHAPED_INDEX = [
  '2023-08-16',
  '2023-10-16',
  '2024-04-10',
  '2024-06-20',
  '2024-09-30.acacia',
  '2025-03-31.basil',
  '2025-09-30.clover',
  '2026-03-25.dahlia',
  '2026-04-22.preview',
  '2026-04-22.dahlia',
  '2026-08-26.preview',
  '2026-08-26.dahlia',
];

// ── AC1: the stable line is continuous ACROSS channel changes ───────────────

test('AC1: from a channel-less bound, the walk crosses (no channel) -> acacia -> basil -> clover -> dahlia and reaches the last release published on the line', () => {
  const selection = selectReleases(LIVE_SHAPED_INDEX, '2023-08-16');

  // The EXACT set, not "includes": US-12's strict channel equality would stop
  // at 2024-06-20 (measured live: 3 releases / 14 Breaking pages instead of
  // 27 / 69, missing 2025-03-31.basil which alone carries 25 of the 28
  // auto-executable changes of the range).
  assert.deepStrictEqual(selection.walked, [
    '2023-10-16',
    '2024-04-10',
    '2024-06-20',
    '2024-09-30.acacia',
    '2025-03-31.basil',
    '2025-09-30.clover',
    '2026-03-25.dahlia',
    '2026-04-22.dahlia',
    '2026-08-26.dahlia',
  ]);
  assert.strictEqual(selection.to, '2026-08-26.dahlia');
  assert.strictEqual(selection.status, 'behind');
});

test('AC1: the order is computed from the DATE, never read off the document — shuffling the index changes nothing', () => {
  const shuffled = [...LIVE_SHAPED_INDEX].reverse();
  assert.deepStrictEqual(
    selectReleases(shuffled, '2023-08-16'),
    selectReleases(LIVE_SHAPED_INDEX, '2023-08-16'),
  );
});

test('AC1: a channel nobody has heard of yet falls into the stable line by default — no table to maintain (AC1bis)', () => {
  const withFutureChannel = [...LIVE_SHAPED_INDEX, '2027-02-01.elderflower'];
  const selection = selectReleases(withFutureChannel, '2026-08-26.dahlia');

  assert.deepStrictEqual(selection.walked, ['2027-02-01.elderflower']);
  assert.strictEqual(selection.to, '2027-02-01.elderflower');
});

// ── AC1bis: no ordered list of channel names, anywhere in the walk's code ───

test('AC1bis: src/detection/walk.ts contains NO channel-name list — `.preview` is the only channel literal in it', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src', 'detection', 'walk.ts'), 'utf8');
  // Strip comments first: the module documents the measured channel SUCCESSION
  // in prose, which is exactly the thing that must not be in the CODE.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  assert.doesNotMatch(
    code,
    /acacia|basil|clover|dahlia/i,
    'a channel name in the code is the silently-expiring table D2 and US-9 both refused',
  );
  assert.deepStrictEqual(
    [...code.matchAll(/'\.[a-z]+'/g)].map((m) => m[0]),
    ["'.preview'"],
    'exactly one channel-suffix literal is allowed, and it is the AC2 exclusion',
  );
});

// ── AC2: `.preview` is excluded by a NAMED condition, not as a side effect ──

test('AC2 MUTATION: deleting the `.preview` exclusion makes these assertions red, not merely a count different', () => {
  const selection = selectReleases(LIVE_SHAPED_INDEX, '2026-03-25.dahlia');

  // Without the condition, `walked` would additionally contain
  // 2026-04-22.preview and 2026-08-26.preview — the shape of the live
  // measurement where a perfectly up-to-date repo collected 20 Breaking
  // changes, all of them from preview releases (signal/noise 0/20).
  assert.deepStrictEqual(selection.walked, ['2026-04-22.dahlia', '2026-08-26.dahlia']);
  assert.deepStrictEqual(selection.skippedPreview, ['2026-04-22.preview', '2026-08-26.preview']);
  assert.strictEqual(selection.to, '2026-08-26.dahlia', 'a preview release must never advance `to`');
});

test('AC2 reciprocal: a `.preview` bound walks the preview line ONLY', () => {
  const selection = selectReleases(LIVE_SHAPED_INDEX, '2026-04-22.preview');

  assert.deepStrictEqual(selection.walked, ['2026-08-26.preview']);
  assert.strictEqual(selection.to, '2026-08-26.preview');
  assert.deepStrictEqual(selection.skippedPreview, [], 'stable releases are off-line here, not "skipped previews"');
});

test('AC2: the exclusion is a suffix rule, so it never mistakes a release whose channel merely CONTAINS the word', () => {
  assert.strictEqual(isPreviewRelease('2026-08-26.preview'), true);
  assert.strictEqual(isPreviewRelease('2026-08-26.previewer'), false);
  assert.strictEqual(isPreviewRelease('2023-08-16'), false);
});

// ── AC3: the four bounds, one distinct outcome each ─────────────────────────

test('AC3(a): a bound EQUAL to the last release of its line is "up to date" — zero releases, and `to` still comes from the INDEX', () => {
  const selection = selectReleases(LIVE_SHAPED_INDEX, '2026-08-26.dahlia');

  assert.strictEqual(selection.status, 'up-to-date');
  assert.deepStrictEqual(selection.walked, []);
  assert.strictEqual(selection.to, '2026-08-26.dahlia');
  assert.deepStrictEqual(selection.skippedPreview, [], 'nothing on the preview line is newer than this bound either');
});

test('AC3(b): a bound NEWER than anything the index publishes is a DISTINCT case from "up to date", and `to` is the index\'s last release — never a fallback onto `from`', () => {
  const selection = selectReleases(LIVE_SHAPED_INDEX, '2030-01-01.dahlia');

  assert.strictEqual(selection.status, 'ahead-of-index');
  assert.notStrictEqual(selection.status, 'up-to-date', 'same empty walk, two different things to say');
  assert.deepStrictEqual(selection.walked, []);
  assert.strictEqual(
    selection.to,
    '2026-08-26.dahlia',
    'this is the assertion the old `to = inRange.length > 0 ? last : from` could not pass',
  );
});

test('AC3(c): an UNREADABLE bound stops the walk and says so — it is never compared as a string', () => {
  for (const bound of ['latest', '', '2026-03', 'v2', 'sk_live_whoops']) {
    const selection = selectReleases(LIVE_SHAPED_INDEX, bound);
    assert.strictEqual(selection.status, 'unreadable-bound', `bound: ${JSON.stringify(bound)}`);
    assert.strictEqual(selection.unreadableBound, true);
    assert.deepStrictEqual(selection.walked, [], 'no blind walk on a bound we cannot order');
    assert.strictEqual(selection.to, bound, 'we never looked at the index, so `to` reports nothing more than the bound');
  }

  // The old code did `release > from`: with `from = ''` every release compares
  // greater, so it walked the ENTIRE changelog, silently.
  assert.strictEqual(boundIsReadable(''), false);
  assert.strictEqual(boundIsReadable('latest'), false);
  assert.strictEqual(boundIsReadable('2023-08-16'), true);
});

test('AC3: every bound comparison goes through the DATE — a same-date preview is not "after" a stable release', () => {
  // Lexicographically '2026-04-22.preview' > '2026-04-22.dahlia', which is the
  // trap: same day, parallel line, no order between them at all.
  const selection = selectReleases(['2026-04-22.dahlia', '2026-04-22.preview'], '2026-04-22.dahlia');

  assert.strictEqual(selection.status, 'up-to-date');
  assert.deepStrictEqual(selection.walked, []);
  assert.deepStrictEqual(selection.skippedPreview, []);
});

test('AC3: a line the index does not publish at all is its own, non-crashing outcome', () => {
  const selection = selectReleases(['2026-04-22.preview', '2026-08-26.preview'], '2023-08-16');

  assert.strictEqual(selection.status, 'line-not-published');
  assert.deepStrictEqual(selection.walked, []);
  assert.strictEqual(selection.to, '2023-08-16');
});

test('selectReleases tolerates duplicates and unorderable headings without inventing an order for them', () => {
  const selection = selectReleases(
    ['2024-06-20', '2024-06-20', 'not-a-release', '2024-09-30.acacia'],
    '2023-08-16',
  );
  assert.deepStrictEqual(selection.walked, ['2024-06-20', '2024-09-30.acacia']);
});

// ── US-16, AC2b: THE INDEX-LINE SENTINEL — >= 1 heading, ZERO classable row ──

test('AC2b: >= 1 heading but classifiableRowCount === 0 is its own fatal status, distinct from index-empty', () => {
  const selection = selectReleases(LIVE_SHAPED_INDEX, '2023-08-16', 0);

  assert.strictEqual(selection.status, 'index-unclassable');
  assert.deepStrictEqual(selection.walked, [], 'no blind walk on an index we could not classify');
  assert.strictEqual(selection.to, '2023-08-16', 'we never looked further than the headings, so `to` reports nothing more than the bound');
  assert.notStrictEqual(
    selectReleases([], '2023-08-16').status,
    selection.status,
    'zero headings (index-empty) and headings-with-zero-rows (index-unclassable) must never collapse into one status',
  );
});

test('AC2b: omitting classifiableRowCount (every caller that predates this check) leaves selectReleases exactly as it always was', () => {
  assert.strictEqual(selectReleases(LIVE_SHAPED_INDEX, '2023-08-16').status, 'behind');
  assert.strictEqual(selectReleases(LIVE_SHAPED_INDEX, '2023-08-16', undefined).status, 'behind');
});

test('AC2b: a NON-zero classifiableRowCount never triggers the sentinel, however small', () => {
  assert.strictEqual(selectReleases(LIVE_SHAPED_INDEX, '2023-08-16', 1).status, 'behind');
});

// ── AC3(d): an UNRESOLVED bound — no walk, zero fetch, and a way out ────────

const UNRESOLVED_REASONS: UnresolvedPinReason[] = [
  'no-client',
  'no-option',
  'non-literal',
  'sdk-not-installed',
  'sdk-predates-implicit-pin',
  'sdk-version-unreadable',
];

test('AC3(d): the six UnresolvedPinReason values get six DISTINCT sentences, each naming the `--since <api-version>` escape hatch with an example', () => {
  const messages = UNRESOLVED_REASONS.map((reason) => {
    const resolution = resolveWalkBound({ status: 'unresolved', reason });
    assert.strictEqual(resolution.status, 'unresolved');
    return (resolution as { message: string }).message;
  });

  assert.strictEqual(new Set(messages).size, 6, 'never merged — six reasons, six remedies (US-9 D3, US-13 D2b)');
  for (const message of messages) {
    assert.match(message, /--since <api-version>/, 'a message that does not say HOW to supply the bound fails AC3(d)');
    assert.match(message, /--since 2025-03-31\.basil/, 'and it must carry a concrete example');
  }

  // The one reason that is neither a pin nor an absence of pin: the version in
  // force is the ACCOUNT default, dashboard-side, out of reach of any static
  // analysis. D2b requires its own sentence for it.
  const predates = messages[UNRESOLVED_REASONS.indexOf('sdk-predates-implicit-pin')];
  assert.match(predates, /account default/i);
  assert.match(predates, /dashboard/i);

  // "We could not look" must never read as "there is nothing there".
  assert.match(messages[UNRESOLVED_REASONS.indexOf('sdk-not-installed')], /uninstalled clone|Install the dependencies/);
});

test('AC3(d): a pinned bound resolves to the OLDEST version — the same conservative choice the pipeline guard makes', () => {
  const pinned: PinnedApiVersion = {
    status: 'pinned',
    source: 'ast-client-option',
    versions: [
      { version: '2025-03-31.basil', filePath: '/tmp/a.ts', line: 1 },
      { version: '2023-08-16', filePath: '/tmp/b.ts', line: 1 },
    ],
  };
  assert.deepStrictEqual(resolveWalkBound(pinned), { status: 'resolved', from: '2023-08-16' });
});

test('AC3(d) INVARIANT: an unresolved bound performs ZERO fetches — not one byte of index is downloaded for a walk that cannot happen', async () => {
  let fetches = 0;
  const countingFetcher: Fetcher = async () => {
    fetches += 1;
    return '';
  };
  const source = createStripeVendorSource({ fetcher: countingFetcher, fetchedAt: () => '2026-09-19' });

  const { bound, diff } = await changesSinceBound(source, { status: 'unresolved', reason: 'sdk-not-installed' });

  assert.strictEqual(diff, null, 'no diff at all — not an empty one, which would read as "nothing changed"');
  assert.strictEqual(bound.status, 'unresolved');
  assert.strictEqual(fetches, 0, 'the walk is not even started, so nothing is downloaded (and no token can follow)');
});

test('AC3(d): a resolved bound DOES walk — the gate is the bound, not a switch that disables detection', async () => {
  // US-16, AC2b note: the `2026-08-26.dahlia` heading itself carries no
  // exploitable row on purpose (this fixture's own point, pre-dating US-16) —
  // that is the documented legitimate case (stripe-changelog.ts: "2 of the 140
  // live headings carry no exploitable row"), NOT the AC2b sentinel, which is
  // about the WHOLE index having zero classable rows anywhere. A leading
  // `2020-01-01` row (before `from`, so it changes nothing else this test
  // asserts: it is excluded from `walked` by `date > fromDate` same as
  // always, and `to` is still the LATEST date) keeps the index's overall
  // classable-row count non-zero, matching the shape of the real changelog
  // this fixture stands in for.
  const index = [
    '## 2020-01-01',
    '',
    '| Title | Affected Products | Breaking change? | Category |',
    '| --- | --- | --- | --- |',
    '| [Unrelated older row](https://docs.stripe.com/changelog/2020-01-01/older.md) | Payments | Breaking | api |',
    '',
    '## 2026-08-26.dahlia',
    '',
    '| Title | Affected Products | Breaking change? | Category |',
    '| --- | --- | --- | --- |',
  ].join('\n');
  let fetches = 0;
  const fetcher: Fetcher = async () => {
    fetches += 1;
    return index;
  };
  const source = createStripeVendorSource({ fetcher, fetchedAt: () => '2026-09-19' });

  const { diff } = await changesSinceBound(source, {
    status: 'pinned',
    source: 'installed-sdk-default',
    sdkVersion: '13.0.0',
    versions: [{ version: '2023-08-16', filePath: '/tmp/apiVersion.js', line: 1 }],
  });

  assert.ok(diff, 'a resolved bound must produce a diff');
  assert.strictEqual(diff!.from, '2023-08-16');
  assert.strictEqual(diff!.to, '2026-08-26.dahlia');
  assert.strictEqual(fetches, 1);
});
