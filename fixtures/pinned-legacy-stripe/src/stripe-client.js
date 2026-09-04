'use strict';

// The whole point of this fixture: the Stripe client is PINNED to an API
// version that predates the change APIdrift wants to apply.
//
// `2023-08-16` is pre-Acacia (no channel suffix) and well before the
// `2025-03-31.basil` release that moved billing periods off the Subscription
// onto its items. On this account Stripe still returns
// `subscription.current_period_end`, so the "migrated" form
// (`subscription.items.data[0].current_period_end`) would read `undefined`
// at runtime — a silently wrong fix.
//
// This is the exact shape observed on agnaistic/agnai during the US-6 proof.
//
// NOTE for the fixture's own test suite: this module `require`s the real
// `stripe` package, which is deliberately NOT a dependency here (the fixture
// must stay installable-free and offline). Nothing under test/ may import it,
// directly or transitively — see test/renewal.test.js.

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-08-16',
});

module.exports = { stripe };
