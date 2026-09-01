'use strict';

// A tiny fake of the Stripe SDK, just enough to exercise our billing code.
// It implements BOTH the deprecated Charges API and the current
// PaymentIntents API, and both settle a payment for the same amount.
// Likewise, the subscription it returns carries its billing period BOTH at the
// (pre-2025-03-31.basil) subscription level and on its subscription item.
// That is what lets the tests verify *behavior* rather than a specific API
// shape: a correct migration must keep reading the same amount, currency and
// billing window.

// Billing window of the fake subscription: a 30-day period.
const PERIOD_START = 1740787200;
const PERIOD_END = PERIOD_START + 30 * 86400;

function makeStripe() {
  let counter = 0;
  const settle = (params, kind) => {
    if (typeof params.amount !== 'number') {
      throw new Error('amount is required');
    }
    if (!params.currency) {
      throw new Error('currency is required');
    }
    counter += 1;
    return {
      id: `${kind}_${counter}`,
      amount: params.amount,
      currency: params.currency,
      status: 'succeeded',
    };
  };

  return {
    // Deprecated path.
    charges: {
      create: async (params) => {
        if (!params.source) throw new Error('source is required for charges.create');
        return settle(params, 'ch');
      },
    },
    // Current path.
    paymentIntents: {
      create: async (params) => {
        if (!params.payment_method) {
          throw new Error('payment_method is required for paymentIntents.create');
        }
        return settle(params, 'pi');
      },
    },
    // Subscriptions. The object exposes the SAME billing window twice: once at
    // the subscription level (removed by Stripe in 2025-03-31.basil) and once
    // on the subscription item (where it lives now). Both the legacy and the
    // migrated code path must therefore read the same values.
    subscriptions: {
      retrieve: async (id) => {
        if (!id) throw new Error('a subscription id is required');
        return {
          id,
          status: 'active',
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
          items: {
            object: 'list',
            data: [
              {
                id: 'si_1',
                current_period_start: PERIOD_START,
                current_period_end: PERIOD_END,
              },
            ],
          },
        };
      },
    },
  };
}

module.exports = { makeStripe };
