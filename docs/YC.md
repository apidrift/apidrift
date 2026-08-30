# APIdrift — YC north star

> This file is the durable home of the YC framing. Keep it current; it's the
> pitch and the guardrail for what the repo should stay pointed at.

## The RFS we're answering

YC Requests for Startups — **"Self-Maintaining APIs"**. The thesis: vendors
shouldn't just announce API changes, they should apply them. When Stripe ships a
breaking change or a new feature, an agent should scan client codebases, find
affected usages, and open a PR with the fix. The infra for automated code
changes exists; the missing layer connects API providers to their clients'
codebases.

## Our wedge

The **push model**, with **verification** as the moat.

- Detection is commoditized (oasdiff). We don't rebuild it.
- Codemod engines exist (Codemod.com / ast-grep). We don't rebuild them.
- Nobody runs an always-on, neutral, cross-vendor service that opens a **tested**
  fix PR before you even knew the vendor changed. That's us.

## The proof (what this repo demonstrates)

`npm run demo` turns a real Stripe deprecation into a clean, tested PR on a
sample repo. `npm test` proves the moat: when a fix breaks the repo's own tests,
APIdrift opens a **draft**, never a green PR. A wrong fix cannot merge.

## Go-to-market (one engine, three wrappers)

- **Free — CLI.** `npx @apidrift/cli run <repo>`. Zero trust barrier (code stays
  local). Top of funnel. This is the current MVP.
- **Pro — Git App.** Install, pick repos; we poll vendors and auto-open PRs.
  Maximum magic, we see their code (ephemeral).
- **Enterprise — self-hosted runner.** Engine runs in the client's CI; only
  change metadata leaves our side. Code never leaves. Unblocks big accounts.

## Traction plan

Land 3 design partners who each say "your PR prevented an incident." Mine GitHub
for repos on old Stripe patterns; arrive with the PR already made.

## Metrics that matter

- PRs opened / merged, and merge rate (are they clean enough to trust?).
- Time from vendor change → open PR.
- Incidents prevented (design-partner testimony).

## Proof log

- [ ] Repo #1: _(name, PR link, outcome)_
- [ ] Repo #2:
- [ ] Repo #3:
