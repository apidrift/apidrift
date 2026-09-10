import { test } from 'node:test';
import assert from 'node:assert';
import { createPaymentIntent } from '../src/checkout.js';

// Describes BEHAVIOR, not the Stripe request shape — a correct migration
// (dropping payment_method_types) must keep this green.
test('creates a payment intent for the requested amount and currency', async () => {
  const result = await createPaymentIntent({ amountCents: 1500, currency: 'usd' });
  assert.ok(result.id, 'expected a payment intent id');
  assert.strictEqual(result.amount, 1500);
  assert.strictEqual(result.currency, 'usd');
});
