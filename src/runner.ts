#!/usr/bin/env node
/**
 * Enterprise entrypoint. Runs INSIDE the client's CI on an already-checked-out
 * repo. The client's code never leaves their runner; only the pulls.create call
 * reaches GitHub (which already hosts the code). Add via .github/workflows — see
 * examples/enterprise-workflow.yml.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { run } from './pipeline.js';
import { GitHubHost } from './githost/github.js';
import { resolveLlm } from './fixer/providers.js';

async function main() {
  const repoDir = process.env.GITHUB_WORKSPACE || process.cwd();

  const base =
    process.env.GITHUB_REF_NAME ||
    spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoDir, encoding: 'utf8' })
      .stdout.trim();

  const policy = (process.env.APIDRIFT_INFERENCE as any) || 'deterministic-only';
  const llm = await resolveLlm({ policy, model: process.env.APIDRIFT_MODEL,
    endpoint: process.env.APIDRIFT_ENDPOINT as any });

  const results = await run(repoDir, {
    mode: 'in-place',
    makeHost: (ws) => new GitHubHost({ repoDir: ws, base }),
    llm,
  });

  let opened = 0;
  for (const r of results) {
    if (!r.applied) continue;
    opened += 1;
    const state = r.draft ? 'DRAFT (tests failed)' : 'ready';
    console.log(`• ${r.change.title} — ${state}\n  ${r.prPath}`);
  }
  console.log(`apidrift: opened ${opened} pull request(s).`);

  // Expose an output for downstream workflow steps.
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `prs_opened=${opened}\n`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
