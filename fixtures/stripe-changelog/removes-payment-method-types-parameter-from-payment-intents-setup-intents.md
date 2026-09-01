<!-- Fixture for US-2: fetched verbatim from https://docs.stripe.com/changelog/dahlia/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-intents.md, consulted 2026-09-01. Form #1 PURE: every link in the Node.js '## Changes' table row points to a method (/api/payment_intents/<method>, /api/setup_intents/<method>), never to /object. -->

# Removes support for specifying payment method types in Payment Intents and Setup Intents

## What’s new

Removes `payment_method_types` as a writable parameter from the [create](https://docs.stripe.com/api/payment_intents/create.md?api-version=2026-08-26.preview), [update](https://docs.stripe.com/api/payment_intents/update.md?api-version=2026-08-26.preview), and [confirm](https://docs.stripe.com/api/payment_intents/confirm.md?api-version=2026-08-26.preview) methods on Payment Intents, and from the [create](https://docs.stripe.com/api/setup_intents/create.md?api-version=2026-08-26.preview) and [update](https://docs.stripe.com/api/setup_intents/update.md?api-version=2026-08-26.preview) methods on Setup Intents. Passing `payment_method_types` now returns a 400 error with the code `payment_method_types_no_longer_supported`.

The [PaymentIntent](https://docs.stripe.com/api/payment_intents/object.md?api-version=2026-08-26.preview#payment_intent_object-payment_method_types) and [SetupIntent](https://docs.stripe.com/api/setup_intents/object.md?api-version=2026-08-26.preview#setup_intent_object-payment_method_types) objects still return `payment_method_types` as a read-only property, reflecting the computed list of available payment methods.

## Why is this a breaking change?

Previously, `payment_method_types` accepted a list of payment method types to explicitly set which methods to present on a Payment Intent or Setup Intent. This change disables writing to this parameter and returns a `400` error on requests that pass `payment_method_types` on the affected endpoints.

## Impact

If your integration passes `payment_method_types` when creating, updating, or confirming a PaymentIntent or SetupIntent, you must remove it before upgrading to API version `2026-08-26.preview` or later.

You can replace it with [dynamic payment methods](https://docs.stripe.com/payments/payment-methods/dynamic-payment-methods.md) to automatically determine available payment methods based on other parameters such as `currency`, `amount`, and `customer`. If you need more control:

- Use [excluded_payment_method_types](https://docs.stripe.com/api/payment_intents/create.md?api-version=2026-08-26.preview#create_payment_intent-excluded_payment_method_types) to exclude specific types from the set determined by dynamic payment methods.
- Use [allowed_payment_method_types](https://docs.stripe.com/api/payment_intents/create.md?api-version=2026-08-26.preview#create_payment_intent-allowed_payment_method_types) to specify a list of types you want to accept. Stripe filters out incompatible types instead of returning an error.

You can continue to read `payment_method_types` to retrieve the computed list of available payment methods.

## Changes

#### REST API

| Parameter | Change | Resources or endpoints |
| --- | --- | --- |
| `payment_method_types` | Removed | [PaymentIntent#confirm](/api/payment_intents/confirm?api-version=2026-08-26.preview#confirm_payment_intent), [PaymentIntent#create](/api/payment_intents/create?api-version=2026-08-26.preview#create_payment_intent), [PaymentIntent#update](/api/payment_intents/update?api-version=2026-08-26.preview#update_payment_intent), [SetupIntent#create](/api/setup_intents/create?api-version=2026-08-26.preview#create_setup_intent), [SetupIntent#update](/api/setup_intents/update?api-version=2026-08-26.preview#update_setup_intent) |

#### Ruby

| Parameter | Change | Resources or methods |
| --- | --- | --- |
| `payment_method_types` | Removed | [PaymentIntentConfirmParams](/api/payment_intents/confirm?api-version=2026-08-26.preview#confirm_payment_intent), [PaymentIntentCreateParams](/api/payment_intents/create?api-version=2026-08-26.preview#create_payment_intent), [PaymentIntentUpdateParams](/api/payment_intents/update?api-version=2026-08-26.preview#update_payment_intent), [SetupIntentCreateParams](/api/setup_intents/create?api-version=2026-08-26.preview#create_setup_intent), [SetupIntentUpdateParams](/api/setup_intents/update?api-version=2026-08-26.preview#update_setup_intent) |

#### Python

| Parameter | Change | Resources or methods |
| --- | --- | --- |
| `payment_method_types` | Removed | [PaymentIntentConfirmParams](/api/payment_intents/confirm?api-version=2026-08-26.preview#confirm_payment_intent), [PaymentIntentCreateParams](/api/payment_intents/create?api-version=2026-08-26.preview#create_payment_intent), [PaymentIntentModifyParams](/api/payment_intents/update?api-version=2026-08-26.preview#update_payment_intent), [SetupIntentCreateParams](/api/setup_intents/create?api-version=2026-08-26.preview#create_setup_intent), [SetupIntentModifyParams](/api/setup_intents/update?api-version=2026-08-26.preview#update_setup_intent) |

#### PHP

| Parameter | Change | Resources or methods |
| --- | --- | --- |
| `payment_method_types` | Removed | [PaymentIntent.confirm().$params](/api/payment_intents/confirm?api-version=2026-08-26.preview#confirm_payment_intent), [PaymentIntent.create().$params](/api/payment_intents/create?api-version=2026-08-26.preview#create_payment_intent), [PaymentIntent.update().$params](/api/payment_intents/update?api-version=2026-08-26.preview#update_payment_intent), [SetupIntent.create().$params](/api/setup_intents/create?api-version=2026-08-26.preview#create_setup_intent), [SetupIntent.update().$params](/api/setup_intents/update?api-version=2026-08-26.preview#update_setup_intent) |

#### Java

| Parameter | Change | Resources or methods |
| --- | --- | --- |
| `paymentMethodTypes` | Removed | [PaymentIntentConfirmParams](/api/payment_intents/confirm?api-version=2026-08-26.preview#confirm_payment_intent), [PaymentIntentCreateParams](/api/payment_intents/create?api-version=2026-08-26.preview#create_payment_intent), [PaymentIntentUpdateParams](/api/payment_intents/update?api-version=2026-08-26.preview#update_payment_intent), [SetupIntentCreateParams](/api/setup_intents/create?api-version=2026-08-26.preview#create_setup_intent), [SetupIntentUpdateParams](/api/setup_intents/update?api-version=2026-08-26.preview#update_setup_intent) |

#### Node.js

| Parameter | Change | Resources or methods |
| --- | --- | --- |
| `payment_method_types` | Removed | [PaymentIntentConfirmParams](/api/payment_intents/confirm?api-version=2026-08-26.preview#confirm_payment_intent), [PaymentIntentCreateParams](/api/payment_intents/create?api-version=2026-08-26.preview#create_payment_intent), [PaymentIntentUpdateParams](/api/payment_intents/update?api-version=2026-08-26.preview#update_payment_intent), [SetupIntentCreateParams](/api/setup_intents/create?api-version=2026-08-26.preview#create_setup_intent), [SetupIntentUpdateParams](/api/setup_intents/update?api-version=2026-08-26.preview#update_setup_intent) |

#### Go

| Parameter | Change | Resources or methods |
| --- | --- | --- |
| `PaymentMethodTypes` | Removed | [PaymentIntentConfirmParams](/api/payment_intents/confirm?api-version=2026-08-26.preview#confirm_payment_intent), [PaymentIntentParams](/api/payment_intents/create?api-version=2026-08-26.preview#create_payment_intent), [SetupIntentParams](/api/setup_intents/create?api-version=2026-08-26.preview#create_setup_intent) |

#### .NET

| Parameter | Change | Resources or methods |
| --- | --- | --- |
| `PaymentMethodTypes` | Removed | [PaymentIntentConfirmOptions](/api/payment_intents/confirm?api-version=2026-08-26.preview#confirm_payment_intent), [PaymentIntentCreateOptions](/api/payment_intents/create?api-version=2026-08-26.preview#create_payment_intent), [PaymentIntentUpdateOptions](/api/payment_intents/update?api-version=2026-08-26.preview#update_payment_intent), [SetupIntentCreateOptions](/api/setup_intents/create?api-version=2026-08-26.preview#create_setup_intent), [SetupIntentUpdateOptions](/api/setup_intents/update?api-version=2026-08-26.preview#update_setup_intent) |

## Upgrade

#### REST API

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. If you use an SDK, upgrade to the corresponding SDK version for this API version.
   - If you don’t use an SDK, update your [API requests](https://docs.stripe.com/api/versioning.md) to include `Stripe-Version: 2026-08-26.preview`
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Ruby

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Ruby SDK to the latest version.
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Python

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Python SDK to the latest version.
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### PHP

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your PHP SDK to the latest version.
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Java

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Java SDK to the latest version.
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Node.js

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Node SDK to the latest version.
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Go

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Go SDK to the latest version.
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### .NET

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your .NET SDK to the latest version.
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

## Related changes

- [Updates bank account and payout method resources for Global Payouts](https://docs.stripe.com/changelog/dahlia/2026-08-26/updates-v2-payout-method-and-vault-bank-account-resources.md)
