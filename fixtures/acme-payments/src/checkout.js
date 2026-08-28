'use strict';

// Charges a customer for their cart.
// NOTE: this uses the deprecated `stripe.charges.create` API.
// APIdrift should migrate it to `stripe.paymentIntents.create`.

async function chargeCustomer(stripe, { amountCents, token }) {
  const charge = await stripe.charges.create({
    amount: amountCents,
    currency: 'usd',
    source: token,
  });

  return {
    paymentId: charge.id,
    amount: charge.amount,
    currency: charge.currency,
    ok: charge.status === 'succeeded',
  };
}

module.exports = { chargeCustomer };
