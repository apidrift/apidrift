<!-- Fixture for US-13 (AC5bis): the SAME page as removes-payment-method-types-parameter-from-payment-intents-setup-intents.md, as docs.stripe.com serves it with `Accept-Language: fr` (heading vocabulary verified live 2026-09-10 on 3 pages covering both formes; prose shortened here, table kept verbatim). Section headings translate — Changes -> Modifications, What's new -> Nouveautés, Upgrade -> Mise à niveau, Related changes -> Modifications associées — while `## Impact` is IDENTICAL in French, which is exactly why Impact cannot be the sentinel. The SDK sub-heading (`#### Node.js`) and the table body (`Removed`) are NOT translated, so the page still LOOKS parseable row by row: `extractSection(md, 'Changes', 2)` simply returns null and the page contributes ZERO changes, in HTTP 200, with no exception to catch. That silent zero is the failure mode AC5 exists to turn into a named gap. -->

# Suppression de la prise en charge des types de moyens de paiement dans les Payment Intents et Setup Intents

## Nouveautés

Supprime `payment_method_types` en tant que paramètre modifiable des méthodes [create](https://docs.stripe.com/api/payment_intents/create.md?api-version=2026-08-26.preview), [update](https://docs.stripe.com/api/payment_intents/update.md?api-version=2026-08-26.preview) et [confirm](https://docs.stripe.com/api/payment_intents/confirm.md?api-version=2026-08-26.preview) des Payment Intents.

## Pourquoi s’agit-il d’une modification majeure ?

Les requêtes qui transmettent `payment_method_types` sur les points de terminaison concernés renvoient désormais une erreur `400`.

## Impact

Si votre intégration transmet `payment_method_types` lors de la création, de la mise à jour ou de la confirmation d’un PaymentIntent ou d’un SetupIntent, vous devez le supprimer avant la mise à niveau.

## Modifications

#### Node.js

| Parameter | Change | Resources or methods |
| --- | --- | --- |
| `payment_method_types` | Removed | [PaymentIntentConfirmParams](/api/payment_intents/confirm?api-version=2026-08-26.preview#confirm_payment_intent), [PaymentIntentCreateParams](/api/payment_intents/create?api-version=2026-08-26.preview#create_payment_intent), [PaymentIntentUpdateParams](/api/payment_intents/update?api-version=2026-08-26.preview#update_payment_intent), [SetupIntentCreateParams](/api/setup_intents/create?api-version=2026-08-26.preview#create_setup_intent), [SetupIntentUpdateParams](/api/setup_intents/update?api-version=2026-08-26.preview#update_setup_intent) |

## Mise à niveau

#### Node.js

1. [Consultez votre version d’API actuelle](https://docs.stripe.com/upgrades.md) dans Workbench.
2. Mettez à niveau votre SDK Node vers la dernière version.

## Modifications associées

- [Mise à jour des ressources de compte bancaire et de moyen de versement](https://docs.stripe.com/changelog/dahlia/2026-08-26/updates-v2-payout-method-and-vault-bank-account-resources.md)
