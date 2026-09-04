'use strict';

// The whole point of this fixture: there is NO `apiVersion` here. Nowhere in
// this repo does anyone write a Stripe API version — and the repo is still
// pinned to one.
//
// Since stripe-node v12.0.0 the SDK's core does
//     version: props.apiVersion || DEFAULT_API_VERSION
// with `DEFAULT_API_VERSION = apiVersion.ApiVersion`, the literal of the
// generated file shipped in the tarball. node_modules/stripe here is v13.0.0,
// whose generated cjs/apiVersion.js reads '2023-08-16'. So every request this
// client makes carries `Stripe-Version: 2023-08-16`, and
// `subscription.current_period_end` (see src/renewal.js) is CORRECT.
//
// US-7's guard reads this construction and classifies it `no-option`: no
// apiVersion key, nothing to compare, apply the change. That verdict is the
// bug US-9 fixes — the pin is real, it just is not written down here.
//
// NOTE for the fixture's own test suite: this module `require`s the real
// `stripe` package (only a stub of it is vendored, see
// node_modules/stripe/README.md). Nothing under test/ may import it, directly
// or transitively — see test/format.test.js.

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

module.exports = { stripe };
