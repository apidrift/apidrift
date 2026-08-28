'use strict';

// A tiny fake of the Stripe SDK, just enough to exercise our checkout code.
// It implements BOTH the deprecated Charges API and the current
// PaymentIntents API, and both settle a payment for the same amount.
// That is what lets the test verify *behavior* rather than a specific API call:
// a correct migration must keep charging the right amount in the right currency.

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
  };
}

module.exports = { makeStripe };
