# Migrate deprecated Charges.create to PaymentIntents.create

⚠️ **Tests did not pass** — opened as a draft for a human to finish.

## What changed upstream
- **Vendor:** stripe
- **Type:** deprecation (confidence: high)
- **What:** `stripe.charges.create` — stripe.paymentIntents.create; param `source` -> `payment_method`; add `confirm: true` and `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }` (avoids the conditional `return_url` requirement for redirect-based payment methods)
- **Changelog:** https://docs.stripe.com/payments/payment-intents/migration

## What this PR does
Updated 1 usage across 1 file:
- `routes/index.js`

## Verification
Ran `npm test` in an isolated sandbox against your own tests:

```
Checking support of previous version features
                   1.2
                     Checking support of previous version features
                       1.1
                         Checking support of previous version features
                           1.0
                             Nat check
                               should retrieve random nat when invalid nat is specified:
[0m[31m     AssertionError: expected [ Array(17) ] to include 'IN'[0m[90m
      at Context.<anonymous> (spec/api/modern/1.0.js:188:23)
      at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
[0m
```

## Diff
```diff
diff --git a/routes/index.js b/routes/index.js
index 989451a..23cbfdd 100644
--- a/routes/index.js
+++ b/routes/index.js
@@ -68,11 +68,13 @@ const titles = {
     }
     if (captchaBody.success === true) {
       data = JSON.parse(req.body.data);
-      stripe.charges.create({
+      stripe.paymentIntents.create({
         amount: data.token.price,
         currency: "usd",
-        source: data.token.id, // obtained with Stripe.js
-        description: `Donation from ${data.token.email} - ${data.comment}`
+        payment_method: data.token.id, // obtained with Stripe.js
+        description: `Donation from ${data.token.email} - ${data.comment}`,
+        confirm: true,
+        automatic_payment_methods: { enabled: true, allow_redirects: 'never' }
       }, (err, charge) => {
         if (process.env.spec === "true") return res.sendStatus(200);
         if (err) return res.sendStatus(400);
```

---
_Opened automatically by apidrift[bot]. The fixer edits source only; your tests were run unmodified._
