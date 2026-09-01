<!-- Fixture for US-2: fetched verbatim from https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md, consulted 2026-09-01. Form #2 PURE: the Node.js '## Changes' table's Removed row links only point to /api/subscriptions/object and /api/subscription_items/object (response objects), never to a method. -->

# Adds subscription item-level billing periods and removes subscription-level periods

## What’s new

[Subscription items](https://docs.stripe.com/api/subscription_items/object.md?api-version=2025-03-31.basil) now track their respective billing periods directly instead of as a top-level shared billing period on the [subscription](https://docs.stripe.com/api/subscriptions/object.md?api-version=2025-03-31.basil) resource.

## Why is this a breaking change?

- `current_period_start` and `current_period_end` fields are no longer available on the [subscription](https://docs.stripe.com/api/subscriptions/object.md?api-version=2025-03-31.basil) resource.
- `previous_attributes` on the `customer.subscription.updated` webhook now include that the subscription item’s billing period has changed.

## Impact

Update any code that references subscription-level `current_period_end` and `current_period_start` fields. Instead, access the subscription item’s billing periods directly using [items.data.current_period_end](https://docs.stripe.com/api/subscription_items/object.md?api-version=2025-03-31.basil#subscription_item_object-current_period_end) and [items.data.current_period_start](https://docs.stripe.com/api/subscription_items/object.md?api-version=2025-03-31.basil#subscription_item_object-current_period_start) fields.

Make sure that your integration correctly handles the `previous_attributes` field on the `customer.subscription.updated` webhook. For instance, for `price` or `quantity` changes, inspect the `previous_attributes.items.data[].price` field.

## Changes

#### REST API

| Parameters | Change | Resources or endpoints |
| --- | --- | --- |
| `current_period_end`, `current_period_start` | Removed | [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |
| `current_period_end`, `current_period_start` | Added | [SubscriptionItem](/api/subscription_items/object?api-version=2025-03-31.basil) |

#### Ruby

This change does not affect the Ruby SDK.

#### Python

| Parameters | Change | Resources or methods |
| --- | --- | --- |
| `current_period_end`, `current_period_start` | Removed | [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |
| `current_period_end`, `current_period_start` | Added | [SubscriptionItem](/api/subscription_items/object?api-version=2025-03-31.basil) |

#### PHP

| Parameters | Change | Resources or methods |
| --- | --- | --- |
| `current_period_end`, `current_period_start` | Removed | [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |
| `current_period_end`, `current_period_start` | Added | [SubscriptionItem](/api/subscription_items/object?api-version=2025-03-31.basil) |

#### Java

| Parameters | Change | Resources or methods |
| --- | --- | --- |
| `currentPeriodEnd`, `currentPeriodStart` | Removed | [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |
| `currentPeriodEnd`, `currentPeriodStart` | Added | [SubscriptionItem](/api/subscription_items/object?api-version=2025-03-31.basil) |

#### Node.js

| Parameters | Change | Resources or methods |
| --- | --- | --- |
| `current_period_end`, `current_period_start` | Removed | [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |
| `current_period_end`, `current_period_start` | Added | [SubscriptionItem](/api/subscription_items/object?api-version=2025-03-31.basil) |

#### Go

| Parameters | Change | Resources or methods |
| --- | --- | --- |
| `CurrentPeriodEnd`, `CurrentPeriodStart` | Removed | [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |
| `CurrentPeriodEnd`, `CurrentPeriodStart` | Added | [SubscriptionItem](/api/subscription_items/object?api-version=2025-03-31.basil) |

#### .NET

| Parameters | Change | Resources or methods |
| --- | --- | --- |
| `CurrentPeriodEnd`, `CurrentPeriodStart` | Removed | [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |
| `CurrentPeriodEnd`, `CurrentPeriodStart` | Added | [SubscriptionItem](/api/subscription_items/object?api-version=2025-03-31.basil) |

## Upgrade

#### REST API

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. If you use an SDK, upgrade to the corresponding SDK version for this API version.
   - If you don’t use an SDK, update your [API requests](https://docs.stripe.com/api/versioning.md) to include `Stripe-Version: 2025-03-31.basil`
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Ruby

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Ruby SDK to [v15.0.0](https://github.com/stripe/stripe-ruby/releases/tag/v15.0.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Python

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Python SDK to [v12.0.0](https://github.com/stripe/stripe-python/releases/tag/v12.0.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### PHP

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your PHP SDK to [v17.0.0](https://github.com/stripe/stripe-php/releases/tag/v17.0.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Java

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Java SDK to [v29.0.0](https://github.com/stripe/stripe-java/releases/tag/v29.0.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Node.js

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Node SDK to [v18.0.0](https://github.com/stripe/stripe-node/releases/tag/v18.0.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### Go

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your Go SDK to [v82.0.0](https://github.com/stripe/stripe-go/releases/tag/v82.0.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

#### .NET

1. [View your current API version](https://docs.stripe.com/upgrades.md#view-your-api-version-and-the-latest-available-upgrade-in-workbench) in Workbench.
2. Upgrade your .NET SDK to [v48.0.0](https://github.com/stripe/stripe-dotnet/releases/tag/v48.0.0)
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.
5. If you use Connect, [test your Connect integration](https://docs.stripe.com/connect/testing.md).
6. In Workbench, [perform the upgrade](https://docs.stripe.com/upgrades.md#perform-the-upgrade). You can [roll back the version](https://docs.stripe.com/upgrades.md#roll-back-your-api-version) for 72 hours.

Learn more about [Stripe API upgrades](https://docs.stripe.com/upgrades.md).

## Related changes

- [Invoicing resources now specify how they were generated](https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects.md)
- [Adds support for last aggregation formula on meters](https://docs.stripe.com/changelog/basil/2025-03-31/meters-last-agg-formula.md)
- [Adds new webhook event types for Billing Meters](https://docs.stripe.com/changelog/basil/2025-03-31/billing-meter-webhooks.md)
- [Adds new webhook event types for billing credits](https://docs.stripe.com/changelog/basil/2025-03-31/billing-credit-webhooks.md)
