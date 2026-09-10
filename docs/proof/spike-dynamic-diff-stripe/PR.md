# Removes support for specifying payment method types in Payment Intents and Setup Intents

✅ **All checks passed** — your test suite, unmodified.

## What changed upstream
- **Vendor:** stripe
- **Type:** breaking (confidence: low)
- **What:** `stripe.paymentIntents.create` — `payment_method_types` — If your integration passes `payment_method_types` when creating, updating, or confirming a PaymentIntent or SetupIntent, you must remove it before upgrading to API version `2026-08-26.preview` or later.

You can replace it with [dynamic payment methods](https://docs.stripe.com/payments/payment-methods/dynamic-payment-methods.md) to automatically determine available payment methods based on other parameters such as `currency`, `amount`, and `customer`. If you need more control:

- Use [excluded_payment_method_types](https://docs.stripe.com/api/payment_intents/create.md?api-version=2026-08-26.preview#create_payment_intent-excluded_payment_method_types) to exclude specific types from the set determined by dynamic payment methods.
- Use [allowed_payment_method_types](https://docs.stripe.com/api/payment_intents/create.md?api-version=2026-08-26.preview#create_payment_intent-allowed_payment_method_types) to specify a list of types you want to accept. Stripe filters out incompatible types instead of returning an error.

You can continue to read `payment_method_types` to retrieve the computed list of available payment methods.
- **Changelog:** https://docs.stripe.com/changelog/dahlia/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-intents.md (consulted 2026-09-10)
- **API version:** takes effect from `2026-08-26.preview` — this repo's code sets no `apiVersion`, and APIdrift could not read the default one from the installed `stripe` package (v99.0.0). stripe-node v12+ pins IMPLICITLY to the API version current at its own release, so "no pin in the code" is not "latest" — confirm yours is `2026-08-26.preview` or later.

## What this PR does
Updated 1 usage across 1 file:
- `src/checkout.js`

## Verification
Ran `npm test` in an isolated sandbox against your own tests:

```
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## Diff
```diff
diff --git a/src/checkout.js b/src/checkout.js
index 7fe814f..24f1aec 100644
--- a/src/checkout.js
+++ b/src/checkout.js
@@ -10,7 +10,6 @@ export async function createPaymentIntent({ amountCents, currency }) {
   const intent = await stripe.paymentIntents.create({
     amount: amountCents,
     currency,
-    payment_method_types: ['card'],
   });
 
   return { id: intent.id, amount: intent.amount, currency: intent.currency };
```

---
_Opened automatically by apidrift[bot]. The fixer edits source only; your tests were run unmodified._
