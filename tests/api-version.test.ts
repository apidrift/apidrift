/**
 * US-7 — a Change must not be applied to a repo pinned to an OLDER vendor API
 * version.
 *
 * The failure this guards against (proved on agnaistic/agnai in US-6) is
 * invisible to the verifier by construction: the migrated code is syntactically
 * fine and the repo's suite never calls it, so `npm test` stays green and a
 * NON-draft PR goes out carrying a runtime-wrong fix. Every test below is
 * therefore written to fail if the guard is weakened in either direction —
 * blocking too much is a regression too (a skip nobody sees reads as "your
 * code is clean").
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiVersionDate, isPinnedBefore, oldestApiVersion } from '../src/changes/api-version.js';
import { resolvePinnedApiVersion } from '../src/matcher/api-version.js';
import { loadProject } from '../src/matcher/index.js';
import { buildPrBody } from '../src/pr.js';
import { run } from '../src/pipeline.js';
import { stripeSubscriptionPeriodToItems } from '../src/changes/stripe-subscription-current-period-to-items.js';
import { stripeChargesToIntents } from '../src/changes/stripe-charges-to-intents.js';
import { buildDetectedChanges } from '../src/detection/stripe-changelog.js';
import type { Change, Match, VerifyResult } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-out-'));

function makeRepo(files: Record<string, string>): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-apiver-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return repo;
}

function resolveIn(files: Record<string, string>) {
  const repo = makeRepo(files);
  try {
    return resolvePinnedApiVersion(loadProject(repo), 'stripe');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

// ── The pure comparison ─────────────────────────────────────────────────────

test('comparison: a pin from before the change blocks it', () => {
  // The agnai case, reduced to its arithmetic.
  assert.strictEqual(isPinnedBefore('2023-08-16', '2025-03-31.basil'), true);
});

test('comparison: a pin AT the change version is not "before" — the change applies', () => {
  assert.strictEqual(
    isPinnedBefore('2025-03-31.basil', '2025-03-31.basil'),
    false,
    'the comparison must be strict; equality means the account already runs on that version',
  );
});

test('comparison: a pin AFTER the change applies', () => {
  assert.strictEqual(isPinnedBefore('2026-08-26.dahlia', '2025-03-31.basil'), false);
});

test('comparison: only the date head is compared — the channel name carries no order', () => {
  // `.dahlia` < `.preview` lexicographically, but preview is a PARALLEL
  // channel at the same date, not a successor. Comparing the whole string
  // would invent an ordering between them.
  assert.strictEqual(isPinnedBefore('2026-03-25.dahlia', '2026-03-25.preview'), false);
  assert.strictEqual(isPinnedBefore('2026-03-25.preview', '2026-03-25.dahlia'), false);
  // And the alphabetical run acacia < basil < clover < dahlia is a naming
  // coincidence: a LATER date with an EARLIER-sorting channel still wins.
  assert.strictEqual(isPinnedBefore('2026-01-01.acacia', '2025-03-31.basil'), false);
  assert.strictEqual(isPinnedBefore('2024-01-01.dahlia', '2025-03-31.basil'), true);
});

test('comparison: an unreadable version is null, never a guess', () => {
  assert.strictEqual(apiVersionDate('2023-08-16'), '2023-08-16');
  assert.strictEqual(apiVersionDate('2025-03-31.basil'), '2025-03-31');
  assert.strictEqual(apiVersionDate('latest'), null);
  assert.strictEqual(apiVersionDate(''), null);
  assert.strictEqual(apiVersionDate('2025-3-31'), null, 'must be zero-padded to compare lexicographically');
  // Unreadable on either side never blocks: "cannot tell" is handled by
  // disclosure, not by refusing to work.
  assert.strictEqual(isPinnedBefore('latest', '2025-03-31.basil'), false);
  assert.strictEqual(isPinnedBefore('2023-08-16', 'latest'), false);
});

test('comparison: with several pins, the OLDEST is the one compared', () => {
  assert.strictEqual(oldestApiVersion(['2026-08-26.dahlia', '2023-08-16']), '2023-08-16');
  assert.strictEqual(oldestApiVersion(['2023-08-16', '2026-08-26.dahlia']), '2023-08-16');
  assert.strictEqual(oldestApiVersion([]), undefined);
});

// ── The resolver: one assertion per recognized client shape ─────────────────

test('resolver: `import Stripe from "stripe"` + `new Stripe(key, { apiVersion })`', () => {
  const r = resolveIn({
    'src/client.ts': `
      import Stripe from 'stripe';
      export const stripe = new Stripe('sk', { apiVersion: '2023-08-16' });
    `,
  });
  assert.strictEqual(r.status, 'pinned');
  assert.strictEqual(r.source, 'ast-client-option');
  assert.deepStrictEqual(r.versions.map((v) => v.version), ['2023-08-16']);
  assert.ok(r.versions[0].line > 0, 'a site must carry a usable line number');
});

test('resolver: named import `import { Stripe } from "stripe"`', () => {
  const r = resolveIn({
    'src/client.ts': `
      import { Stripe } from 'stripe';
      export const stripe = new Stripe('sk', { apiVersion: '2023-08-16' });
    `,
  });
  assert.strictEqual(r.status, 'pinned');
});

test('resolver: namespace import `import * as S` + `new S.Stripe(...)`', () => {
  const r = resolveIn({
    'src/client.ts': `
      import * as S from 'stripe';
      export const stripe = new S.Stripe('sk', { apiVersion: '2023-08-16' });
    `,
  });
  assert.strictEqual(r.status, 'pinned');
});

test('resolver: `const Stripe = require("stripe")` + `new Stripe(...)`', () => {
  const r = resolveIn({
    'src/client.js': `
      const Stripe = require('stripe');
      const stripe = new Stripe('sk', { apiVersion: '2023-08-16' });
      module.exports = { stripe };
    `,
  });
  assert.strictEqual(r.status, 'pinned');
});

test('resolver: destructured `const { Stripe } = require("stripe")` + `new Stripe(...)`', () => {
  const r = resolveIn({
    'src/client.js': `
      const { Stripe } = require('stripe');
      const stripe = new Stripe('sk', { apiVersion: '2023-08-16' });
      module.exports = { stripe };
    `,
  });
  assert.strictEqual(r.status, 'pinned');
});

test('resolver: CommonJS factory `require("stripe")(key, { apiVersion })`', () => {
  const r = resolveIn({
    'src/client.js': `
      const stripe = require('stripe')(process.env.KEY, { apiVersion: '2023-08-16' });
      module.exports = { stripe };
    `,
  });
  assert.strictEqual(r.status, 'pinned');
});

test('resolver: `apiVersion` as a TS `as`-expression is still a literal', () => {
  // `'2026-08-26.dahlia' as Stripe.LatestApiVersion` is the idiomatic TS
  // spelling; reading it as non-literal would silently disable the guard on
  // most TypeScript repos.
  const r = resolveIn({
    'src/client.ts': `
      import Stripe from 'stripe';
      export const stripe = new Stripe('sk', { apiVersion: '2023-08-16' as Stripe.LatestApiVersion });
    `,
  });
  assert.strictEqual(r.status, 'pinned');
  assert.deepStrictEqual(r.versions.map((v) => v.version), ['2023-08-16']);
});

test('resolver: a client from ANOTHER module is not the vendor', () => {
  const r = resolveIn({
    'src/client.ts': `
      import Stripe from 'not-stripe';
      export const stripe = new Stripe('sk', { apiVersion: '2023-08-16' });
    `,
  });
  assert.deepStrictEqual(r, { status: 'unresolved', reason: 'no-client' });
});

test('resolver: no client construction at all -> no-client', () => {
  const r = resolveIn({
    'src/billing.js': `
      async function getPeriod(stripe, id) { return stripe.subscriptions.retrieve(id); }
      module.exports = { getPeriod };
    `,
  });
  assert.deepStrictEqual(r, { status: 'unresolved', reason: 'no-client' });
});

test('resolver: a client with no options argument -> no-option', () => {
  const r = resolveIn({
    'src/client.ts': `
      import Stripe from 'stripe';
      export const stripe = new Stripe('sk');
    `,
  });
  assert.deepStrictEqual(r, { status: 'unresolved', reason: 'no-option' });
});

test('resolver: an options object without an apiVersion key -> no-option', () => {
  const r = resolveIn({
    'src/client.ts': `
      import Stripe from 'stripe';
      export const stripe = new Stripe('sk', { maxNetworkRetries: 2, timeout: 5000 });
    `,
  });
  assert.deepStrictEqual(r, { status: 'unresolved', reason: 'no-option' });
});

test('resolver: `apiVersion: process.env.X` -> non-literal (we never read .env)', () => {
  const r = resolveIn({
    'src/client.ts': `
      import Stripe from 'stripe';
      export const stripe = new Stripe('sk', { apiVersion: process.env.STRIPE_API_VERSION });
    `,
  });
  assert.deepStrictEqual(r, { status: 'unresolved', reason: 'non-literal' });
});

test('resolver: shorthand `{ apiVersion }` -> non-literal', () => {
  // A ShorthandPropertyAssignment is NOT a PropertyAssignment: it names a
  // variable we would have to evaluate.
  const r = resolveIn({
    'src/client.ts': `
      import Stripe from 'stripe';
      const apiVersion = '2023-08-16';
      export const stripe = new Stripe('sk', { apiVersion });
    `,
  });
  assert.deepStrictEqual(r, { status: 'unresolved', reason: 'non-literal' });
});

test('resolver: a spread degrades the whole options object, literal or not', () => {
  // A later spread can overwrite the literal, and we do not evaluate. Reading
  // the literal here would be a guess.
  const r = resolveIn({
    'src/client.ts': `
      import Stripe from 'stripe';
      export const stripe = new Stripe('sk', { apiVersion: '2023-08-16', ...overrides });
      declare const overrides: object;
    `,
  });
  assert.deepStrictEqual(r, { status: 'unresolved', reason: 'non-literal' });
});

test("resolver: a literal that is not a date ('latest') -> non-literal, never a guess", () => {
  const r = resolveIn({
    'src/client.ts': `
      import Stripe from 'stripe';
      export const stripe = new Stripe('sk', { apiVersion: 'latest' });
    `,
  });
  assert.deepStrictEqual(r, { status: 'unresolved', reason: 'non-literal' });
});

test('resolver: an options argument that is not an object literal -> non-literal', () => {
  const r = resolveIn({
    'src/client.ts': `
      import Stripe from 'stripe';
      declare const opts: any;
      export const stripe = new Stripe('sk', opts);
    `,
  });
  assert.deepStrictEqual(r, { status: 'unresolved', reason: 'non-literal' });
});

test('resolver: two divergent clients -> both reported, the OLDEST is what gets compared', () => {
  const r = resolveIn({
    'src/legacy.ts': `
      import Stripe from 'stripe';
      export const legacy = new Stripe('sk', { apiVersion: '2023-08-16' });
    `,
    'src/modern.ts': `
      import Stripe from 'stripe';
      export const modern = new Stripe('sk', { apiVersion: '2026-08-26.dahlia' });
    `,
  });
  assert.strictEqual(r.status, 'pinned');
  assert.deepStrictEqual(
    r.versions.map((v) => v.version).sort(),
    ['2023-08-16', '2026-08-26.dahlia'],
    'a human must see BOTH — we cannot know which call site belongs to which client',
  );
  assert.strictEqual(oldestApiVersion(r.versions.map((v) => v.version)), '2023-08-16');
});

test('resolver: one readable literal wins over an unreadable sibling (pinned can block, unresolved cannot)', () => {
  const r = resolveIn({
    'src/legacy.ts': `
      import Stripe from 'stripe';
      export const legacy = new Stripe('sk', { apiVersion: '2023-08-16' });
    `,
    'src/env.ts': `
      import Stripe from 'stripe';
      export const other = new Stripe('sk', { apiVersion: process.env.STRIPE_API_VERSION });
    `,
  });
  assert.strictEqual(r.status, 'pinned');
});

test('resolver: the same literal in a .ts and its compiled .js counts ONCE', () => {
  // The agnai shape: a build output committed next to its source. Deduplicated
  // by VALUE, not by site.
  const r = resolveIn({
    'src/client.ts': `
      import Stripe from 'stripe';
      export const stripe = new Stripe('sk', { apiVersion: '2023-08-16' });
    `,
    'lib/client.js': `
      const Stripe = require('stripe');
      const stripe = new Stripe('sk', { apiVersion: '2023-08-16' });
      module.exports = { stripe };
    `,
  });
  assert.strictEqual(r.status, 'pinned');
  assert.strictEqual(r.versions.length, 1, 'the same version found twice is one pin, not two');
});

test('resolver: an apiVersion inside test/ never counts (loadProject excludes it)', () => {
  const r = resolveIn({
    'test/client.test.js': `
      const Stripe = require('stripe');
      const stripe = new Stripe('sk', { apiVersion: '2023-08-16' });
    `,
  });
  assert.deepStrictEqual(r, { status: 'unresolved', reason: 'no-client' });
});

// ── The change data ─────────────────────────────────────────────────────────

test('the subscription change is gated on 2025-03-31.basil, sourced from its own reference', () => {
  const { change } = stripeSubscriptionPeriodToItems;
  assert.strictEqual(change.apiVersion, '2025-03-31.basil');
  assert.ok(
    change.references[0].includes('2025-03-31.basil'),
    'the API version must be traceable to the reference it was read from, not invented',
  );
});

test('charges -> paymentIntents carries NO apiVersion: it is a product deprecation, not a version change', () => {
  // Its source is a migration guide, not a versioned changelog entry. Gating
  // it would block it on repos where it is perfectly valid.
  assert.strictEqual(stripeChargesToIntents.change.apiVersion, undefined);
});

test('a detected change inherits the release heading it was found under as its apiVersion', () => {
  const page = fs.readFileSync(
    path.join(
      repoRoot, 'fixtures', 'stripe-changelog',
      'removes-payment-method-types-parameter-from-payment-intents-setup-intents.md',
    ),
    'utf8',
  );
  const entry = {
    title: 'Removes support for specifying payment method types in Payment Intents and Setup Intents',
    url: 'https://docs.stripe.com/changelog/preview/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-intents.md',
    affectedProducts: 'Payments',
    breaking: true,
    category: 'api',
    release: '2026-08-26.preview',
  };

  const detected = buildDetectedChanges({
    entry,
    pageMarkdown: page,
    indexUrl: 'https://docs.stripe.com/changelog.md',
    indexFetchedAt: '2026-09-03',
    pageFetchedAt: '2026-09-03',
  });
  assert.ok(detected.length > 0, 'expected at least one detected change');
  for (const d of detected) {
    assert.strictEqual(
      d.change.apiVersion,
      '2026-08-26.preview',
      'a machine-detected change is exactly the case that needs the guard: confidence low, no human in the loop',
    );
  }
});

// ── End to end: the agnai case ──────────────────────────────────────────────

test('e2e: the pinned-legacy fixture matches call sites and is then NOT applied', async () => {
  const out = outDir();
  const results = await run(path.join(repoRoot, 'fixtures', 'pinned-legacy-stripe'), { outputDir: out });

  const r = results.find((x) => x.change.id === 'stripe-subscription-current-period-to-items');
  assert.ok(r, 'expected the subscription codemod to run');

  assert.strictEqual(r.applied, false, 'the change must NOT be applied to a repo pinned to 2023-08-16');
  assert.strictEqual(r.skipped?.reason, 'pinned-api-version');
  assert.strictEqual(r.skipped?.pinnedVersion, '2023-08-16');
  assert.strictEqual(r.skipped?.changeApiVersion, '2025-03-31.basil');
  assert.deepStrictEqual(r.skipped?.pinnedVersions.map((v) => v.version), ['2023-08-16']);

  // The whole point of blocking AFTER find(): this is not "your code doesn't
  // use this". We found the sites and chose to leave them alone.
  assert.strictEqual(r.matches.length, 2, 'both current_period_* reads must be reported as found-and-untouched');
  for (const m of [...r.matches, ...r.skipped!.pinnedVersions]) {
    assert.ok(!path.isAbsolute(m.filePath), `paths must be relative, got ${m.filePath}`);
    assert.ok(!m.filePath.includes('apidrift-'), 'no throwaway workspace path may leak into the report');
  }
  assert.deepStrictEqual(r.matches.map((m) => m.filePath), ['src/renewal.js', 'src/renewal.js']);
  assert.strictEqual(r.skipped!.pinnedVersions[0].filePath, 'src/stripe-client.js');

  // Fail-safe means shipping NOTHING: no branch, no verification run, and
  // above all no artifact. A draft PR carrying a known-wrong fix invites a
  // merge.
  assert.strictEqual(r.verify, null, 'nothing was edited, so the suite must not be run');
  assert.strictEqual(r.prPath, null);
  assert.strictEqual(r.patchPath, null);
  assert.strictEqual(r.draft, false);
  assert.deepStrictEqual(fs.readdirSync(out), [], 'a blocked change must write no artifact at all');
});

test('e2e: the fixture source is left untouched on disk (the workspace is disposable)', async () => {
  const file = path.join(repoRoot, 'fixtures', 'pinned-legacy-stripe', 'src', 'renewal.js');
  const before = fs.readFileSync(file, 'utf8');
  await run(path.join(repoRoot, 'fixtures', 'pinned-legacy-stripe'), { outputDir: outDir() });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
  assert.ok(before.includes('subscription.current_period_end'), 'the legacy read is CORRECT here and must survive');
});

test('e2e: a repo pinned AFTER the change still gets the fix (the guard is not a blanket refusal)', async () => {
  // Same code as the blocked fixture, one literal different. If this goes red
  // the guard has stopped discriminating and simply blocks everything.
  const repo = makeRepo({
    'package.json': JSON.stringify({ name: 'modern', type: 'commonjs', scripts: { test: 'node --test' } }, null, 2),
    'src/stripe-client.js': `'use strict';
const Stripe = require('stripe');
const stripe = new Stripe('sk_test', { apiVersion: '2026-08-26.dahlia' });
module.exports = { stripe };
`,
    'src/renewal.js': `'use strict';
const { stripe } = require('./stripe-client');
async function describeRenewal(id) {
  const subscription = await stripe.subscriptions.retrieve(id);
  return subscription.current_period_end;
}
module.exports = { describeRenewal };
`,
    'test/noop.test.js': `'use strict';
const { test } = require('node:test');
test('green', () => {});
`,
  });

  const results = await run(repo, { outputDir: outDir() });
  const r = results.find((x) => x.change.id === 'stripe-subscription-current-period-to-items');

  assert.ok(r);
  assert.strictEqual(r.skipped, undefined, 'a pin newer than the change must not block it');
  assert.strictEqual(r.applied, true, 'the fix must still be produced');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('e2e: a repo pinned EXACTLY on the change version gets the fix (strict comparison)', async () => {
  const repo = makeRepo({
    'package.json': JSON.stringify({ name: 'exact', type: 'commonjs', scripts: { test: 'node --test' } }, null, 2),
    'src/stripe-client.js': `'use strict';
const Stripe = require('stripe');
const stripe = new Stripe('sk_test', { apiVersion: '2025-03-31.basil' });
module.exports = { stripe };
`,
    'src/renewal.js': `'use strict';
const { stripe } = require('./stripe-client');
async function describeRenewal(id) {
  const subscription = await stripe.subscriptions.retrieve(id);
  return subscription.current_period_end;
}
module.exports = { describeRenewal };
`,
    'test/noop.test.js': `'use strict';
const { test } = require('node:test');
test('green', () => {});
`,
  });

  const results = await run(repo, { outputDir: outDir() });
  const r = results.find((x) => x.change.id === 'stripe-subscription-current-period-to-items');
  assert.ok(r);
  assert.strictEqual(r.skipped, undefined, 'equality is not "before"');
  assert.strictEqual(r.applied, true);
  fs.rmSync(repo, { recursive: true, force: true });
});

// ── AC4: no regression on the reference fixture ─────────────────────────────

test('non-regression: acme-payments pins nothing, so both changes still apply exactly as before', async () => {
  const out = outDir();
  const results = await run(path.join(repoRoot, 'fixtures', 'acme-payments'), { outputDir: out });

  assert.strictEqual(results.length, 2);
  for (const r of results) {
    assert.strictEqual(r.skipped, undefined, `${r.change.id} must not be blocked on an unpinned repo`);
    assert.strictEqual(r.applied, true, `${r.change.id} must still be applied`);
    assert.strictEqual(r.verify?.passed, true);
    assert.strictEqual(r.draft, false);
  }

  // `npm run demo` still emits two .md/.patch pairs.
  const artifacts = fs.readdirSync(out).sort();
  assert.strictEqual(artifacts.filter((f) => f.endsWith('.patch')).length, 2);
  assert.strictEqual(artifacts.filter((f) => f.endsWith('.md')).length, 2);

  // The patch CONTENT is unchanged: the guard adds nothing to the diff.
  const subPatch = fs.readFileSync(
    path.join(out, 'apidrift-stripe-subscription-current-period-to-items.patch'), 'utf8',
  );
  assert.ok(subPatch.includes('subscription.items.data[0].current_period_start'));
  assert.ok(subPatch.includes('subscription.items.data[0].current_period_end'));
  assert.ok(!subPatch.includes('apiVersion'), 'the guard must never touch the target repo source');
});

// ── AC3, the other direction: what the PR body discloses ────────────────────

const fakeMatch = { filePath: '/repo/src/a.js', line: 1, snippet: 'x', node: {} } as unknown as Match;
const greenVerify: VerifyResult = { passed: true, command: 'npm test', output: '# pass 1' };
const baseChange: Change = {
  id: 'c', vendor: 'stripe', source: 'changelog', kind: 'breaking', title: 't',
  target: { type: 'symbol', symbol: 'stripe.subscriptions.retrieve' },
  migration: { op: 'param_move', detail: 'd' },
  references: ['https://docs.stripe.com/'], confidence: 'medium',
};

function bodyFor(change: Change, pinnedApiVersion?: Parameters<typeof buildPrBody>[0]['pinnedApiVersion']) {
  return buildPrBody({
    change, matches: [fakeMatch], diff: '--- a/x\n+++ b/x\n',
    verify: greenVerify, workspaceDir: '/repo', draft: false, pinnedApiVersion,
  }).body;
}

test('PR body: a change with no apiVersion says nothing about API versions (zero noise on the existing path)', () => {
  const body = bodyFor(baseChange, { status: 'unresolved', reason: 'no-client' });
  assert.ok(!body.includes('API version'), 'charges -> paymentIntents must be byte-for-byte unaffected');
});

test('PR body: an absent resolution adds no line either (the pre-US-7 call shape still works)', () => {
  const body = bodyFor({ ...baseChange, apiVersion: '2025-03-31.basil' });
  assert.ok(!body.includes('API version'));
});

test('PR body: no pin found -> discloses the implicit stripe-node pin, exactly once', () => {
  const body = bodyFor({ ...baseChange, apiVersion: '2025-03-31.basil' }, { status: 'unresolved', reason: 'no-client' });
  const lines = body.split('\n').filter((l) => l.includes('**API version:**'));
  assert.strictEqual(lines.length, 1, 'exactly one line, inside the existing section');
  assert.ok(lines[0].includes('2025-03-31.basil'));
  assert.ok(/implicitly/i.test(lines[0]), 'the reader must learn that "no pin in the code" is not "latest"');
  // It stays inside "What changed upstream" — no new section, no banner.
  const section = body.split('## What this PR does')[0];
  assert.ok(section.includes('**API version:**'));
});

test('PR body: an unreadable pin asks the reader to confirm it, and says why we could not', () => {
  const body = bodyFor({ ...baseChange, apiVersion: '2025-03-31.basil' }, { status: 'unresolved', reason: 'non-literal' });
  const line = body.split('\n').find((l) => l.includes('**API version:**'))!;
  assert.ok(/cannot read/i.test(line));
  assert.ok(line.includes('2025-03-31.basil'), 'the reader needs the version to confirm against');
  assert.ok(!/implicitly/i.test(line), 'this is a different situation from "no pin at all" and must read differently');
});

test('PR body: a pin at or after the change is confirmed positively, naming the version found', () => {
  const body = bodyFor({ ...baseChange, apiVersion: '2025-03-31.basil' }, {
    status: 'pinned', source: 'ast-client-option',
    versions: [{ version: '2026-08-26.dahlia', filePath: '/repo/src/client.ts', line: 3 }],
  });
  const line = body.split('\n').find((l) => l.includes('**API version:**'))!;
  assert.ok(line.includes('2026-08-26.dahlia'), 'name what we actually found, not just what we needed');
});

test('PR body: the no-option case reads like no-client (both mean "we found no pin")', () => {
  const noOption = bodyFor({ ...baseChange, apiVersion: '2025-03-31.basil' }, { status: 'unresolved', reason: 'no-option' });
  assert.ok(/implicitly/i.test(noOption));
});

// ── AC3, the other direction: what the CLI actually prints ──────────────────

test('CLI: a blocked change is printed — "done — 0 pull requests" alone would read as "your code is clean"', () => {
  const out = outDir();
  const cli = spawnSync(
    'npx',
    ['tsx', 'src/cli.ts', 'run', 'fixtures/pinned-legacy-stripe', '--deterministic-only', '--out', out],
    { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } as NodeJS.ProcessEnv },
  );

  assert.strictEqual(cli.status, 0, `CLI failed:\n${cli.stdout}\n${cli.stderr}`);
  // Strip colors: the assertion is about what a human reads, not escape codes.
  const output = cli.stdout.replace(/\x1b\[[0-9;]*m/g, '');

  assert.ok(/not applied/i.test(output), 'the user must be told the change was NOT applied');
  assert.ok(output.includes('2023-08-16'), 'the pinned version the repo actually has');
  assert.ok(output.includes('2025-03-31.basil'), 'the version the change needs');
  assert.ok(output.includes('src/stripe-client.js'), 'where the pin was found');
  assert.ok(output.includes('src/renewal.js'), 'the sites found and left unchanged');
  assert.ok(/UNCHANGED/.test(output), 'and that they were left alone on purpose');
  assert.deepStrictEqual(fs.readdirSync(out), [], 'still no artifact');
});
