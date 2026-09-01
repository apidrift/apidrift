# Memory Index

- [Sourcing a Stripe change](reference_stripe_sourcing.md) — docs.stripe.com serves `.md` variants; the HTML is a JS shell with no content.
- [Evidence before abstraction](decision_evidence_before_abstraction.md) — don't widen the `Change` model on speculation; sample #2 is the Subscription period move (PR #6), Checkout scoping abandoned.
- [Architecture doc must lag code, never lead it](feedback_arch_doc_tracks_code.md) — constraints in architecture.json are dated facts read from the code, not intentions.
- [Détection : la forme du change se lit dans l'URL du changelog](decision_detection_change_shape.md) — `/api/x/create` = matcher générique OK, `/api/x/object` = codemod manuel.
