# Migrate deprecated Charges.create to PaymentIntents.create

⚠️ **Tests did not pass** — opened as a draft for a human to finish.

## What changed upstream
- **Vendor:** stripe
- **Type:** deprecation (confidence: high)
- **What:** `stripe.charges.create` — stripe.paymentIntents.create; param `source` -> `payment_method`; add `confirm: true` and `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }` (avoids the conditional `return_url` requirement for redirect-based payment methods)
- **Changelog:** https://docs.stripe.com/payments/payment-intents/migration

## What this PR does
Updated 1 usage across 1 file:
- `routes/order.js`

## Verification
Ran `npm test` in an isolated sandbox against your own tests:

```
/tmp/apidrift-hMvYX1/routes/order.js:9:26: Missing space before function parentheses.
  /tmp/apidrift-hMvYX1/routes/order.js:10:30: Missing space before function parentheses.
  /tmp/apidrift-hMvYX1/routes/order.js:18:29: Missing space before function parentheses.
  /tmp/apidrift-hMvYX1/routes/order.js:30:39: Missing space before function parentheses.
  /tmp/apidrift-hMvYX1/routes/order.js:40:28: Missing space before function parentheses.
  /tmp/apidrift-hMvYX1/routes/order.js:45:16: Missing space before function parentheses.
standard: Use JavaScript Standard Style (https://standardjs.com)
standard: Run `standard --fix` to automatically fix some problems.
```

## Diff
```diff
diff --git a/routes/order.js b/routes/order.js
index b112488..65bacc4 100644
--- a/routes/order.js
+++ b/routes/order.js
@@ -6,8 +6,8 @@ const secret = require('../secret')
 
 const stripe = require('stripe')(secret.stripe)
 
-module.exports = function (app) {
-  app.post('/order', function (req, res, next) {
+module.exports = function(app) {
+  app.post('/order', function(req, res, next) {
     const product = req.body.product
     const desc = config.product[product].desc
     const amount = config.product[product].price
@@ -15,17 +15,19 @@ module.exports = function (app) {
     const referrer = req.body.referrer
 
     auto({
-      stripeCharge: function (cb) {
-        stripe.charges.create({
+      stripeCharge: function(cb) {
+        stripe.paymentIntents.create({
           amount: amount,
           currency: 'usd',
-          source: req.body.id,
+          payment_method: req.body.id,
           description: desc + ' (' + email + ')',
-          receipt_email: email
+          receipt_email: email,
+          confirm: true,
+          automatic_payment_methods: { enabled: true, allow_redirects: 'never' }
         }, cb)
       },
 
-      order: ['stripeCharge', function (r, cb) {
+      order: ['stripeCharge', function(r, cb) {
         const order = new model.Order({
           stripeEmail: email,
           stripeToken: req.body.id,
@@ -35,12 +37,12 @@ module.exports = function (app) {
           freeEssays: req.session.free,
           stripeCharge: JSON.stringify(r.stripeCharge)
         })
-        order.save(function (err, order) {
+        order.save(function(err, order) {
           cb(err, order)
         })
       }]
 
-    }, function (err, r) {
+    }, function(err, r) {
       if (err) {
         if (err.type === 'StripeCardError') {
           debug('Card declined: %s', err.message)
```

---
_Opened automatically by apidrift[bot]. The fixer edits source only; your tests were run unmodified._
