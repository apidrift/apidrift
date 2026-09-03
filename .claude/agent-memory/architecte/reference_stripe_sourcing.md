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
- `https://docs.stripe.com/api/versioning.md` + `https://docs.stripe.com/sdks/set-version.md`
  — per-SDK pinning semantics. These two are the source for anything about
  *which* API version a caller is actually on; see [[decision-api-version-gating]].

Structure exploitable par machine (relevée 2026-09-01) :
- l'index : heading `## <date>.<release>`, sous-heading `### <domaine>`, puis
  tableaux à 4 colonnes `Title (lien) | Affected Products | Breaking change?
  (Breaking/Non-breaking) | Category (api/stripejs/…)`. 308 lignes `Breaking`.
- la page de détail : `## Impact` (prose de migration, citable telle quelle)
  puis `## Changes` avec un sous-tableau par SDK, dont `#### Node.js` aux
  colonnes `Parameter(s) | Change (Removed/Added) | Resources or methods`.
  Le texte des liens de la 3e colonne est spécifique au SDK et instable —
  n'exploiter que le chemin d'URL. Voir
  [[decision-detection-change-shape]].

Content comes back in the locale of the request; the changelog index is
localized but URLs/slugs are stable in English. Send
`Accept-Language: en-US` to get English detail pages.

Note the sibling approach used by [[decision-evidence-before-abstraction]]'s
US-4: the raw OpenAPI spec (`stripe/openapi`, `spec3.json`) is the right source
for *request-shape* questions ("is this body valid"), the changelog is the right
source for *removals* (proving an absence in a schema is weak and noisy).
