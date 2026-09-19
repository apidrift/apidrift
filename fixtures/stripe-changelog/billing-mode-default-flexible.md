<!-- Fixture for US-13 (AC5/AC5bis): a REDUCED copy of https://docs.stripe.com/changelog/clover/2025-09-30/billing-mode-default-flexible.md (structure verified live 2026-09-10, prose shortened). THE TRAP this fixture exists to lock down: it carries a `#### Node.js` heading, but under `## Upgrade`, holding numbered UPGRADE PROSE — not a `Parameter(s) | Change | Resources` table — and it has NO `## Changes` section at all. 56 of the 69 real Breaking pages of the reference walk carry a `#### Node.js`; only 36 carry `## Changes`. Treating "has #### Node.js but yielded nothing" as a hole would therefore manufacture 20 false gaps. This page is the ORDINARY, MAJORITY case: perfectly readable (it carries `## What’s new`, `## Upgrade`, `## Related changes`), contributing zero changes, and it must produce ZERO gaps. -->

# Sets the default billing mode to flexible

## What’s new

Subscriptions and subscription schedules created without an explicit `billing_mode` now default to `flexible` instead of `classic`.

## Why is this a breaking change?

Existing integrations that relied on the `classic` default observe different proration and invoicing behaviour.

## Impact

If your integration depends on `classic` billing behaviour, set `billing_mode` explicitly before upgrading.

## Upgrade

#### Node.js

1. [View your current API version](https://docs.stripe.com/upgrades.md) in Workbench.
2. Upgrade your Node SDK to v19.1.0 or later.
3. Upgrade the API version used for [webhook endpoints](https://docs.stripe.com/webhooks/versioning.md).
4. [Test your integration](https://docs.stripe.com/testing.md) against the new version.

## Related changes

- [Adds subscription item-level billing periods and removes subscription-level periods](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md)
