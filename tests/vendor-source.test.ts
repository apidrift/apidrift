/**
 * US-12 — `VendorSource`: one stable entry point onto the two halves that
 * already exist and did not talk to each other (`src/detection/` and
 * `src/matcher/api-version.ts` + `installed-sdk.ts`).
 *
 * Every test here is hermetic (AC9): fetchers are either fixture maps or a
 * stubbed `globalThis.fetch`, never the real network.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePinnedApiVersion } from '../src/matcher/api-version.js';
import { loadProject } from '../src/matcher/index.js';
import { httpFetcher, type Fetcher } from '../src/detection/index.js';
import { parseChangelogIndex } from '../src/detection/stripe-changelog.js';
import { createStripeVendorSource, vendorSourceFor } from '../src/detection/stripe-source.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const fixturesDir = path.join(repoRoot, 'fixtures', 'stripe-changelog');
const readFixture = (name: string) => fs.readFileSync(path.join(fixturesDir, name), 'utf8');

const indexUrl = 'https://docs.stripe.com/changelog.md';
const WALK_INDEX_MD = readFixture('index-walk-excerpt.md');
const FORM1_URL =
  'https://docs.stripe.com/changelog/dahlia/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-intents.md';
const FORM1_MD = readFixture('removes-payment-method-types-parameter-from-payment-intents-setup-intents.md');
const FORM2_URL = 'https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md';
const FORM2_MD = readFixture('deprecate-subscription-current-period-start-and-end.md');

function walkFetcher(): { fetcher: Fetcher; seen: string[] } {
  const seen: string[] = [];
  const fetcher: Fetcher = async (url) => {
    seen.push(url);
    if (url === indexUrl) return WALK_INDEX_MD;
    if (url === FORM1_URL) return FORM1_MD;
    if (url === FORM2_URL) return FORM2_MD;
    throw new Error(`simulated fetch failure: ${url}`);
  };
  return { fetcher, seen };
}

// ── AC2: no vendor registry, one guard that throws ──────────────────────────

test('AC2: vendorSourceFor throws a message naming the vendor for anything other than "stripe" — never a silent empty result', () => {
  assert.throws(
    () => vendorSourceFor('shopify', { fetcher: async () => '' }),
    /shopify/,
    'the error must name the vendor that was asked for',
  );
  assert.throws(() => vendorSourceFor('', { fetcher: async () => '' }));
});

test('AC2: vendorSourceFor("stripe", ...) returns a VendorSource whose `.vendor` is "stripe"', () => {
  const source = vendorSourceFor('stripe', { fetcher: async () => '' });
  assert.strictEqual(source.vendor, 'stripe');
});

// ── P0 point dur #2 — the language choke point ──────────────────────────────

test('httpFetcher: always sends Accept-Language: en-US — without it docs.stripe.com serves French and every detail page silently parses to zero changes in HTTP 200 (US-12 P0 constat 3)', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: string | undefined;
  let capturedHeaders: Record<string, string> | undefined;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedHeaders = init?.headers as Record<string, string> | undefined;
    return { ok: true, text: async () => 'stub body' } as Response;
  }) as typeof fetch;

  try {
    const body = await httpFetcher('https://docs.stripe.com/changelog.md');
    assert.strictEqual(body, 'stub body');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.strictEqual(capturedUrl, 'https://docs.stripe.com/changelog.md');
  assert.deepStrictEqual(
    capturedHeaders,
    { 'Accept-Language': 'en-US' },
    'this is the entire rempart against the silent-French-response failure mode — if this assertion goes red, the choke point was lost',
  );
});

test('httpFetcher: a non-ok response throws rather than returning a body that looks like "no content"', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 503, text: async () => '' })) as unknown as typeof fetch;
  try {
    await assert.rejects(() => httpFetcher('https://docs.stripe.com/changelog.md'), /503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── P0 point dur #3 — the channel-less heading (bare `## <date>`) ───────────

test('parseChangelogIndex: a channel-less `## <date>` heading is now parsed — the exact shape of 99/140 releases on the live changelog, including 2023-08-16 (fixtures/implicit-pinned-stripe\'s pin)', () => {
  const md = [
    '## 2023-08-16',
    '',
    '| Title | Affected Products | Breaking change? | Category |',
    '| --- | --- | --- | --- |',
    '| [A channel-less release row](https://docs.stripe.com/changelog/2023-08-16/some-change.md) | Payments | Breaking | api |',
  ].join('\n');

  const entries = parseChangelogIndex(md);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].release, '2023-08-16', 'the whole heading is the release, verbatim, channel absent');
});

// ── Q1: releases() ───────────────────────────────────────────────────────────

test('releases(): groups every index row under its heading, one VendorRelease per heading, chronological ascending', async () => {
  const { fetcher } = walkFetcher();
  const source = createStripeVendorSource({ fetcher, indexUrl, fetchedAt: () => '2026-09-10' });
  const releases = await source.releases();

  assert.deepStrictEqual(
    releases.map((r) => r.release),
    ['2025-01-01.acacia', '2025-02-01.acacia', '2025-02-15.preview', '2025-03-01.acacia', '2025-04-01.acacia'],
  );
  assert.strictEqual(releases[1].entries.length, 1);
  assert.strictEqual(releases[1].entries[0].url, FORM1_URL);
});

// ── Q3: changesSince() — the central gaps invariant ─────────────────────────

test('changesSince: walks every release on the SAME channel line strictly after `from`, aggregates autoExecutable + reportOnly, and turns one unreachable detail page into a named gap instead of losing the whole run', async () => {
  const { fetcher, seen } = walkFetcher();
  const source = createStripeVendorSource({ fetcher, indexUrl, fetchedAt: () => '2026-09-10' });

  const diff = await source.changesSince('2025-01-01.acacia');

  assert.strictEqual(diff.from, '2025-01-01.acacia');
  assert.strictEqual(diff.to, '2025-04-01.acacia', 'the last release on the acacia line — the preview row must never advance `to`');
  assert.deepStrictEqual(
    diff.releases,
    ['2025-02-01.acacia', '2025-03-01.acacia', '2025-04-01.acacia'],
    'chronological, same-channel-line only, `from` excluded, `2025-02-15.preview` excluded',
  );

  assert.strictEqual(diff.gaps.length, 1, 'exactly one release could not be read');
  assert.strictEqual(diff.gaps[0].release, '2025-03-01.acacia');
  assert.ok(diff.gaps[0].reason.includes('unreachable-detail-page'), 'the reason must name what actually failed, not a generic message');

  assert.strictEqual(diff.autoExecutable.length, 5, 'the form #1 page (2025-02-01.acacia) contributes its 5 auto-executable changes, exactly as in tests/detection.test.ts');
  assert.ok(diff.autoExecutable.every((c) => c.apiVersion === '2025-02-01.acacia'));

  assert.strictEqual(diff.reportOnly.length, 1, 'the form #2 page (2025-04-01.acacia) contributes its one reportOnly change');
  assert.strictEqual(diff.reportOnly[0].change.apiVersion, '2025-04-01.acacia');
  assert.strictEqual(diff.reportOnly[0].autoExecutable, false, 'reportOnly never contains an auto-executable change');

  assert.ok(
    !seen.includes('https://docs.stripe.com/changelog/preview/2025-02-15/off-channel.md'),
    'the preview-channel row must never be fetched at all — it is filtered out before any detail fetch is attempted',
  );
});

test('changesSince: `from` at (or after) the latest release on its line yields no changes and no gaps, not an error', async () => {
  const { fetcher } = walkFetcher();
  const source = createStripeVendorSource({ fetcher, indexUrl, fetchedAt: () => '2026-09-10' });

  const diff = await source.changesSince('2025-04-01.acacia');
  assert.strictEqual(diff.to, '2025-04-01.acacia', 'nothing after `from` on this line, so `to` falls back to `from`');
  assert.deepStrictEqual(diff.releases, []);
  assert.deepStrictEqual(diff.autoExecutable, []);
  assert.deepStrictEqual(diff.reportOnly, []);
  assert.deepStrictEqual(diff.gaps, []);
});

// ── AC6: every URL requested is a public vendor URL, nothing about the target repo leaves ──

test('AC6: every URL changesSince() requests stays on the public docs.stripe.com domain', async () => {
  const { fetcher, seen } = walkFetcher();
  const source = createStripeVendorSource({ fetcher, indexUrl, fetchedAt: () => '2026-09-10' });

  await source.changesSince('2025-01-01.acacia');

  assert.ok(seen.length > 0);
  for (const url of seen) {
    assert.ok(url.startsWith('https://docs.stripe.com/'), `unexpected URL outside the vendor's public domain: ${url}`);
  }
  // `Fetcher` is `(url: string) => Promise<string>` — structurally a GET with
  // no body, no headers, no path from the target repo: there is nothing in
  // this seam a call site could use to leak repo content even if it wanted to.
});

// ── AC3/AC4: resolveCurrentApiVersion is pure delegation, all three PinnedApiVersion states survive ──

function makeRepo(files: Record<string, string>): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-vendorsource-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return repo;
}

test('resolveCurrentApiVersion: identical to resolvePinnedApiVersion on an explicit pin — no logic of its own (AC3)', () => {
  const repo = makeRepo({
    'src/client.ts': `
      import Stripe from 'stripe';
      export const stripe = new Stripe('sk', { apiVersion: '2023-08-16' });
    `,
  });
  try {
    const project = loadProject(repo);
    const source = vendorSourceFor('stripe', { fetcher: async () => '' });
    const viaSource = source.resolveCurrentApiVersion(project, repo);
    const direct = resolvePinnedApiVersion(project, 'stripe', repo);
    assert.deepStrictEqual(viaSource, direct);
    assert.strictEqual(viaSource.status, 'pinned');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('resolveCurrentApiVersion: an uninstalled, unpinned repo resolves to "sdk-not-installed" — "we did not look", never "no pin" (AC4, US-9 invariant preserved)', () => {
  const repo = makeRepo({
    'src/billing.js': `async function getPeriod(stripe, id) { return stripe.subscriptions.retrieve(id); }
module.exports = { getPeriod };
`,
  });
  try {
    const project = loadProject(repo);
    const source = vendorSourceFor('stripe', { fetcher: async () => '' });
    const result = source.resolveCurrentApiVersion(project, repo);
    assert.deepStrictEqual(result, { status: 'unresolved', reason: 'sdk-not-installed' });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('resolveCurrentApiVersion: the implicit-pinned-stripe fixture (no apiVersion anywhere, stripe-node v13 installed) resolves to the installed-sdk-default pin, and the resolved version is walkable by changesSince without US-11\'s absolute-path leak', async () => {
  const fixtureDir = path.join(repoRoot, 'fixtures', 'implicit-pinned-stripe');
  const project = loadProject(fixtureDir);
  const source = vendorSourceFor('stripe', { fetcher: async () => '' });

  const result = source.resolveCurrentApiVersion(project, fixtureDir);
  assert.strictEqual(result.status, 'pinned');
  assert.strictEqual((result as { source: string }).source, 'installed-sdk-default');
  const versions = (result as { versions: Array<{ version: string; filePath: string }> }).versions;
  assert.strictEqual(versions.length, 1);
  assert.strictEqual(versions[0].version, '2023-08-16', 'the exact pin fixtures/implicit-pinned-stripe was built for (US-9 P0)');

  // `resolveCurrentApiVersion` hands back the SAME absolute `filePath` shape
  // `resolvePinnedApiVersion` always has (US-11 is a caller-side leak, not
  // this function's to fix — see the doc comment on the interface). This
  // test locks in that a CALLER must relativize before display, the way
  // src/pipeline.ts already does with `path.relative(workspace, ...)`.
  assert.ok(path.isAbsolute(versions[0].filePath), 'this method\'s contract is absolute paths, exactly like resolvePinnedApiVersion');
  const relative = path.relative(fixtureDir, versions[0].filePath);
  assert.ok(!path.isAbsolute(relative));
  assert.strictEqual(relative, path.join('node_modules', 'stripe', 'cjs', 'apiVersion.js'));

  // This is the point that connects Q2 to Q3: the version resolveCurrentApiVersion
  // reads is now (US-12 point dur #3) a real, walkable heading in the index —
  // '2023-08-16' is channel-less and would have been invisible before the
  // RELEASE_HEADING_RE extension.
  const { fetcher } = walkFetcher();
  const vendorSource = createStripeVendorSource({ fetcher, indexUrl, fetchedAt: () => '2026-09-10' });
  const diff = await vendorSource.changesSince(versions[0].version);
  assert.strictEqual(diff.from, '2023-08-16');
});
