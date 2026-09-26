<!-- Fixture for US-16, AC2c — a row with a title link whose Breaking column is
neither "Breaking" nor "Non-breaking". `parseChangelogIndex` still silently
`continue`s past this row (its contract is frozen — decision humaine 3 du
2026-09-19), but `findUnclassifiedBreakingRows` sees it, and `changesSince`
turns it into a named gap on any walk that covers 2025-02-01.acacia. -->

## 2025-02-01.acacia

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [A row whose Breaking column reads "Maybe" — an unrecognized value, not silently dropped anymore](https://docs.stripe.com/changelog/acacia/2025-02-01/ambiguous-breaking-value.md) | Payments | Maybe | api |
| [Removes support for specifying payment method types in Payment Intents and Setup Intents](https://docs.stripe.com/changelog/dahlia/2026-08-26/removes-payment-method-types-parameter-from-payment-intents-setup-intents.md) | Payments | Breaking | api |
