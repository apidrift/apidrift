# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, use **[GitHub Security Advisories](https://github.com/apidrift/apidrift/security/advisories/new)**
for this repository — it opens a private channel with the maintainers.

Include, where relevant:

- the affected version(s) of `apidrift`,
- the tier involved (Free CLI, Enterprise runner, Pro service),
- reproduction steps or a proof of concept,
- what the fixer/verifier/git-host did that it should not have.

We'll acknowledge reports within 5 business days and aim to ship a fix or
mitigation before any public disclosure.

## Scope notes specific to APIdrift

Two properties are the core of this project's trust model — a report that
one of them fails is a **critical** severity report:

- **The verifier is the moat.** APIdrift must never open a non-draft PR when
  the target repo's own, unmodified test suite is red.
- **Tests are read-only to the fixer.** Neither the deterministic codemods
  nor the AI agent (`src/fixer/agent.ts`) should ever be able to modify a
  test file, in any tier.

## Supported versions

Only the latest published `0.x` release of the `apidrift` npm package is
supported with security fixes.
