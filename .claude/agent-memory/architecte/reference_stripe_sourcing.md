---
name: reference-stripe-sourcing
description: How to source a real Stripe API change with a citable URL — docs.stripe.com serves a Markdown variant, the rendered HTML is useless
metadata:
  type: reference
---

Sourcing a vendor change for `src/changes/` (Stripe): fetch the **Markdown**
variant, not the HTML. `curl` on a `docs.stripe.com` page returns a JS-rendered
shell (~7k chars of nav, no content). Appending `.md` to any docs URL returns
the full prose.

Entry points that worked (verified 2026-09-01):
- `https://docs.stripe.com/changelog.md` — full changelog index, one table row
  per change with a `Breaking` / `Non-breaking` column. Grep this first.
- `https://docs.stripe.com/changelog/<release>.md` — per-release overview
  (e.g. `basil.md`). Lists the headline breaking changes with links.
- `https://docs.stripe.com/changelog/<release>/<date>/<slug>.md` — the detail
  page. This is the citable source: it states what was removed/added, why it's
  breaking, and the per-SDK version boundary (e.g. stripe-node v18.0.0).
- `https://docs.stripe.com/upgrades.md` — versioning policy, what Stripe
  considers backward-compatible.

Content comes back in the locale of the request; the changelog index is
localized but URLs/slugs are stable in English. Send
`Accept-Language: en-US` to get English detail pages.

Note the sibling approach used by [[decision-evidence-before-abstraction]]'s
US-4: the raw OpenAPI spec (`stripe/openapi`, `spec3.json`) is the right source
for *request-shape* questions ("is this body valid"), the changelog is the right
source for *removals* (proving an absence in a schema is weak and noisy).
