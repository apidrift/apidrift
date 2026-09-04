/**
 * US-9 — the pin nobody wrote.
 *
 * US-7 closed the readable pin. The hole left behind: since stripe-node
 * v12.0.0 the SDK sends a `Stripe-Version` header even when the caller passes
 * no `apiVersion` at all (`props.apiVersion || DEFAULT_API_VERSION`, with
 * `DEFAULT_API_VERSION = apiVersion.ApiVersion` from v12 on). A repo on
 * stripe v13 with a bare `new Stripe(key)` really runs on `2023-08-16`; US-7
 * calls that `no-option`, applies a `2025-03-31.basil` change and ships a
 * green-but-wrong PR. That is the agnai failure (US-6) with the explicit pin
 * removed.
 *
 * Two invariants every test below is written to break if weakened:
 *   1. the version is READ, never derived. No SDK -> API-version table exists
 *      anywhere in the code, because a table's failure mode is precisely the
 *      silent false negative this US closes.
 *   2. "we could not look" never renders as "there is no pin". Three unknowns
 *      (`sdk-not-installed`, `sdk-predates-implicit-pin`,
 *      `sdk-version-unreadable`) stay three unknowns, all the way to the
 *      terminal and the PR body.
 *
 * ZERO network: no `npm install`, no fetch. The committed stub under
 * fixtures/implicit-pinned-stripe/node_modules/stripe/ and the tiny stubs
 * written below are the only sources.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInstalledSdkDefaultApiVersion } from '../src/matcher/installed-sdk.js';
import { resolvePinnedApiVersion } from '../src/matcher/api-version.js';
import { loadProject } from '../src/matcher/index.js';
import { apiVersionNote, buildPrBody } from '../src/pr.js';
import { run } from '../src/pipeline.js';
import type { Change, Match, VerifyResult } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const fixture = path.join(repoRoot, 'fixtures', 'implicit-pinned-stripe');
const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-out-'));

const disposables: string[] = [];
function makeRepo(files: Record<string, string>): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-sdk-'));
  disposables.push(repo);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return repo;
}

/**
 * The two files — and ONLY the two files — the resolver reads out of an
 * installed package. `apiVersionFiles` is keyed by directory (`cjs`, `esm`,
 * `lib`) so a test can put the generated file exactly where a given release
 * really put it.
 */
function sdkStub(version: string | null, apiVersionFiles: Record<string, string> = {}): Record<string, string> {
  const files: Record<string, string> = {};
  if (version !== null) {
    files['node_modules/stripe/package.json'] = `{"name":"stripe","version":${JSON.stringify(version)}}`;
  }
  for (const [dir, content] of Object.entries(apiVersionFiles)) {
    files[`node_modules/stripe/${dir}/apiVersion.js`] = content;
  }
  return files;
}

/** The generated CJS file, in the shape tsc emits — `void 0` preamble included. */
const CJS_GENERATED = (v: string) => `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiVersion = void 0;
// File generated from our OpenAPI spec
exports.ApiVersion = '${v}';
`;

// ── The reader: two files, zero table (AC2, AC3, AC4) ──────────────────────

test('reader: the CJS shape — reads the literal, past the `use strict` and `void 0` traps', () => {
  const repo = makeRepo(sdkStub('13.0.0', { cjs: CJS_GENERATED('2023-08-16') }));
  const r = resolveInstalledSdkDefaultApiVersion(repo, 'stripe');

  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.apiVersion, '2023-08-16', 'the value is READ from the file, never derived from the major');
  assert.strictEqual(r.sdkVersion, '13.0.0');
  assert.ok(r.filePath.endsWith(path.join('node_modules', 'stripe', 'cjs', 'apiVersion.js')));
  assert.ok(r.line > 0, 'a site must carry a usable line number');
});

test('reader: the ESM shape — `export const ApiVersion = ...`', () => {
  const repo = makeRepo(sdkStub('14.0.0', {
    esm: "// File generated from our OpenAPI spec\nexport const ApiVersion = '2023-10-16';\n",
  }));
  const r = resolveInstalledSdkDefaultApiVersion(repo, 'stripe');
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.apiVersion, '2023-10-16');
});

