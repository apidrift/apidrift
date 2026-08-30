import { test } from 'node:test';
import assert from 'node:assert';
import { buildPrBody, summarizeVerification } from '../src/pr.js';
import type { Change, Match, VerifyResult } from '../src/types.js';

const change: Change = {
  id: 'stripe-charges-create-to-payment-intents',
  vendor: 'stripe',
  source: 'changelog',
  kind: 'deprecation',
  title: 'Migrate deprecated Charges.create to PaymentIntents.create',
  target: { type: 'symbol', symbol: 'stripe.charges.create' },
  migration: { op: 'replaced_by', detail: 'n/a' },
  references: ['https://docs.stripe.com/'],
  confidence: 'high',
};

const fakeMatch = { filePath: '/repo/controllers/api.js', line: 488, snippet: 'stripe.charges.create({', node: {} } as unknown as Match;

test('summarizeVerification: green mocha suite shows the "N passing" summary line, not a raw tail', () => {
  // This is exactly the shape that bit US-1 on hackathon-starter: a trailing
  // console.error from a PASSING webauthn error-path test lands after the
  // mocha summary in the last lines of combined stdout+stderr.
  const output = [
    '  webauthn',
    '    ✓ rejects an invalid assertion',
    '',
    '  328 passing (9s)',
    '',
    'webauthn.test.js:170',
    'console.error: expected assertion failure (this is intentional, test still passes)',
  ].join('\n');

  const verify: VerifyResult = { passed: true, command: 'npm test', output };
  const summary = summarizeVerification(verify);

  assert.ok(summary.includes('328 passing'), 'expected the mocha summary line');
  assert.ok(!summary.includes('console.error'), 'must not surface the trailing stderr noise as if it were the verdict');
});

test('summarizeVerification: ANSI-colored mocha summary (real c8/mocha output shape) still matches', () => {
  // Exact shape observed running hackathon-starter's `npm test` (c8 + mocha):
  // the summary line is wrapped in ANSI color escape codes, so a naive
  // "starts with whitespace then digits" regex must strip color codes first.
  const output = '[92m [0m[32m 328 passing[0m[90m (9s)[0m\n';
  const verify: VerifyResult = { passed: true, command: 'npm test', output };
  const summary = summarizeVerification(verify);

  assert.ok(summary.includes('328 passing'), `expected the summary to surface "328 passing", got: ${summary}`);
});

test('summarizeVerification: green node --test (TAP) suite shows the pass/fail tally', () => {
  const output = ['# tests 13', '# pass 13', '# fail 0', '# cancelled 0'].join('\n');
  const verify: VerifyResult = { passed: true, command: 'npm test', output };
  const summary = summarizeVerification(verify);

  assert.ok(summary.includes('# pass 13'));
  assert.ok(summary.includes('# fail 0'));
});

test('summarizeVerification: green jest suite shows the "Tests:" summary line', () => {
  const output = ['PASS  src/foo.test.js', '', 'Tests:       13 passed, 13 total', 'Time:        1.2s'].join('\n');
  const verify: VerifyResult = { passed: true, command: 'npm test', output };
  const summary = summarizeVerification(verify);

  assert.ok(summary.includes('13 passed'));
});

test('summarizeVerification: green suite with no recognized summary format does not fabricate one', () => {
  const output = 'some custom runner output\nwith no standard tally line\n';
  const verify: VerifyResult = { passed: true, command: 'npm test', output };
  const summary = summarizeVerification(verify);

  assert.ok(summary.includes('exited 0'));
  assert.ok(!summary.includes('custom runner output'), 'should not fall back to a raw, possibly-misleading tail when green');
});

test('summarizeVerification: RED suite still shows the raw tail (diagnostic value preserved)', () => {
  const output = Array.from({ length: 20 }, (_, i) => `line ${i}`)
    .concat(['1 failing', 'AssertionError: expected true to equal false'])
    .join('\n');
  const verify: VerifyResult = { passed: false, command: 'npm test', output };
  const summary = summarizeVerification(verify);

  assert.ok(summary.includes('AssertionError'), 'red suite must still show the failure detail');
  assert.ok(summary.includes('line 19'), 'red suite keeps the raw tail');
  assert.ok(!summary.includes('line 0'), 'still bounded to the tail, not the whole output');
});

test('buildPrBody embeds the summarized (not raw) verification excerpt', () => {
  const output = ['  328 passing (9s)', '', 'console.error: intentional, unrelated to verdict'].join('\n');
  const verify: VerifyResult = { passed: true, command: 'npm test', output };

  const { body } = buildPrBody({
    change,
    matches: [fakeMatch],
    diff: '--- a/x\n+++ b/x\n',
    verify,
    workspaceDir: '/repo',
    draft: false,
  });

  assert.ok(body.includes('328 passing'));
  assert.ok(!body.includes('console.error'), 'PR body must not surface unrelated stderr noise from a passing suite');
});
