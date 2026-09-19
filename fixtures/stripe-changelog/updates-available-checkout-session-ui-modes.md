<!-- Fixture for US-13 (AC4): a REDUCED copy of https://docs.stripe.com/changelog/dahlia/2026-03-25/updates-available-checkout-session-ui-modes.md (structure verified live 2026-09-10, prose shortened). The load-bearing property is exactly what the live page has: a complete `## Changes` / `#### Node.js` table with a `Removed` row pointing at a METHOD — so buildDetectedChanges HAS something to emit — and NO `## Impact` section at all, so extractImpact() throws on the way out. The page reads fine (it carries `## What’s new`, `## Changes` and `## Upgrade`), which is the point: this is a PARSE failure on a healthy, HTTP-200 page, not an unreadable one. extractImpact's guard is NOT relaxed here; only its blast radius changes (one page instead of one release). -->

# Updates available Checkout Session UI modes

## What’s new

Removes `ui_mode` as a writable parameter from the [create](https://docs.stripe.com/api/checkout/sessions/create.md?api-version=2026-03-25.dahlia) method on Checkout Sessions.

## Why is this a breaking change?

Requests that pass `ui_mode` on the affected endpoint now return a `400` error.

## Changes

#### Node.js

| Parameter | Change | Resources or methods |
| --- | --- | --- |
| `ui_mode` | Removed | [CheckoutSessionCreateParams](/api/checkout/sessions/create?api-version=2026-03-25.dahlia#create_checkout_session) |

## Upgrade

#### Node.js

1. [View your current API version](https://docs.stripe.com/upgrades.md) in Workbench.
2. Upgrade your Node SDK to the latest version.
