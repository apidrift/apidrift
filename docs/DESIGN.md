# APIdrift — Product & Infrastructure Design

The serious version. What we sell, how it's built, how it's deployed, and why it
holds up in an enterprise procurement review. A visual companion to this doc
exists (design dossier). Grounded in a working engine, not slideware.

## 1. Positioning

APIdrift is the **verified-migration layer for third-party APIs**. It detects a
vendor change, writes the fix, proves it against the customer's own tests, and
opens a pull request. The product is **not the LLM** — the LLM is one component.
The product is the system that makes an API migration *trustworthy*: detection,
precise location, a fix, verification, and a clean PR, deployable on the
customer's terms.

Two grounded forces make this urgent:
- **APIs drift and blast radius compounds** — composite uptime is the product of
  every dependency's SLA, and vendors (AI providers especially) keep moving.
- **AI made writing changes cheap and trusting them expensive** — teams now
  spend 26–50% of dev capacity verifying machine-written code ("reliability
  tax"). Verification, not generation, is the missing piece. APIdrift's contract
  is verified-by-your-own-tests change.

## 2. What the product actually is — three artifacts

1. **Codemod Library (the moat).** A curated, versioned, **signed** catalog of
   vendor changes and their fixes. Deterministic where possible; AI-authored
   fixes get promoted into it (learning loop). Ships as a signed package + OCI
   image, updated continuously. This is the IP a customer can't reproduce alone.
2. **The Engine (open core).** Match (AST) → fix → verify against your tests →
   open PR. Host-agnostic and inference-agnostic. Ships as npm (`npx @apidrift/cli`),
   Docker, and a GitHub Action / GitLab component. This is the current repo.
3. **Control Plane (the service).** Vendor watchers, diff engine, change feed,
   entitlements, metering, dashboard. **Holds metadata only — never code.**
   Multi-tenant SaaS, self-hostable for air-gapped.

## 3. The spine: control plane / data plane

The standard shape of serious enterprise dev-tools: separate the layer that
decides *what to do* from the layer that *touches code*.

- **Control plane (always ours):** detection, curation, fan-out, metering,
  dashboard. Sees only metadata ("repo X depends on change Y", "PR opened").
- **Data plane (runs where the customer chooses):** the only place code is read.
  Ephemeral checkout → match → fix → verify → PR.

Only metadata crosses between them. Customer source code never enters the
control plane. This one property is what lets the same engine serve a solo dev
and a bank.

## 4. The three plans (trust boundaries)

| Plan | Boundary (where the data plane runs) | Inference | Code leaves? | For |
|---|---|---|---|---|
| **Free** | your machine (CLI) | **BYOT** (your token) or deterministic-only | no | solo / OSS |
| **Cloud** | our ephemeral micro-VM (Firecracker) | **managed** gateway, org token, billed in plan | visits, then wiped | teams |
| **Enterprise** | your VPC / CI (self-hosted runner) | **BYO-endpoint** (Bedrock/Vertex/Azure/self-hosted) or deterministic-only | no | regulated |

Same experience everywhere: a PR to review. Gradient: effort falls
Enterprise→Cloud; trust required rises Enterprise→Cloud. Free is the on-ramp.
The buyer never trades sovereignty for the product — they pick the boundary that
fits their compliance regime.

**Why BYOT only at Free:** a self-serve solo dev holding their own token is fine.
An enterprise will not manage a per-team LLM key, wear unbounded token cost, or
accept "we send your code to a third-party model." So Cloud hides inference
behind an org token (our COGS), and Enterprise runs inference on the customer's
own model endpoint. BYOK's four problems (ops burden, unpredictable cost,
"wrapper" perception, code confidentiality) are each dissolved this way.

## 5. Process, end to end

Control plane: (1) **Detect** — diff vendor spec/SDK; (2) **Curate** — tested,
signed library entry; (3) **Fan out** — metadata job per affected repo.
Data plane: (4) **Match** (AST/blast radius); (5) **Fix** (deterministic codemod,
else AI agent confined to blast radius); (6) **Verify** (repo's own unmodified
tests — red ⇒ draft); (7) **Open PR** (explained diff + results; human merges);
back to control plane: (8) **Report** (metadata → dashboard, metering, learning
loop).

## 6. Trust & security (answered by construction)

- **Residency** — data plane runs where chosen; Enterprise code never leaves.
- **No training / no retention** — deterministic path touches no model; managed
  inference is zero-retention; sandboxes wiped.
- **Model & key control** — BYO-endpoint or deterministic-only; no key for the
  customer to hold.
- **Least privilege** — fixer edits only blast-radius files; CI config, secrets,
  lockfiles, and **tests** are off-limits, enforced in code.
- **Human-in-the-loop** — output is always a PR; a red suite blocks the non-draft.
- **Auditability & supply chain** — full read/change/propose log; the codemod
  library is **signed and verified** before it can edit code.
- **Compliance roadmap** — SOC 2 Type II → ISO 27001 → GDPR/HIPAA scoping.

## 7. Distribution & supply chain

Library produced continuously (detection + engineers + AI, tested on fixtures,
learning loop promotes recurring AI fixes to deterministic). Distributed as
signed, pinned versions; enterprises mirror it into their own registry (no live
dependency on us to run). Every fix references the exact library version that
produced it — reproducible and auditable.

## 8. Pricing

On outcomes, **never on tokens** (token pricing commoditises and scares buyers;
inference is COGS absorbed into the plan). Free = $0 BYOT. Cloud = per repo /
integration, monthly, managed inference included. Enterprise = platform fee +
seats, annual, self-hosted / BYO-endpoint / deterministic-only.

## 9. Roadmap

1. ✅ Engine + verification gate (shipped, this repo).
2. ✅ Three deployment seams: CLI / runner+Action / service job (shipped).
3. Automated detection (watchers + spec/SDK diff → signed library).
4. Control plane + managed inference gateway (org token, metering, dashboard).
5. BYO-endpoint adapters (Bedrock/Vertex/Azure) + library signing/verification.
5b. ✅ Pluggable inference (policy + providers) — shipped.
6. Compliance: SOC 2 Type II, then ISO 27001 / regional scoping.

## 10. How the current repo maps to this

- `src/changes/` → seed of the **Codemod Library**.
- `src/matcher` `src/fixer` `src/verifier` `src/githost` `src/pipeline` → the **Engine** (data plane).
- `src/fixer/llm.ts` + `src/fixer/providers.ts` + `src/config.ts` → the inference seam, **implemented**: policy `deterministic-only | byot | managed | byo-endpoint`; Bedrock/Vertex via lazy optional deps.
- `src/service/` → seed of **Cloud**; `poller.ts` outlines the **Control Plane**.
- `src/runner.ts` + `action.yml` → **Enterprise** data plane.
- Not yet built: control-plane services, detection, library signing, BYO-endpoint adapters (see §9).
