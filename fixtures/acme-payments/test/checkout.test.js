'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { makeStripe } = require('../lib/stripe-mock');
const { chargeCustomer } = require('../src/checkout');

// These tests describe the BEHAVIOR we care about, not the Stripe method used.
// A correct migration from charges -> paymentIntents must keep them green.

test('charges the customer the exact amount in the right currency', async () => {
  const stripe = makeStripe();
  const result = await chargeCustomer(stripe, { amountCents: 2000, token: 'tok_visa' });

  assert.strictEqual(result.amount, 2000);
  assert.strictEqual(result.currency, 'usd');
  assert.strictEqual(result.ok, true);
});

test('returns a payment id', async () => {
  const stripe = makeStripe();
  const result = await chargeCustomer(stripe, { amountCents: 500, token: 'tok_mc' });

  assert.ok(result.paymentId, 'expected a payment id');
});
