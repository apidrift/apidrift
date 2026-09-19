<!-- Fixture for US-12: a SYNTHETIC index (not a verbatim changelog excerpt like index-excerpt.md) built to exercise VendorSource.changesSince's walk over several releases: chronological ordering, same-channel-line filtering (the "off-channel" preview row must never be walked into), and per-release gap isolation (one release's detail page is deliberately unreachable). Detail pages reused are the SAME committed US-2 fixtures (removes-payment-method-types-...-setup-intents.md, deprecate-subscription-current-period-start-and-end.md) under new, synthetic release headings -- detectChanges tags a Change with whatever release heading the INDEX puts it under, not with anything in the page content, so reusing them here is exact reuse, not a new detail-page fixture. -->

## 2025-01-01.acacia

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [Baseline release, already applied to this repo](https://docs.stripe.com/changelog/acacia/2025-01-01/baseline-already-applied.md) | Payments | Breaking | api |

## 2025-02-01.acacia

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [Removes support for specifying payment method types in Payment Intents and Setup Intents](https://docs.stripe.com/changelog/dahlia/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-intents.md) | Payments | Breaking | api |

## 2025-02-15.preview

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [A preview-channel row that must never be walked into from the acacia line](https://docs.stripe.com/changelog/preview/2025-02-15/off-channel.md) | Payments | Breaking | api |

## 2025-03-01.acacia

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [A page that fails to fetch -- simulates an HTTP-200 index but an unreachable detail page](https://docs.stripe.com/changelog/acacia/2025-03-01/unreachable-detail-page.md) | Payments | Breaking | api |

## 2025-04-01.acacia

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [Adds subscription item-level billing periods and removes subscription-level periods](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md) | Billing | Breaking | api |
