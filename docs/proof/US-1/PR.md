# Migrate deprecated Charges.create to PaymentIntents.create

✅ **All checks passed** — your test suite, unmodified.

## What changed upstream
- **Vendor:** stripe
- **Type:** deprecation (confidence: high)
- **What:** `stripe.charges.create` — stripe.paymentIntents.create; param `source` -> `payment_method`; add `confirm: true` and `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }` (avoids the conditional `return_url` requirement for redirect-based payment methods)
- **Changelog:** https://docs.stripe.com/payments/payment-intents/migration

## What this PR does
Updated 1 usage across 1 file:
- `controllers/api.js`

## Verification
Ran `npm test` in an isolated sandbox against your own tests:

```
328 passing (8s)
```

## Diff
```diff
diff --git a/controllers/api.js b/controllers/api.js
index 6a02a61..9963cfa 100644
--- a/controllers/api.js
+++ b/controllers/api.js
@@ -485,12 +485,14 @@ exports.getStripe = (req, res) => {
  */
 exports.postStripe = (req, res) => {
   const { stripeToken, stripeEmail } = req.body;
-  stripe.charges.create(
+  stripe.paymentIntents.create(
     {
       amount: 395,
       currency: 'usd',
-      source: stripeToken,
+      payment_method: stripeToken,
       description: stripeEmail,
+      confirm: true,
+      automatic_payment_methods: { enabled: true, allow_redirects: 'never' }
     },
     (err) => {
       if (err && err.type === 'StripeCardError') {
```

---
_Opened automatically by apidrift[bot]. The fixer edits source only; your tests were run unmodified._
