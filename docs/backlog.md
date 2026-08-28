# Backlog

Out-of-MVP-scope ideas land here instead of getting built early.

## Next

- ~~**AI fixer (tier 2).**~~ ✅ Done — `src/fixer/agent.ts` (injectable LLM,
  code-enforced guardrails, proven in `tests/ai-fixer.test.ts`). Next: blast
  radius beyond matched files (include imports), and a learning loop that
  promotes recurring AI fixes into deterministic codemods.
- **Automated change detection.** Poll OpenAPI specs (oasdiff) + npm/PyPI
  releases + changelog NLP → emit `Change` records into `src/changes`.
- **GitLabHost.** MR via GitLab API, behind the existing `GitHost` interface
  (GitHubHost is done).
- **Wire real detection into the tiers.** Replace the hardcoded registry so the
  runner/service consume Change records from oasdiff + SDK diffs.

- ~~**Pluggable inference layer.**~~ ✅ Done — policy `deterministic-only | byot |
  managed | byo-endpoint` (`src/config.ts`, `src/fixer/providers.ts`), with
  Bedrock/Vertex as lazy optional deps. Managed gateway URL/token wired; the
  hosted gateway service itself is still to build.

## Pro backend (to finish `src/service`)

- Mint scoped installation tokens via a GitHub App (`poller.mintInstallationToken`).
- Queue + worker; store per-vendor spec snapshots; store subscriptions.
- Detect which vendors a repo depends on (package.json + imports).
- Onboarding sweep: on install, run all known past changes, open a batch of PRs.

## Later

- Self-hosted runner (GitHub Action / GitLab CI component).
- Idempotency: update an existing open PR instead of duplicating.
- Second language (Python) and second vendor.
- Confidence-aware behavior (auto-open high, draft-only low).
- Dashboard, auth, billing.
