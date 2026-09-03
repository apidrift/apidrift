'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { formatRenewal } = require('../src/format');

// Deliberately narrow: this suite covers the pure helper ONLY. It never
// imports src/renewal.js or src/stripe-client.js, so it runs green with no
// network and no installed dependencies.
//
// That narrowness is also the point of the fixture. It mirrors agnaistic/agnai
// (US-6): a green `npm test` says NOTHING about whether the migrated
// subscription reads are correct. Verification cannot catch this class of
// mistake, which is why the pinned-API-version guard has to.

test('reports a 30-day billing window', () => {
  const start = 1692144000;
  const period = formatRenewal(start, start + 30 * 86400);

  assert.strictEqual(period.days, 30);
  assert.ok(period.end > period.start, 'the window must end after it starts');
});

test('rejects a period that is not made of two timestamps', () => {
  assert.throws(() => formatRenewal(1692144000, undefined), TypeError);
});
