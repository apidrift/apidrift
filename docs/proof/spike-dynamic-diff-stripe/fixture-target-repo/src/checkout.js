// Creates a PaymentIntent for a cart. Written against a Stripe account still
// running an OLDER API version than 2026-08-26.preview, where passing
// `payment_method_types` explicitly is still valid — this code is CORRECT as
// of the account's current pinned version.
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

export async function createPaymentIntent({ amountCents, currency }) {
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    payment_method_types: ['card'],
  });

  return { id: intent.id, amount: intent.amount, currency: intent.currency };
}