test('reader: the object-export shape — `module.exports = { ApiVersion: ... }`', () => {
  const repo = makeRepo(sdkStub('12.0.0', {
    lib: "'use strict';\nmodule.exports = { ApiVersion: '2022-11-15' };\n",
  }));
  const r = resolveInstalledSdkDefaultApiVersion(repo, 'stripe');
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(
    r.apiVersion, '2022-11-15',
    'v12 pins 2022-11-15 — the SAME version as v11. The SDK release date is NOT the API version.',
  );
});

test('reader: the v22 trap — `exports.ApiMajorVersion = exports.ApiVersion = void 0` is not an assignment of a version', () => {
  // Two traps in one real file: the chained `void 0` initialiser, and a
  // NEIGHBOURING export whose value is a channel name, not a date. Reading
  // either would put garbage into a version comparison.
  const repo = makeRepo(sdkStub('22.6.1', {
    cjs: `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiMajorVersion = exports.ApiVersion = void 0;
// File generated from our OpenAPI spec
exports.ApiVersion = '2026-08-26.dahlia';
exports.ApiMajorVersion = 'dahlia';
`,
  }));
  const r = resolveInstalledSdkDefaultApiVersion(repo, 'stripe');
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.apiVersion, '2026-08-26.dahlia');
});

test('reader: `ApiMajorVersion` alone is never mistaken for a version', () => {
  const repo = makeRepo(sdkStub('19.0.0', {
    cjs: `"use strict";\nexports.ApiMajorVersion = 'clover';\n`,
  }));
  const r = resolveInstalledSdkDefaultApiVersion(repo, 'stripe');
  assert.deepStrictEqual(
    r, { status: 'unresolved', reason: 'sdk-version-unreadable', sdkVersion: '19.0.0' },
    "'clover' is a channel name, not a date — a shape we do not understand must read as unreadable",
  );
});

test('reader: a literal that is not an API version is refused (the OPENAPI_VERSION confusion)', () => {
  // `OPENAPI_VERSION` (v18+) is 'v2442', a spec build number. If a file ever
  // put something like that under the ApiVersion name, we must not comparison-
  // test against it.
  const repo = makeRepo(sdkStub('18.0.0', { cjs: `"use strict";\nexports.ApiVersion = 'v2442';\n` }));
  const r = resolveInstalledSdkDefaultApiVersion(repo, 'stripe');
  assert.strictEqual(r.status, 'unresolved');
  assert.strictEqual(r.reason, 'sdk-version-unreadable');
});

test('reader: candidate paths are PROBED in order, cjs before esm before lib', () => {
  const repo = makeRepo(sdkStub('13.0.0', {
    cjs: CJS_GENERATED('2023-08-16'),
    esm: "export const ApiVersion = '1999-01-01';\n",
    lib: "module.exports = { ApiVersion: '1998-01-01' };\n",
  }));
  const r = resolveInstalledSdkDefaultApiVersion(repo, 'stripe');
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.apiVersion, '2023-08-16');
});

test('reader: the path boundary does NOT follow the major — a modern package under lib/ still resolves', () => {
  // 11.0.0 shipped lib/, 11.18.0 shipped cjs/: the layout change does not line
  // up with any major. Deducing the path from the version number would silently
  // stop reading real packages.
  const repo = makeRepo(sdkStub('15.0.0', { lib: "module.exports = { ApiVersion: '2024-04-10' };\n" }));
  const r = resolveInstalledSdkDefaultApiVersion(repo, 'stripe');
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.apiVersion, '2024-04-10');
});

// ── The three unknowns, kept apart (AC5, D3) ───────────────────────────────

test('unknown: no node_modules/stripe -> sdk-not-installed (an uninstalled clone is the normal Free-tier flow)', () => {
  const repo = makeRepo({ 'src/a.js': 'module.exports = {};\n' });
  assert.deepStrictEqual(
    resolveInstalledSdkDefaultApiVersion(repo, 'stripe'),
    { status: 'unresolved', reason: 'sdk-not-installed' },
  );
});

