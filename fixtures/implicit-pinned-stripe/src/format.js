'use strict';

// Pure formatting helper, with no Stripe dependency at all — this is what the
// fixture's own test suite exercises, so `npm test` stays green offline with
// nothing installed. (Requiring src/renewal.js would pull in src/stripe-client.js,
// which requires the vendored `stripe` stub, which is not a runnable SDK.)

const SECONDS_PER_DAY = 86400;

function formatRenewal(startSeconds, endSeconds) {
  if (typeof startSeconds !== 'number' || typeof endSeconds !== 'number') {
    throw new TypeError('a billing period needs two unix timestamps');
  }
  return {
    start: startSeconds,
    end: endSeconds,
    days: Math.round((endSeconds - startSeconds) / SECONDS_PER_DAY),
  };
}

module.exports = { formatRenewal, SECONDS_PER_DAY };
