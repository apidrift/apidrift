# Read subscription billing periods off subscription items (Basil 2025-03-31)

✅ **All checks passed** — your test suite, unmodified.

## What changed upstream
- **Vendor:** stripe
- **Type:** breaking (confidence: medium)
- **What:** `stripe.subscriptions.retrieve` — `current_period_start` / `current_period_end` were removed from the Subscription resource and added to Subscription Item; read them as `subscription.items.data[0].current_period_*`. Confidence medium: `items.data[0]` is exact for single-item subscriptions; a multi-item subscription has one period PER item, so a human should confirm which item is meant.
- **Changelog:** https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md (fetched 2026-09-01) — breaking, API version 2025-03-31.basil

## What this PR does
Updated 6 usages across 4 files:
- `srv/api/billing/checkout.js`
- `srv/api/billing/checkout.ts`
- `srv/api/billing/modify.js`
- `srv/api/billing/modify.ts`

## Verification
Ran `npm test` in an isolated sandbox against your own tests:

```
68 passing (147ms)
```

## Diff
```diff
diff --git a/srv/api/billing/checkout.ts b/srv/api/billing/checkout.ts
index 70c9b7a..ad2423c 100644
--- a/srv/api/billing/checkout.ts
+++ b/srv/api/billing/checkout.ts
@@ -85,8 +85,8 @@ export const assignSubscription = handle(async ({ body, log }) => {
     throw new StatusError('Cannot find user', 404)
   }
 
-  const lastRenewed = new Date(subscription.current_period_start * 1000).toISOString()
-  const validUntil = new Date(subscription.current_period_end * 1000).toISOString()
+  const lastRenewed = new Date(subscription.items.data[0].current_period_start * 1000).toISOString()
+  const validUntil = new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
   const customerId = subscription.customer as string
   const priceId = subscription.items.data[0].price.id
   const productId = subscription.items.data[0].price.product as string
@@ -163,7 +163,7 @@ export const finishCheckout = handle(async ({ body, userId }) => {
           username: user?.username || '',
         },
       })
-      .catch(() => {})
+      .catch(() => { })
 
     const now = new Date()
     const lastRenewed = now.toISOString()
diff --git a/srv/api/billing/modify.ts b/srv/api/billing/modify.ts
index 86436f6..4586f1d 100644
--- a/srv/api/billing/modify.ts
+++ b/srv/api/billing/modify.ts
@@ -60,7 +60,7 @@ export const modifySubscription = handle(async ({ body, userId }) => {
       metadata: { tierId: body.tierId },
       items: [{ id: item.id, price: tier.priceId }],
     })
-    const activeAt = new Date(next.current_period_end * 1000)
+    const activeAt = new Date(next.items.data[0].current_period_end * 1000)
     await subsCmd.downgrade(userId, {
       activeAt: activeAt.toISOString(),
       priceId: tier.priceId,
```

---
_Opened automatically by apidrift[bot]. The fixer edits source only; your tests were run unmodified._
