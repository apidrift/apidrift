'use strict';

// Reads the subscription-level billing period. On API version 2023-08-16
// (what src/stripe-client.js pins) this code is CORRECT — Stripe still puts
// `current_period_end` on the Subscription resource itself.
//
// The `stripe-subscription-current-period-to-items` codemod matches both reads
// below. APIdrift must find them and then refuse to rewrite them, because the
// change it is based on only takes effect from 2025-03-31.basil.

const { stripe } = require('./stripe-client');
const { formatRenewal } = require('./format');

async function describeRenewal(subscriptionId) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const start = subscription.current_period_start;
  const end = subscription.current_period_end;

  return formatRenewal(start, end);
}

module.exports = { describeRenewal };