test('unknown: major <= 11 -> sdk-predates-implicit-pin, EVEN THOUGH lib/apiVersion.js is right there', () => {
  // The file exists as far back as v9, but the core declares
  // DEFAULT_API_VERSION = null through 11.18.0: no header is sent and the
  // ACCOUNT default applies. Reading the file here would invent a pin.
  const repo = makeRepo(sdkStub('11.18.0', { cjs: CJS_GENERATED('2022-11-15') }));
  assert.deepStrictEqual(
    resolveInstalledSdkDefaultApiVersion(repo, 'stripe'),
    { status: 'unresolved', reason: 'sdk-predates-implicit-pin', sdkVersion: '11.18.0' },
  );
});

test('unknown: the threshold is exactly 12 — 11.18.0 and 12.0.0 shipped the same day and differ', () => {
  const eleven = makeRepo(sdkStub('11.18.0', { cjs: CJS_GENERATED('2022-11-15') }));
  const twelve = makeRepo(sdkStub('12.0.0', { cjs: CJS_GENERATED('2022-11-15') }));

  assert.strictEqual(resolveInstalledSdkDefaultApiVersion(eleven, 'stripe').status, 'unresolved');
  assert.strictEqual(resolveInstalledSdkDefaultApiVersion(twelve, 'stripe').status, 'resolved');
});

test('unknown: package present but no apiVersion.js anywhere -> sdk-version-unreadable', () => {
  const repo = makeRepo(sdkStub('13.0.0'));
  assert.deepStrictEqual(
    resolveInstalledSdkDefaultApiVersion(repo, 'stripe'),
    { status: 'unresolved', reason: 'sdk-version-unreadable', sdkVersion: '13.0.0' },
  );
});

test('unknown: an unreadable package.json -> sdk-version-unreadable, never a guess', () => {
  const repo = makeRepo({ 'node_modules/stripe/index.js': 'module.exports = {};\n' });
  assert.deepStrictEqual(
    resolveInstalledSdkDefaultApiVersion(repo, 'stripe'),
    { status: 'unresolved', reason: 'sdk-version-unreadable' },
  );

  const corrupt = makeRepo({ 'node_modules/stripe/package.json': '{ not json' });
  assert.strictEqual(resolveInstalledSdkDefaultApiVersion(corrupt, 'stripe').reason, 'sdk-version-unreadable');
});

test('unknown: a version that is not a semver major -> sdk-version-unreadable', () => {
  const repo = makeRepo(sdkStub('next', { cjs: CJS_GENERATED('2023-08-16') }));
  assert.deepStrictEqual(
    resolveInstalledSdkDefaultApiVersion(repo, 'stripe'),
    { status: 'unresolved', reason: 'sdk-version-unreadable', sdkVersion: 'next' },
  );
});

test('scope: another vendor is refused outright — no multi-vendor guessing', () => {
  const repo = makeRepo({
    'node_modules/paddle/package.json': '{"name":"paddle","version":"13.0.0"}',
    'node_modules/paddle/cjs/apiVersion.js': CJS_GENERATED('2023-08-16'),
  });
  assert.strictEqual(
    resolveInstalledSdkDefaultApiVersion(repo, 'paddle').status, 'unresolved',
    'the implicit pin is a verified STRIPE mechanism; assuming another SDK behaves the same is invention',
  );
});

// ── Precedence: explicit wins, both no-client AND no-option consult (AC6) ──

test('precedence: `projectPath` is a REQUIRED third parameter, not an optional one', () => {
  // An optional parameter would let any future caller fall back to source-only
  // resolution and silently re-open this hole. Arity is the cheapest proof
  // that no default value is hiding here.
  assert.strictEqual(resolvePinnedApiVersion.length, 3);
});

