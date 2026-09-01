'use strict';

// Reports the current billing window of a customer's subscription.
// NOTE: this reads `current_period_start` / `current_period_end` off the
// Subscription object — Stripe removed both in API version 2025-03-31.basil
// and moved them onto each subscription item. APIdrift should migrate these
// reads to `subscription.items.data[0].current_period_*`.

const SECONDS_PER_DAY = 86400;

async function getBillingPeriod(stripe, subscriptionId) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const start = subscription.current_period_start;
  const end = subscription.current_period_end;

  return {
    subscriptionId: subscription.id,
    start,
    end,
    days: Math.round((end - start) / SECONDS_PER_DAY),
  };
}

module.exports = { getBillingPeriod };
