<!-- Fixture for US-13 (AC4): ONE release carrying THREE Breaking rows, the middle one unreachable. Isolating a failure per RELEASE (what US-12 shipped) loses the other two pages' changes and names a single hole after the release; isolating per PAGE (what US-13 ships) keeps them and names the hole after the PAGE URL. The live case this models is dahlia/2026-03-25 (11 Breaking pages, one of which — updates-available-checkout-session-ui-modes.md — has a full Node.js table and NO `## Impact`, so extractImpact throws and took the other 10 with it). -->

## 2025-06-30.basil

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [Removes support for specifying payment method types in Payment Intents and Setup Intents](https://docs.stripe.com/changelog/dahlia/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-intents.md) | Payments | Breaking | api |
| [Updates available Checkout Session UI modes](https://docs.stripe.com/changelog/dahlia/2026-03-25/updates-available-checkout-session-ui-modes.md) | Payments | Breaking | api |
| [Adds subscription item-level billing periods and removes subscription-level periods](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md) | Billing | Breaking | api |
