<!-- Fixture for US-14 AC7(b), THE INDEX SENTINEL. A SYNTHETIC document standing in for the one failure the walk could not see: docs.stripe.com answers 200, the body arrives intact, and not a single `## <date>[.<channel>]` heading is in it — the vendor reorganized its changelog, or a CDN served something else under the same URL. `parseReleaseHeadings` then returns [] without raising anything at all, and before US-14 `selectReleases` turned that into `line-not-published` + `walked: []` + `to === from`, i.e. a run that reads EXACTLY like "the vendor has published nothing since your pin". That false "nothing to do" is the outcome this whole tool exists to prevent, hence a distinct `WalkStatus` ('index-empty'), a distinct sentence, and exit 1. -->

# Stripe API changelog

Welcome to the changelog. Browse releases by year using the navigation on the
left, or subscribe to the RSS feed.

### 2026

Nothing in this document carries a `## YYYY-MM-DD` heading, which is the single
shape the index parser recognizes.

| Title | Affected Products | Breaking change? | Category |
| --- | --- | --- | --- |
| [A row with no release heading above it](https://docs.stripe.com/changelog/orphan.md) | Payments | Breaking | api |