test('precedence: no-option (a bare `new Stripe(key)`) DOES consult the installed SDK — the main case', () => {
  const repo = makeRepo({
    ...sdkStub('13.0.0', { cjs: CJS_GENERATED('2023-08-16') }),
    'src/client.js': `const Stripe = require('stripe');\nconst stripe = new Stripe('sk');\nmodule.exports = { stripe };\n`,
  });
  const r = resolvePinnedApiVersion(loadProject(repo), 'stripe', repo);

  assert.strictEqual(r.status, 'pinned');
  assert.strictEqual(r.source, 'installed-sdk-default');
  assert.strictEqual(r.sdkVersion, '13.0.0');
  assert.deepStrictEqual(r.versions.map((v) => v.version), ['2023-08-16']);
  assert.strictEqual(r.versions.length, 1, 'same `versions` shape as the explicit variant — callers never branch to read it');
});

test('precedence: no-client also consults the installed SDK', () => {
  const repo = makeRepo({
    ...sdkStub('13.0.0', { cjs: CJS_GENERATED('2023-08-16') }),
    'src/billing.js': `async function p(stripe, id) { return stripe.subscriptions.retrieve(id); }\nmodule.exports = { p };\n`,
  });
  const r = resolvePinnedApiVersion(loadProject(repo), 'stripe', repo);
  assert.strictEqual(r.status, 'pinned');
  assert.strictEqual(r.source, 'installed-sdk-default');
});

test('precedence: an explicit pin WINS over the SDK default — `props.apiVersion || DEFAULT_API_VERSION`', () => {
  const repo = makeRepo({
    ...sdkStub('13.0.0', { cjs: CJS_GENERATED('2023-08-16') }),
    'src/client.js': `const Stripe = require('stripe');
const stripe = new Stripe('sk', { apiVersion: '2026-08-26.dahlia' });
module.exports = { stripe };
`,
  });
  const r = resolvePinnedApiVersion(loadProject(repo), 'stripe', repo);

  assert.strictEqual(r.status, 'pinned');
  assert.strictEqual(r.source, 'ast-client-option', 'what the code sets is what the SDK sends');
  assert.deepStrictEqual(r.versions.map((v) => v.version), ['2026-08-26.dahlia']);
});

test('precedence: `non-literal` is returned as-is — the code overwrites the default with something we cannot read', () => {
  const repo = makeRepo({
    ...sdkStub('13.0.0', { cjs: CJS_GENERATED('2023-08-16') }),
    'src/client.js': `const Stripe = require('stripe');
const stripe = new Stripe('sk', { apiVersion: process.env.STRIPE_API_VERSION });
module.exports = { stripe };
`,
  });
  assert.deepStrictEqual(
    resolvePinnedApiVersion(loadProject(repo), 'stripe', repo),
    { status: 'unresolved', reason: 'non-literal' },
    'reporting the SDK default here would name a version that never applies',
  );
});

test('precedence: with no SDK installed, the unknown is the SDK one — never a bare "no pin found"', () => {
  const repo = makeRepo({
    'src/client.js': `const Stripe = require('stripe');\nconst stripe = new Stripe('sk');\nmodule.exports = { stripe };\n`,
  });
  assert.deepStrictEqual(
    resolvePinnedApiVersion(loadProject(repo), 'stripe', repo),
    { status: 'unresolved', reason: 'sdk-not-installed' },
  );
});

// ── End to end: blocked on a pin nobody wrote (AC9, AC10, AC11) ────────────

test('e2e: the implicit-pin fixture matches call sites and is then NOT applied', async () => {
  const out = outDir();
  const results = await run(fixture, { outputDir: out });

  const r = results.find((x) => x.change.id === 'stripe-subscription-current-period-to-items');
  assert.ok(r, 'expected the subscription codemod to run');

  assert.strictEqual(r.applied, false, 'stripe v13 pins 2023-08-16 implicitly — the change must not be applied');
  assert.strictEqual(r.skipped?.reason, 'pinned-api-version');
  assert.strictEqual(r.skipped?.pinnedVersion, '2023-08-16');
  assert.strictEqual(r.skipped?.changeApiVersion, '2025-03-31.basil');

  // AC9: a human must be able to see the version came from the SDK, not from
  // their code — it appears nowhere in this repo's source.
  assert.strictEqual(r.skipped?.source, 'installed-sdk-default');
  assert.strictEqual(r.skipped?.sdkVersion, '13.0.0');

  // Found and deliberately left alone: this is not "your code doesn't use this".
  assert.strictEqual(r.matches.length, 2);
  assert.deepStrictEqual(r.matches.map((m) => m.filePath), ['src/renewal.js', 'src/renewal.js']);

  // Fail-safe means shipping NOTHING.
  assert.strictEqual(r.verify, null, 'nothing was edited, so the suite must not be run');
  assert.strictEqual(r.prPath, null);
  assert.strictEqual(r.patchPath, null);
  assert.strictEqual(r.draft, false);
  assert.deepStrictEqual(fs.readdirSync(out), [], 'a blocked change must write no artifact at all');
});

