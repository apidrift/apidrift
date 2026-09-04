'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { formatRenewal } = require('../src/format');

// Deliberately narrow AND airtight: this suite covers the pure helper ONLY. It
// never imports src/renewal.js or src/stripe-client.js, so it never touches the
// vendored `stripe` stub and runs green with no network and nothing installed.
//
// That narrowness is the point of the fixture, twice over:
//   1. it mirrors agnaistic/agnai (US-6) — a green `npm test` says NOTHING
//      about whether the migrated subscription reads are correct;
//   2. it proves WHICH mechanism stopped the fix. The suite is green, so the
//      verifier had no reason to block: if the change is not applied, it is
//      the pinned-API-version guard that refused, and nothing else.

test('reports a 30-day billing window', () => {
  const start = 1692144000;
  const period = formatRenewal(start, start + 30 * 86400);

  assert.strictEqual(period.days, 30);
  assert.ok(period.end > period.start, 'the window must end after it starts');
});

test('rejects a period that is not made of two timestamps', () => {
  assert.throws(() => formatRenewal(1692144000, undefined), TypeError);
});
