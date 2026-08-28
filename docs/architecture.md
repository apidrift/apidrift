# Architecture — APIdrift

Runtime architecture of the product itself (not the build process). Three
pillars: **how we use AI**, **how we diff API changes**, and **how we interact
with git to open a PR/MR**.

---

## 0. End-to-end data flow

```
UPSTREAM TRIGGER (per vendor, central, hosted by us)
  scheduler ──poll──> OpenAPI spec + SDK releases + changelog
        │
        ▼
  DIFF ENGINE ──> normalized `Change` records ──> CHANGE FEED (queue)
        │
        │  fan-out: one job per (Change × subscribed repo)
        ▼
DOWNSTREAM ENGINE (per repo; runs hosted OR in client CI)
  1. checkout repo (ephemeral)
  2. MATCH   — ast-grep finds affected usages (blast radius)
  3. FIX     — AI agent edits source within blast radius
  4. VERIFY  — run repo's ORIGINAL tests in sandbox
  5. GIT     — branch + commit + open PR/MR (draft if red)
  6. CLEANUP — destroy workspace, expire token
```

The upstream half is **shared by all tenants** and vendor-agnostic. The
downstream half is the **same engine** whether it runs on our infra (Pro) or
inside the client's CI (Enterprise). Only the packaging changes per tier.

---

## 1. How we use AI

### Where the AI sits

The AI is used in **exactly one stage: the fixer (stage 3)**. Detection is
deterministic (diffing), verification is deterministic (running tests). Keeping
the LLM boxed into the fix step is what makes the system auditable.

Two tiers of fix, tried in order:

1. **Deterministic codemod** — if we already have an ast-grep rewrite rule for
   this `Change`, apply it. Cheap, instant, no tokens. (Populated over time; not
   required for MVP.)
2. **AI agent** — for changes with no rule yet, or changes that need semantic
   judgement. This is the general engine and the MVP's core bet.

### The AI is bet, not plumbing

The riskiest assumption in the whole product is: *can an AI turn a change +
a codebase into a correct fix that passes tests?* The MVP must test **that**.
The safety net is that the downside is **bounded** — a wrong fix cannot merge,
because verification (stage 4) gates it.

### The agentic loop

The fixer is a tool-using agent, not a single completion:

```
context pack ─> [ propose edits -> run affected tests -> read failures ]* -> diff + rationale
                  └──────────── loop until green OR budget hit ──────────┘
```

- **Tools exposed to the agent:** `read_file`, `edit_file`, `run_tests`,
  `search_code`. No freeform shell.
- **Loop budget:** max iterations, max tokens, wall-clock timeout. On exhaustion
  without green → emit best attempt as a **draft** PR with the agent's reasoning.

### Context assembly (controls cost + hallucination)

Never hand the agent the whole repo. The matcher (stage 2) computes a **blast
radius**: the matched usages, the files containing them, their direct imports,
relevant type definitions, and the touching test files (read-only). The context
pack is:

- the normalized `Change` record (what changed, before → after, migration hint);
- the vendor's new API signature/shape;
- the blast-radius source files;
- on retries: the failing test output from the previous iteration.

### Guardrails (non-negotiable)

- **Tests are read-only to the agent.** The agent edits source only.
  Verification runs the repo's **unmodified** test suite. This blocks the
  #1 failure mode: an agent weakening tests to force green.
- **File allowlist.** The agent may edit only files inside the blast radius.
  It cannot touch CI config, secrets, lockfiles, or infra.
- **No silent dependency changes.** Adding/bumping a dependency is flagged for
  human review, never done quietly.
- **If a change legitimately requires test updates**, the agent does NOT do it —
  it flags it in the PR body for a human. Auto-editing tests is out of scope.
- **No secret access** inside the fix sandbox.

### Learning loop (later)

When the agent solves a `Change` that will recur across many repos, promote its
fix into a deterministic ast-grep rule. Next time, tier 1 handles it for free.
The AI is how we *discover* fixes; determinism is how we *scale* the known ones.

---

## 2. How we diff API changes

### Trigger: poll, don't wait for webhooks

Most vendors offer no "I changed my API" webhook. So the upstream trigger is a
**scheduler that polls**, per vendor, on an interval. This works for any vendor
without their cooperation.

### Three sources of truth

| Source | How we diff | Confidence |
|---|---|---|
| **OpenAPI spec** | `oasdiff` between the stored previous spec and the fetched current one | High (structured) |
| **SDK release** | compare npm/PyPI versions; inspect changelog + published diff | High–medium |
| **Changelog / release notes** | LLM extraction into the `Change` schema | Lower (flagged) |

Spec and SDK diffs are deterministic and high-confidence. Changelog parsing is
LLM-assisted and carries a lower `confidence` — surfaced to the client, and
weighted more cautiously downstream.

### Pipeline