test('e2e: the reported pin path is workspace-relative — `node_modules/stripe/cjs/apiVersion.js` (AC8)', async () => {
  const results = await run(fixture, { outputDir: outDir() });
  const r = results.find((x) => x.change.id === 'stripe-subscription-current-period-to-items')!;

  const site = r.skipped!.pinnedVersions[0];
  assert.strictEqual(site.filePath, path.join('node_modules', 'stripe', 'cjs', 'apiVersion.js'));
  assert.ok(!path.isAbsolute(site.filePath), 'no absolute path may leak into the report');
  assert.ok(!site.filePath.startsWith('..'), 'the symlink must NOT be realpath-ed: that leaks the user checkout');
  assert.ok(!site.filePath.includes('apidrift-'), 'no throwaway workspace path may leak either');
  assert.ok(site.line > 0);
});

test('e2e: the fixture source is left untouched on disk', async () => {
  const file = path.join(fixture, 'src', 'renewal.js');
  const before = fs.readFileSync(file, 'utf8');
  await run(fixture, { outputDir: outDir() });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
  assert.ok(before.includes('subscription.current_period_end'), 'the legacy read is CORRECT here and must survive');
});

test('e2e: the fixture pins nothing in its own source — the guard has only the SDK to go on', () => {
  const sources = ['src/stripe-client.js', 'src/renewal.js', 'src/format.js', 'test/format.test.js', 'package.json'];
  for (const rel of sources) {
    assert.ok(
      !fs.readFileSync(path.join(fixture, rel), 'utf8').includes('apiVersion:'),
      `${rel} must not set an apiVersion — that would make this a US-7 fixture, not a US-9 one`,
    );
  }
  // And the stub really is committed: without it there is nothing to read.
  assert.strictEqual(
    JSON.parse(fs.readFileSync(path.join(fixture, 'node_modules', 'stripe', 'package.json'), 'utf8')).version,
    '13.0.0',
  );
});

// ── End to end: the guard is not a blanket refusal (AC11) ──────────────────

const GREEN_REPO = {
  'package.json': JSON.stringify({ name: 't', type: 'commonjs', scripts: { test: 'node --test' } }, null, 2),
  'src/client.js': `'use strict';
const Stripe = require('stripe');
const stripe = new Stripe('sk_test');
module.exports = { stripe };
`,
  'src/renewal.js': `'use strict';
const { stripe } = require('./client');
async function describeRenewal(id) {
  const subscription = await stripe.subscriptions.retrieve(id);
  return subscription.current_period_end;
}
module.exports = { describeRenewal };
`,
  'test/noop.test.js': `'use strict';\nconst { test } = require('node:test');\ntest('green', () => {});\n`,
};

async function subscriptionResultFor(files: Record<string, string>) {
  const repo = makeRepo({ ...GREEN_REPO, ...files });
  const results = await run(repo, { outputDir: outDir() });
  return results.find((x) => x.change.id === 'stripe-subscription-current-period-to-items')!;
}

test('e2e: an SDK NEWER than the change still gets the fix — the guard discriminates', async () => {
  // stripe 19 pins 2025-09-30.clover, after 2025-03-31.basil.
  const r = await subscriptionResultFor(sdkStub('19.0.0', { cjs: CJS_GENERATED('2025-09-30.clover') }));
  assert.strictEqual(r.skipped, undefined, 'an implicit pin newer than the change must not block it');
  assert.strictEqual(r.applied, true);
  assert.strictEqual(r.pinnedApiVersion?.status, 'pinned');
});

