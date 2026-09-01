'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { makeStripe } = require('../lib/stripe-mock');
const { getBillingPeriod } = require('../src/billing');

// These tests describe the BEHAVIOR we care about — the billing window we
// report — not where in the Stripe object the window is read from. A correct
// migration to item-level billing periods must keep them green.

test('reports a billing window that starts before it ends', async () => {
  const stripe = makeStripe();
  const period = await getBillingPeriod(stripe, 'sub_123');

  assert.strictEqual(typeof period.start, 'number');
  assert.strictEqual(typeof period.end, 'number');
  assert.ok(period.end > period.start, 'the window must end after it starts');
});

test('reports a 30-day billing window', async () => {
  const stripe = makeStripe();
  const period = await getBillingPeriod(stripe, 'sub_123');

  assert.strictEqual(period.days, 30);
});

test('reports the window for the subscription that was asked for', async () => {
  const stripe = makeStripe();
  const period = await getBillingPeriod(stripe, 'sub_abc');

  assert.strictEqual(period.subscriptionId, 'sub_abc');
});
