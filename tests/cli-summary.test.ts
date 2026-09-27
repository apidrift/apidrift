/**
 * US-16, AC3/AC7 — the FIVE distinct outputs, each produced by a PURE function
 * (`src/cli-summary.ts`), captured here with NO subprocess and NO network.
 * `tests/cli-default-path.test.ts` observes each of the five once more,
 * through `runCli`, with its NUMERIC exit code — this file is the other half:
 * the wording itself, and the pairwise-distinctness contract (AC3: "not one
 * of these five may read as another").
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  fetchFailureNote,
  indexIllegibleNote,
  nothingAutoFixableNote,
  pagesUnreadableNote,
  pinProvenanceNote,
} from '../src/cli-summary.js';
import type { PinnedApiVersion } from '../src/matcher/api-version.js';

const URL = 'https://docs.stripe.com/changelog.md';

// ── Sortie (1) — FETCH KO ────────────────────────────────────────────────────

test('fetchFailureNote: a plain Error (no cause) falls back to err.message — the pre-US-16 shape, unchanged', () => {
  const note = fetchFailureNote(URL, new Error('fetch failed'));
  assert.match(note, /fetch failed/);
  assert.match(note, new RegExp(URL.replace(/[.]/g, '\\.')));
  assert.match(note, /action:/);
});

test('fetchFailureNote: err.cause.code (ENOTFOUND, ECONNREFUSED, ...) is named — the ROOT cause, not the wrapper', () => {
  const err = new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  const note = fetchFailureNote(URL, err);
  assert.match(note, /ENOTFOUND/);
});

test('fetchFailureNote: a TimeoutError is named as a timeout, with the bound it hit — never as a generic cause', () => {
  const err = new Error('the operation was aborted due to timeout');
  err.name = 'TimeoutError';
  const note = fetchFailureNote(URL, err);
  assert.match(note, /timeout after 30s/);
  assert.ok(!note.includes('ENOTFOUND'));
});

test('fetchFailureNote: an HTTP non-200 (httpFetcher\'s own thrown message) is carried verbatim (AC1c, unchanged)', () => {
  const note = fetchFailureNote(URL, new Error(`detection: GET ${URL} -> HTTP 500`));
  assert.match(note, /HTTP 500/);
});

// ── Sortie (2) — INDEX ILLISIBLE ─────────────────────────────────────────────

test('indexIllegibleNote: zero-headings and zero-classable-rows are two DIFFERENT sentences, both fatal-shaped', () => {
  const zeroHeadings = indexIllegibleNote(URL, { kind: 'zero-headings' });
  const zeroRows = indexIllegibleNote(URL, { kind: 'zero-classable-rows', headingCount: 5 });

  assert.match(zeroHeadings, /ZERO release headings/);
  assert.match(zeroRows, /5 release heading\(s\)/);
  assert.match(zeroRows, /ZERO classable row/);
  assert.notStrictEqual(zeroHeadings, zeroRows);
  for (const note of [zeroHeadings, zeroRows]) {
    assert.match(note, /NOT a network failure/i);
    assert.match(note, /action:/);
  }
});

// ── Sortie (3) — PAGES ILLISIBLES ────────────────────────────────────────────

test('pagesUnreadableNote: names N of M, lists each gap with its release/url/reason, and hints at language/proxy ONLY when N == M > 0', () => {
  const partial = pagesUnreadableNote({
    unread: 1,
    attempted: 3,
    gaps: [{ release: '2025-03-01.acacia', url: 'https://docs.stripe.com/x.md', reason: 'boom' }],
  });
  assert.match(partial, /1 of 3 Breaking page\(s\)/);
  assert.match(partial, /2025-03-01\.acacia/);
  assert.match(partial, /https:\/\/docs\.stripe\.com\/x\.md/);
  assert.match(partial, /boom/);
  assert.ok(!/language-negotiation/.test(partial), 'N < M: no reason to suspect language/proxy for EVERY page');
  assert.match(partial, /action:/);

  const allFailed = pagesUnreadableNote({
    unread: 2,
    attempted: 2,
    gaps: [
      { release: '2025-03-01.acacia', url: 'https://docs.stripe.com/x.md', reason: 'boom' },
      { release: '2025-04-01.acacia', url: 'https://docs.stripe.com/y.md', reason: 'boom' },
    ],
  });
  assert.match(allFailed, /2 of 2 Breaking page\(s\)/);
  assert.match(allFailed, /language-negotiation/);
  assert.match(allFailed, /action:.*language\/proxy/);
});

// ── Sortie (4) — A JOUR, PROVENANCE ──────────────────────────────────────────

const rel = (p: string) => p.replace('/repo/', '');

test('pinProvenanceNote: an explicit pin names the file:line it was read from', () => {
  const pinned: PinnedApiVersion = {
    status: 'pinned', source: 'ast-client-option',
    versions: [{ version: '2025-04-01.acacia', filePath: '/repo/src/pay.js', line: 2 }],
  };
  const note = pinProvenanceNote(pinned, undefined, rel);
  assert.match(note, /pinned explicitly/);
  assert.match(note, /src\/pay\.js:2/);
});

test('pinProvenanceNote: an implicit SDK default names the SDK version, not a file', () => {
  const pinned: PinnedApiVersion = {
    status: 'pinned', source: 'installed-sdk-default', sdkVersion: '13.0.0',
    versions: [{ version: '2023-08-16', filePath: '/repo/node_modules/stripe/apiVersion.js', line: 1 }],
  };
  const note = pinProvenanceNote(pinned, undefined, rel);
  assert.match(note, /IMPLICITLY/);
  assert.match(note, /v13\.0\.0/);
});

test('pinProvenanceNote: --since overrides the resolved pin, and says so — even when a pin WAS resolved', () => {
  const pinned: PinnedApiVersion = {
    status: 'pinned', source: 'ast-client-option',
    versions: [{ version: '2025-04-01.acacia', filePath: '/repo/src/pay.js', line: 2 }],
  };
  const note = pinProvenanceNote(pinned, '2025-03-31.basil', rel);
  assert.match(note, /--since 2025-03-31\.basil/);
  assert.match(note, /explicit override/);
  assert.ok(!note.includes('src/pay.js'), '--since wins over the resolved pin — the file it lives in is not the story here');
});

// ── Sortie (5) — RIEN D'AUTO-CORRIGEABLE ─────────────────────────────────────

test('nothingAutoFixableNote: names releases walked, forme #1 without a site, forme #2 report-only, and gaps — with an action', () => {
  const note = nothingAutoFixableNote({ releasesWalked: 3, formOneNoSite: 2, reportOnly: 1, gaps: 1 });
  assert.match(note, /3 release\(s\)/);
  assert.match(note, /2 request-shaped/);
  assert.match(note, /1 response-shaped/);
  assert.match(note, /1 page\(s\) could not be read/);
  assert.match(note, /action:.*report-only/i);
});

// ── AC3/AC7: the FIVE sentences, captured and compared PAIRWISE (10 pairs), ──
// each carrying its own action. Not "different from the first" — different
// from EVERY OTHER ONE.

test('AC3/AC7: the five canonical sentences are pairwise distinct (10 pairs) and each names an action', () => {
  const five: Record<string, string> = {
    '1-fetch-KO': fetchFailureNote(URL, new Error('fetch failed')),
    '2-index-illisible': indexIllegibleNote(URL, { kind: 'zero-headings' }),
    '3-pages-illisibles': pagesUnreadableNote({
      unread: 1, attempted: 3,
      gaps: [{ release: '2025-03-01.acacia', url: 'https://docs.stripe.com/x.md', reason: 'boom' }],
    }),
    '4-a-jour': [
      '2025-04-01.acacia IS the latest release published on its line — the vendor has changed nothing since. Checked, not assumed.',
      `version resolved from: ${pinProvenanceNote(
        { status: 'pinned', source: 'ast-client-option', versions: [{ version: '2025-04-01.acacia', filePath: '/repo/src/pay.js', line: 2 }] },
        undefined,
        rel,
      )}.`,
      '  action: nothing — this repo is current.',
    ].join('\n'),
    '5-rien-auto-corrigeable': nothingAutoFixableNote({ releasesWalked: 3, formOneNoSite: 2, reportOnly: 1, gaps: 1 }),
  };

  const ids = Object.keys(five);
  assert.strictEqual(ids.length, 5);

  let pairs = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs += 1;
      assert.notStrictEqual(five[ids[i]], five[ids[j]], `${ids[i]} must read differently from ${ids[j]}`);
    }
  }
  assert.strictEqual(pairs, 10, 'five sentences, ten pairs — not "different from the first"');

  for (const [id, sentence] of Object.entries(five)) {
    assert.match(sentence, /action:/i, `${id} must name what a human can do next (AC7)`);
  }
});