test('e2e: no node_modules -> APPLY, and disclose that we could not look (D3)', async () => {
  const r = await subscriptionResultFor({});
  assert.strictEqual(r.skipped, undefined, 'an uninstalled clone is the normal Free-tier flow; blocking it kills the tool');
  assert.strictEqual(r.applied, true);
  assert.deepStrictEqual(r.pinnedApiVersion, { status: 'unresolved', reason: 'sdk-not-installed' });
});

test('e2e: stripe v11 installed -> APPLY, disclosed as the account default (D3)', async () => {
  const r = await subscriptionResultFor(sdkStub('11.18.0', { cjs: CJS_GENERATED('2022-11-15') }));
  assert.strictEqual(r.applied, true);
  assert.deepStrictEqual(
    r.pinnedApiVersion,
    { status: 'unresolved', reason: 'sdk-predates-implicit-pin', sdkVersion: '11.18.0' },
  );
});

test('e2e: apiVersion.js missing from an installed v13 -> APPLY, disclosed as unreadable (D3)', async () => {
  const r = await subscriptionResultFor(sdkStub('13.0.0'));
  assert.strictEqual(r.applied, true);
  assert.deepStrictEqual(
    r.pinnedApiVersion,
    { status: 'unresolved', reason: 'sdk-version-unreadable', sdkVersion: '13.0.0' },
  );
});

// ── The invariant: never claim an absence we did not verify (AC7) ──────────

const fakeMatch = { filePath: '/repo/src/a.js', line: 1, snippet: 'x', node: {} } as unknown as Match;
const greenVerify: VerifyResult = { passed: true, command: 'npm test', output: '# pass 1' };
const gatedChange: Change = {
  id: 'c', vendor: 'stripe', source: 'changelog', kind: 'breaking', title: 't',
  target: { type: 'symbol', symbol: 'stripe.subscriptions.retrieve' },
  migration: { op: 'param_move', detail: 'd' },
  references: ['https://docs.stripe.com/'], confidence: 'medium',
  apiVersion: '2025-03-31.basil',
};

function bodyFor(pinnedApiVersion: Parameters<typeof buildPrBody>[0]['pinnedApiVersion']) {
  return buildPrBody({
    change: gatedChange, matches: [fakeMatch], diff: '--- a/x\n+++ b/x\n',
    verify: greenVerify, workspaceDir: '/repo', draft: false, pinnedApiVersion,
  }).body;
}
const lineOf = (body: string) => body.split('\n').find((l) => l.includes('**API version:**'))!;

test('PR body: when we could not look, the old "no pinned apiVersion found" claim must NOT come out', () => {
  for (const reason of ['sdk-not-installed', 'sdk-version-unreadable'] as const) {
    const line = lineOf(bodyFor({ status: 'unresolved', reason }));
    assert.ok(
      !/no pinned .?apiVersion.? found/i.test(line),
      `${reason}: that sentence asserts a fact we never checked`,
    );
    assert.ok(/could not/i.test(line), `${reason}: the reader must be told we could not look`);
    assert.ok(line.includes('2025-03-31.basil'), `${reason}: the reader needs the version to confirm against`);
  }
});

test('PR body: the three unknowns read as three different sentences', () => {
  const notLooked = lineOf(bodyFor({ status: 'unresolved', reason: 'sdk-not-installed' }));
  const unreadable = lineOf(bodyFor({ status: 'unresolved', reason: 'sdk-version-unreadable', sdkVersion: '13.0.0' }));
  const predates = lineOf(bodyFor({ status: 'unresolved', reason: 'sdk-predates-implicit-pin', sdkVersion: '11.18.0' }));
  const noPin = lineOf(bodyFor({ status: 'unresolved', reason: 'no-client' }));

  assert.strictEqual(new Set([notLooked, unreadable, predates, noPin]).size, 4, 'four situations, four sentences');

  assert.ok(/not installed/i.test(notLooked), 'say WHY we could not look: nothing is installed');
  assert.ok(unreadable.includes('13.0.0'), 'name the package we could not read');
  // The one case that is neither a pin nor an absence of one.
  assert.ok(/account/i.test(predates), "v11 sends no header: it is the ACCOUNT's default that applies");
  assert.ok(predates.includes('11.18.0'));
  assert.ok(!/could not look/i.test(predates), 'we DID look here — the SDK simply imposes nothing');
});

