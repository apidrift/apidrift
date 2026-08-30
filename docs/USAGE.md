# How users use APIdrift

One engine, three entrypoints. The unit of interaction is always a **pull
request** — users review a diff and merge, exactly like Dependabot. What differs
per tier is effort and where the engine runs.

## Free — CLI  (`src/cli.ts`)

The dev runs it against a repo. Code never leaves their machine (workspace mode:
we operate on a temp copy and emit a branch + patch).

```bash
npx @apidrift/cli run .            # or: npm run demo
# -> apidrift-out/PR.md + a .patch you can `git am`
```

Zero trust barrier — this is the top of funnel.

## Enterprise — self-hosted runner  (`src/runner.ts` + `action.yml`)

The engine runs INSIDE the client's CI, on their checkout. Their code never
leaves their runner; only the pulls.create call reaches GitHub. Integration is
**one file** in the consumer repo:

```yaml
# .github/workflows/apidrift.yml   (see examples/enterprise-workflow.yml)
on:
  schedule: [{ cron: '0 6 * * 1' }]
permissions: { contents: write, pull-requests: write }
jobs:
  apidrift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/apidrift@v1
```

## Pro — hosted Git App  (`src/service/`)

We host the engine. The client installs a GitHub App and picks repos; our
backend polls vendors and, per change, clones each subscribed repo with a
scoped installation token, runs the engine in-place, opens the PR, and deletes
the clone. `src/service/job.ts` (`runForRepo`) is the unit of work; `poller.ts`
is the upstream skeleton (queue/DB/webhooks are infra, not product logic).

## The gradient

| Tier | Effort | Trust asked | Engine runs |
|---|---|---|---|
| Free | dev runs CLI | none (local) | user's machine |
| Pro | install + pick repos | code visits us (ephemeral) | our infra |
| Enterprise | add 1 CI file | none (code stays) | client CI |
