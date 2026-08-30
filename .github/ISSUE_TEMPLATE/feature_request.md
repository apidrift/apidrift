---
name: Feature request
about: Propose a new supported API change, or an improvement to the engine
title: "[feature] "
labels: enhancement
---

**What's the change?**

If this is a new supported API change (e.g. a new Stripe deprecation),
please include:

- vendor + the exact before/after API shape,
- a link to the vendor's changelog/migration guide if available.

**Why does it matter?**

**Have you checked `docs/backlog.md` and the scope guards in `CLAUDE.md`?**

APIdrift intentionally does not (yet) do generic multi-vendor/multi-language
support, automated change detection, or a web UI/dashboard — see `CLAUDE.md`.
If your request falls in one of those buckets, it's likely already tracked
in `docs/backlog.md`; feel free to +1 there instead of filing a duplicate.

**Proposed approach** (optional)
