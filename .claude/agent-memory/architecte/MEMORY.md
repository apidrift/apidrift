# Memory Index

- [Sourcing a Stripe change](reference_stripe_sourcing.md) — docs.stripe.com serves `.md` variants; the HTML is a JS shell with no content.
- [Evidence before abstraction](decision_evidence_before_abstraction.md) — don't widen the `Change` model on speculation; sample #2 is the Subscription period move (PR #6), Checkout scoping abandoned.
- [Architecture doc must lag code, never lead it](feedback_arch_doc_tracks_code.md) — constraints in architecture.json are dated facts read from the code, not intentions.
- [Détection : la forme du change se lit dans l'URL du changelog](decision_detection_change_shape.md) — `/api/x/create` = matcher générique OK, `/api/x/object` = codemod manuel.
- [Portée du formatage du fixer (US-8)](decision_fixer_format_scope.md) — plage AST, jamais le fichier ; ts-morph expose bien `Node#formatText` (le README US-6 dit le contraire, à tort).
- [Garde version d'API (US-7)](decision_api_version_gating.md) — le sens de l'erreur diffère matcher vs garde ; comparer 10 caractères ; stripe-node ≥ v12 épingle implicitement.
- [Pin implicite du SDK installé (US-9)](decision_implicit_sdk_pin.md) — le fichier `API_VERSION` n'existe pas ; lire `apiVersion.js` + seuil majeur ≥ 12, jamais une table.
- [Walk : ligne stable = non-preview, ordonnée par date](decision_walk_channel_line.md) — ni « même canal » (US-12), ni liste ordonnée de canaux (refusée) ; 20 faux positifs sur 20 sans la condition preview.
- [Page illisible vs page sans changement](decision_page_readability_sentinel.md) — sentinelle sur les headings anglais traduisibles, `Impact` exclu (identique en français) ; `#### Node.js` est un faux discriminant.
- [Un N+1 intra-run n'est pas un problème de cache](decision_cache_vs_nplus1.md) — arbitré vers le walk (US-13) ; le test de comptage de fetchs doit précéder le cache.
- [Pannes silencieuses du changelog](decision_changelog_silent_failures.md) — langue, regex de heading, throw sur une page : trois façons de lire « à jour » à tort.
- [Design du Free tier dynamique](decision_free_tier_dynamic_diff.md) — VendorSource rend des `Change`, registre = mode déterministe, cache en tmpdir, `--offline` fail-close.
