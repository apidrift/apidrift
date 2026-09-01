<!-- Fixture for US-2: fetched verbatim from https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-singular-coupon-promotion-code.md, consulted 2026-09-01. MIXED page: the Node.js '## Changes' table has a 'discount | Removed' row pointing only at /api/invoices/object and /api/subscriptions/object (form #2), and 'coupon'/'promotion_code | Removed' rows pointing mostly at methods (form #1), with some nested/array links (schedule_details.phases[]) that the discriminant must exclude from auto-executable. -->

# Removes coupon and promotion code parameters with stackable discounts

## What’s new

We’re removing the singular `coupon` and `promotion_code` parameters in favor of the [`discounts`](https://docs.stripe.com/api/subscriptions/create.md?api-version=2025-03-31.basil#create_subscription-discounts) parameter that supports applying multiple discounts.

## Why is this a breaking change?

The `coupon` and `promotion_code` parameters and fields are no longer available on [Subscription](https://docs.stripe.com/api/subscriptions.md?api-version=2025-03-31.basil), [Subscription Schedule](https://docs.stripe.com/api/subscription_schedules.md?api-version=2025-03-31.basil), [Customer](https://docs.stripe.com/api/customers.md?api-version=2025-03-31.basil) or [Preview Invoice](https://docs.stripe.com/api/invoices/create_preview.md?api-version=2025-03-31.basil) endpoints and respective resources.

## Impact

Use the `discounts` parameter to include one or more discounts on a [Subscription](https://docs.stripe.com/api/subscriptions.md?api-version=2025-03-31.basil), [Subscription Schedule](https://docs.stripe.com/api/subscription_schedules.md?api-version=2025-03-31.basil), or [Preview Invoice](https://docs.stripe.com/api/invoices/create_preview.md?api-version=2025-03-31.basil), and read from `discounts` in the responses instead.

## Changes

#### REST API

| Parameters | Change | Resources or endpoints |
| --- | --- | --- |
| `coupon` | Removed | [Invoice#create_preview.schedule_details.phases[]](/api/invoices/create_preview?api-version=2025-03-31.basil#create_create_preview-schedule_details-phases), [Invoice#create_preview](/api/invoices/create_preview?api-version=2025-03-31.basil), [Subscription#create](/api/subscriptions/create?api-version=2025-03-31.basil), [Subscription#update](/api/subscriptions/update?api-version=2025-03-31.basil), [SubscriptionSchedule#create.phases[]](/api/subscription_schedules/create?api-version=2025-03-31.basil#create_subscription_schedule-phases), [SubscriptionSchedule#update.phases[]](/api/subscription_schedules/update?api-version=2025-03-31.basil#update_subscription_schedule-phases), [SubscriptionSchedule.phases[]](/api/subscription_schedules/object?api-version=2025-03-31.basil#subscription_schedule_object-phases), [Customer#create](/api/customers/create?api-version=2025-03-31.basil), [Customer#update](/api/customers/update?api-version=2025-03-31.basil) |
| `discount` | Removed | [Invoice](/api/invoices/object?api-version=2025-03-31.basil), [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |
| `promotion_code` | Removed | [Subscription#create](/api/subscriptions/create?api-version=2025-03-31.basil), [Subscription#update](/api/subscriptions/update?api-version=2025-03-31.basil), [Customer#create](/api/customers/create?api-version=2025-03-31.basil), [Customer#update](/api/customers/update?api-version=2025-03-31.basil) |

#### Ruby

This change does not affect the Ruby SDK.

#### Python

| Parameters | Change | Resources or methods |
| --- | --- | --- |
| `coupon` | Removed | [stripe.Invoice.CreatePreviewParams](/api/invoices/create_preview?api-version=2025-03-31.basil), [stripe.Invoice.CreatePreviewParamsScheduleDetailsPhase](/api/invoices/create_preview?api-version=2025-03-31.basil#create_create_preview-schedule_details-phases), [stripe.Subscription.CreateParams](/api/subscriptions/create?api-version=2025-03-31.basil), [stripe.Subscription.ModifyParams](/api/subscriptions/update?api-version=2025-03-31.basil), [stripe.SubscriptionSchedule.CreateParamsPhase](/api/subscription_schedules/create?api-version=2025-03-31.basil#create_subscription_schedule-phases), [stripe.SubscriptionSchedule.ModifyParamsPhase](/api/subscriptions/update?api-version=2025-03-31.basil), [stripe.SubscriptionSchedule.Phase](/api/subscription_schedules/object?api-version=2025-03-31.basil#subscription_schedule_object-phases), [Customer.CreateParams](/api/customers/create?api-version=2025-03-31.basil), [Customer.UpdateParams](/api/customers/update?api-version=2025-03-31.basil) |
| `discount` | Removed | [stripe.Invoice](/api/invoices/object?api-version=2025-03-31.basil), [stripe.Subscription](/api/subscriptions?api-version=2025-03-31.basil) |
| `promotion_code` | Removed | [stripe.Subscription.CreateParams](/api/subscriptions/create?api-version=2025-03-31.basil), [stripe.Subscription.ModifyParams](/api/subscriptions/update?api-version=2025-03-31.basil), [Customer.CreateParams](/api/customers/create?api-version=2025-03-31.basil), [Customer.UpdateParams](/api/customers/update?api-version=2025-03-31.basil) |

#### PHP

| Parameter | Change | Resources or methods |
| --- | --- | --- |
| `discount` | Removed | [Invoice](/api/invoices/object?api-version=2025-03-31.basil), [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |

#### Java

| Parameters | Change | Resources or methods |
| --- | --- | --- |
| `coupon` | Removed | [InvoiceCreatePreviewParams.schedule_details.phases[]](/api/invoices/create_preview?api-version=2025-03-31.basil#create_create_preview-schedule_details-phases), [InvoiceCreatePreviewParams](/api/invoices/create_preview?api-version=2025-03-31.basil), [SubscriptionCreateParams](/api/subscriptions/create?api-version=2025-03-31.basil), [SubscriptionSchedule.phases[]](/api/subscription_schedules/object?api-version=2025-03-31.basil#subscription_schedule_object-phases), [SubscriptionScheduleCreateParams.phases[]](/api/subscription_schedules/create?api-version=2025-03-31.basil#create_subscription_schedule-phases), [SubscriptionScheduleUpdateParams.phases[]](/api/subscription_schedules/update?api-version=2025-03-31.basil#update_subscription_schedule-phases), [SubscriptionUpdateParams](/api/subscriptions/update?api-version=2025-03-31.basil), [CustomerCreateParams](/api/customers/create?api-version=2025-03-31.basil), [CustomerUpdateParams](/api/customers/update?api-version=2025-03-31.basil) |
| `discount` | Removed | [Invoice](/api/invoices/object?api-version=2025-03-31.basil), [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |
| `promotion_code` | Removed | [SubscriptionCreateParams](/api/subscriptions/create?api-version=2025-03-31.basil), [SubscriptionUpdateParams](/api/subscriptions/update?api-version=2025-03-31.basil), [CustomerCreateParams](/api/customers/create?api-version=2025-03-31.basil), [CustomerUpdateParams](/api/customers/update?api-version=2025-03-31.basil) |

#### Node.js

| Parameters | Change | Resources or methods |
| --- | --- | --- |
| `coupon` | Removed | [InvoiceCreatePreviewParams.schedule_details.phases[]](/api/invoices/create_preview?api-version=2025-03-31.basil#create_create_preview-schedule_details-phases), [InvoiceCreatePreviewParams](/api/invoices/create_preview?api-version=2025-03-31.basil), [SubscriptionCreateParams](/api/subscriptions/create?api-version=2025-03-31.basil), [SubscriptionSchedule.phases[]](/api/subscription_schedules/object?api-version=2025-03-31.basil#subscription_schedule_object-phases), [SubscriptionScheduleCreateParams.phases[]](/api/subscription_schedules/create?api-version=2025-03-31.basil#create_subscription_schedule-phases), [SubscriptionScheduleUpdateParams.phases[]](/api/subscription_schedules/update?api-version=2025-03-31.basil#update_subscription_schedule-phases), [SubscriptionUpdateParams](/api/subscriptions/update?api-version=2025-03-31.basil), [CustomerCreateParams](/api/customers/create?api-version=2025-03-31.basil), [CustomerUpdateParams](/api/customers/update?api-version=2025-03-31.basil) |
| `discount` | Removed | [Invoice](/api/invoices/object?api-version=2025-03-31.basil), [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |
| `promotion_code` | Removed | [SubscriptionCreateParams](/api/subscriptions/create?api-version=2025-03-31.basil), [SubscriptionUpdateParams](/api/subscriptions/update?api-version=2025-03-31.basil), [CustomerCreateParams](/api/customers/create?api-version=2025-03-31.basil), [CustomerUpdateParams](/api/customers/update?api-version=2025-03-31.basil) |

#### Go

| Parameters | Change | Resources or methods |
| --- | --- | --- |
| `Coupon` | Removed | [InvoiceCreatePreviewParams](/api/invoices/create_preview?api-version=2025-03-31.basil), [InvoiceCreatePreviewScheduleDetailsPhasesParams](/api/invoices/create_preview?api-version=2025-03-31.basil#create_create_preview-schedule_details-phases), [SubscriptionParams](/api/subscriptions?api-version=2025-03-31.basil), [SubscriptionSchedulePhasesParams](/api/subscription_schedules/object?api-version=2025-03-31.basil#subscription_schedule_object-phases), [SubscriptionSchedulePhases](/api/subscription_schedules/object?api-version=2025-03-31.basil#subscription_schedule_object-phases), [CustomerParams](/api/customers/object?api-version=2025-03-31.basil) |
| `Discount` | Removed | [Invoice](/api/invoices/object?api-version=2025-03-31.basil), [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |
| `PromotionCode` | Removed | [SubscriptionParams](/api/subscriptions?api-version=2025-03-31.basil), [CustomerParams](/api/customers/object?api-version=2025-03-31.basil) |

#### .NET

| Parameters | Change | Resources or methods |
| --- | --- | --- |
| `Coupon` | Removed | [InvoiceCreatePreviewOptions](/api/invoices/create_preview?api-version=2025-03-31.basil), [InvoiceScheduleDetailsPhasesOptions](/api/invoices/create_preview?api-version=2025-03-31.basil#create_create_preview-schedule_details-phases), [SubscriptionCreateOptions](/api/subscriptions/create?api-version=2025-03-31.basil), [SubscriptionSchedulePhasesOptions](/api/subscription_schedules/object?api-version=2025-03-31.basil#subscription_schedule_object-phases), [SubscriptionSchedulePhases](/api/subscription_schedules/object?api-version=2025-03-31.basil#subscription_schedule_object-phases), [SubscriptionUpdateOptions](/api/subscriptions/update?api-version=2025-03-31.basil), [CustomerCreateOptions](/api/customers/create?api-version=2025-03-31.basil), [CustomerUpdateOptions](/api/customers/update?api-version=2025-03-31.basil) |
| `Discount` | Removed | [Invoice](/api/invoices/object?api-version=2025-03-31.basil), [Subscription](/api/subscriptions/object?api-version=2025-03-31.basil) |
| `PromotionCode` | Removed | [SubscriptionCreateOptions](/api/subscriptions/create?api-version=2025-03-31.basil), [SubscriptionUpdateOptions](/api/subscriptions/update?api-version=2025-03-31.basil), [CustomerCreateOptions](/api/customers/create?api-version=2025-03-31.basil), [CustomerUpdateOptions](/api/customers/update?api-version=2025-03-31.basil) |

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

- [Removes support for discount coupons that don’t have a specified end time](https://docs.stripe.com/changelog/basil/2025-03-31/restrict-coupon-duration.md)
