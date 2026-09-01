<!-- Fixture for US-2: verbatim excerpt (lines 1-61) of https://docs.stripe.com/changelog.md, consulted 2026-09-01. Trimmed to the '2026-08-26.dahlia' and '2026-08-26.preview' release sections -- enough to exercise release + Breaking-flag filtering without committing the full 204KB index. -->

# Changelog

Keep track of changes and upgrades to the Stripe API.

# Dahlia
[Learn what's changing in Dahlia](https://docs.stripe.com/changelog/dahlia.md)
## 2026-08-26.dahlia

### Billing and invoicing

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [Adds a customer update deep link for billing portal sessions](https://docs.stripe.com/changelog/dahlia/2026-08-26/adds-a-customer-update-deep-link-for-billing-portal-sessions.md) | Billing | Non-breaking | api |
| [Adds the ability to query entitlements and launch the customer portal in Customer Sessions](https://docs.stripe.com/changelog/dahlia/2026-08-26/customer-session-improvements.md) | Billing | Non-breaking | api |
| [Adds frozen fields property to Invoice Items](https://docs.stripe.com/changelog/dahlia/2026-08-26/adds-frozen-fields-property-to-invoice-items.md) | Invoicing | Non-breaking | api |
| [Adds support for the Billie payment method for invoices and subscriptions](https://docs.stripe.com/changelog/dahlia/2026-08-26/billie-support-for-invoices-and-subscriptions.md) | Billing | Non-breaking | api |
| [Increases the subscription item limit](https://docs.stripe.com/changelog/dahlia/2026-08-26/flexible-subscription-item-limits.md) | Billing | Non-breaking | api |

### Payments

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [Adds support for updating Connect parameters of an existing Payment Link](https://docs.stripe.com/changelog/dahlia/2026-08-26/adds-connect-parameters-to-the-payment-link-update-method.md) | Paymentlinks | Non-breaking | api |
| [Adds a funding source identifier to Link payments](https://docs.stripe.com/changelog/dahlia/2026-08-26/adds-funding-source-group-property-for-link-payments.md) | Payments | Non-breaking | api |
| [Adds new error codes for payment method failures](https://docs.stripe.com/changelog/dahlia/2026-08-26/adds-payment-method-error-codes.md) | Payments | Non-breaking | api |
| [Adds the ability to restrict card funding types in Checkout Sessions](https://docs.stripe.com/changelog/dahlia/2026-08-26/adds-card-funding-type-filtering-to-checkout-sessions.md) | Payments | Non-breaking | api |
| [Adds support for metadata in confirmation tokens](https://docs.stripe.com/changelog/dahlia/2026-08-26/adds-metadata-support-to-confirmation-tokens.md) | Payments | Non-breaking | api |
| [Adds a funding source identifier to Link wallet card payments](https://docs.stripe.com/changelog/dahlia/2026-08-26/adds-funding-source-group-property-to-link-wallet-payments-on-card-charges.md) | Payments | Non-breaking | api |

### Additional updates

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [Adds support for specifying place of supply scheme on IGIC tax in the EU](https://docs.stripe.com/changelog/dahlia/2026-08-26/adds-igic-tax-registration-type-with-place-of-supply-scheme-for-eu-countries.md) | Tax | Non-breaking | api |

## 2026-08-26.preview

### Connect

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [Redirects new Connect platforms away from unsupported integration patterns](https://docs.stripe.com/changelog/dahlia/2026-08-26/2026-08-17-blocks-unsupported-integration-patterns.md) | Connect | Non-breaking | api |
| [Adds control over Stripe user authentication to Payment Method Settings](https://docs.stripe.com/changelog/dahlia/2026-08-26/payment-method-settings-disable-stripe-user-authentication.md) | Connect | Non-breaking | api |
| [Adds Account Signals, Account Evaluations, and Account Activity APIs in public preview](https://docs.stripe.com/changelog/dahlia/2026-08-26/adds-account-signals-account-evaluations-and-account-activity-apis-in-public-preview.md) | Radar, Connect | Non-breaking | api |

### Payments

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [Removes support for specifying payment method types in Payment Intents and Setup Intents](https://docs.stripe.com/changelog/dahlia/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-intents.md) | Payments | Breaking | api |
| [Updates bank account and payout method resources for Global Payouts](https://docs.stripe.com/changelog/dahlia/2026-08-26/updates-v2-payout-method-and-vault-bank-account-resources.md) | Payments | Breaking | api |

### Additional updates

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [Adds support for disabling payout methods](https://docs.stripe.com/changelog/dahlia/2026-08-26/disable-payout-methods.md) | Payouts | Breaking | api |
| [Includes deleted prices in trial offer price data](https://docs.stripe.com/changelog/dahlia/2026-08-26/trial-offers-return-deleted-prices.md) | Billing | Breaking | api |
| [Adds ability to require approval for Stripe-initiated actions](https://docs.stripe.com/changelog/dahlia/2026-08-26/introduces-approval-requests-in-public-preview.md) | All products | Non-breaking | api |
| [Adds support to specify different default payout methods for each currency](https://docs.stripe.com/changelog/dahlia/2026-08-26/adds-default-payout-methods-to-the-accounts-v2-api.md) | Connect, Treasury | Non-breaking | api |