test('PR body: an implicit pin at or after the change names the SDK it came from', () => {
  const line = lineOf(bodyFor({
    status: 'pinned', source: 'installed-sdk-default', sdkVersion: '19.0.0',
    versions: [{ version: '2025-09-30.clover', filePath: '/repo/node_modules/stripe/cjs/apiVersion.js', line: 5 }],
  }));
  assert.ok(line.includes('2025-09-30.clover'));
  assert.ok(line.includes('19.0.0'), 'the version is nowhere in the reader\'s code — say where it comes from');
  assert.ok(/implicitly/i.test(line));
});

test('PR body: exactly one API-version line, still inside "What changed upstream"', () => {
  const body = bodyFor({ status: 'unresolved', reason: 'sdk-not-installed' });
  assert.strictEqual(body.split('\n').filter((l) => l.includes('**API version:**')).length, 1);
  assert.ok(body.split('## What this PR does')[0].includes('**API version:**'), 'no new section, no banner');
});

test('disclosure: the CLI and the PR body say the SAME thing (one sentence, two surfaces)', () => {
  // Not cosmetic: two independently-worded disclosures drift, and then one of
  // them starts claiming something the other does not.
  const note = apiVersionNote(gatedChange, { status: 'unresolved', reason: 'sdk-not-installed' })!;
  assert.ok(bodyFor({ status: 'unresolved', reason: 'sdk-not-installed' }).includes(note));
  assert.strictEqual(apiVersionNote({ ...gatedChange, apiVersion: undefined }, { status: 'unresolved', reason: 'sdk-not-installed' }), null);
});

// ── What the terminal actually prints (AC7, AC9) ───────────────────────────

function cli(target: string, out: string) {
  const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'run', target, '--deterministic-only', '--out', out], {
    cwd: repoRoot, encoding: 'utf8',
    env: { ...process.env, NODE_TEST_CONTEXT: undefined } as NodeJS.ProcessEnv,
  });
  assert.strictEqual(r.status, 0, `CLI failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout.replace(/\x1b\[[0-9;]*m/g, ''); // strip colors: assert on what a human reads
}

test('CLI: a change blocked by the IMPLICIT pin names the SDK as its source', () => {
  const out = outDir();
  const output = cli('fixtures/implicit-pinned-stripe', out);

  assert.ok(/not applied/i.test(output), 'the user must be told the change was NOT applied');
  assert.ok(/IMPLICITLY/.test(output), 'and that nothing in their code says 2023-08-16');
  assert.ok(output.includes('v13.0.0'), 'the installed SDK version, so a human can act on it');
  assert.ok(output.includes('2023-08-16'), 'the version this repo really runs on');
  assert.ok(output.includes('2025-03-31.basil'), 'the version the change needs');
  assert.ok(output.includes(path.join('node_modules', 'stripe', 'cjs', 'apiVersion.js')), 'where we read it');
  assert.ok(output.includes('src/renewal.js') && /UNCHANGED/.test(output), 'the sites found and left alone on purpose');
  assert.deepStrictEqual(fs.readdirSync(out), [], 'still no artifact');
});

test('CLI: an APPLIED change on an uninstalled clone says we could not look — silence would read as "checked"', () => {
  const repo = makeRepo(GREEN_REPO);
  const output = cli(repo, outDir());

  assert.ok(/api version:/i.test(output), 'the disclosure must reach the terminal, not just the PR body');
  assert.ok(/could not/i.test(output));
  assert.ok(
    !/no pinned .?apiVersion.? found/i.test(output),
    'never assert an absence of pin on a repo whose node_modules we never saw',
  );
});

test('cleanup', () => {
  for (const d of disposables) fs.rmSync(d, { recursive: true, force: true });
});