1. **Fetch** current spec + latest SDK metadata for the vendor.
2. **Snapshot** them, versioned, so there is always a previous to diff against.
3. **Diff** each source (oasdiff / version compare / changelog NLP).
4. **Normalize** every raw delta into a canonical `Change` record.
5. **Dedup & merge** — the same change often appears in both spec and changelog;
   merge into one record, keeping the highest-confidence evidence.
6. **Emit** to the change feed; fan out one job per subscribed repo.

### The `Change` record (the pivot of the whole system)

Everything downstream depends only on this shape, never on where it came from:

```ts
interface Change {
  id: string;                 // stable, dedup key
  vendor: string;             // "stripe"
  source: "spec" | "sdk" | "changelog";
  detectedAt: string;         // ISO
  kind: "breaking" | "deprecation" | "new_feature";
  target: {                   // what changed
    type: "endpoint" | "symbol";
    endpoint?: { method: string; path: string };
    symbol?: string;          // e.g. "stripe.charges.create"
    param?: string;
  };
  before?: string;            // old signature/shape
  after?: string;             // new signature/shape
  migration: {                // structured hint for matcher + fixer
    op: "rename" | "param_move" | "type_change" | "removed" | "replaced_by";
    detail?: string;
  };
  references: string[];       // changelog URL, spec diff, PR link
  confidence: "high" | "medium" | "low";
}
```

This is host- and vendor-agnostic on purpose: the matcher, fixer, and git layer
consume `Change` and know nothing about oasdiff or Stripe specifics.

---

## 3. How we interact with git (PR/MR)

### Abstract the host from day 1

Never bake GitHub in. A single interface, multiple implementations:

```ts
interface GitHost {
  checkout(repo: RepoRef, into: string): Promise<void>;   // shallow, read-only
  createBranch(name: string): Promise<void>;
  commit(message: string): Promise<void>;
  openChangeRequest(input: {                               // PR (GitHub) / MR (GitLab)
    branch: string;
    title: string;
    body: string;
    draft: boolean;
  }): Promise<{ url: string }>;
  findOpenChangeRequest(key: string): Promise<{ url: string } | null>;
}
```

MVP ships `GitHubHost` (Octokit). `GitLabHost` follows without touching the
engine. The engine only ever calls `GitHost`.

### The flow (hosted / Pro)

1. **Auth** — GitHub App installation token (short-lived, scoped per repo:
   `contents:write`, `pull_requests:write`). GitLab equivalent: project/group
   access token or OAuth app.
2. **Checkout** — shallow clone into an **ephemeral** workspace (tmpfs, wiped
   after the job).
3. **Branch** — `apidrift/<vendor>-<change-id>`.
4. **Apply fix** — output of stage 3 (deterministic rule or AI agent).
5. **Commit** — structured message referencing the `Change` and its changelog.
6. **Verify** — stage 4 runs the repo's original tests in the sandbox.
7. **Open request**:
   - tests green → open a normal PR/MR;
   - tests red → open a **draft** PR/MR annotated with the failure and the
     agent's reasoning.
8. **PR/MR body** (house format): what changed, why, changelog link, test
   results, and `confidence`.
9. **Cleanup** — destroy the workspace, let the token expire.

### Idempotency (so we never spam duplicate PRs)

Before opening, call `findOpenChangeRequest((repo, changeId))`. If one exists,
**update it** instead of opening a second. One `Change` × one repo = at most one
open request, ever.

### Auth & access per tier

| Tier | Where it runs | Token | Does client code leave their infra? |
|---|---|---|---|
| **Free (CLI)** | dev's machine | dev's own git creds | No |
| **Pro (Git App)** | our infra | GitHub App installation token / GitLab OAuth | Yes (ephemeral) |
| **Enterprise (runner)** | client CI | CI-provided token (`GITHUB_TOKEN`, `CI_JOB_TOKEN`) | **No** |

The self-hosted runner is the trust unlock: the engine runs inside the client's
pipeline, consuming only `Change` metadata from us. Their code never reaches our
servers.

### Security invariants (all tiers where we execute)

- One isolated, ephemeral sandbox per job; destroyed after.
- Network egress restricted to what the job needs.
- Least-privilege, short-TTL tokens.
- Client code never persisted; logs scrubbed of code and secrets.
- Fix sandbox has no access to the repo's secrets.

---

## Module map (ties to the repo layout)

| Stage | Module | Deterministic? |
|---|---|---|
| Poll + diff | `src/changes/` (+ upstream scheduler) | Yes |
| Match | `src/matcher/` (ast-grep) | Yes |
| Fix | `src/fixer/` (rule tier + AI agent tier) | AI in tier 2 |
| Verify | `src/verifier/` (sandbox test runner) | Yes |
| Git | `src/github/` → generalize to `src/githost/` | Yes |
| Orchestrate | `src/cli.ts` | Yes |
