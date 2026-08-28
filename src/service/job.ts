/**
 * Pro entrypoint (the unit of work our backend runs per subscribed repo).
 *
 * The service clones the repo with the installation token into a disposable
 * dir, then calls runForRepo. Same engine, same GitHubHost as Enterprise — the
 * only difference is WHO runs it (our infra vs the client's CI).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../pipeline.js';
import { GitHubHost } from '../githost/github.js';
import { resolveLlm } from '../fixer/providers.js';
import type { PipelineResult } from '../types.js';

export interface RepoJob {
  slug: string;        // "owner/repo"
  token: string;       // installation token, scoped + short-lived
  baseBranch: string;  // usually the repo's default branch
}

export async function runForRepo(job: RepoJob): Promise<PipelineResult[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-clone-'));
  try {
    const url = `https://x-access-token:${job.token}@github.com/${job.slug}.git`;
    const clone = spawnSync('git', ['clone', '--depth', '1', '-b', job.baseBranch, url, dir], {
      encoding: 'utf8',
    });
    if (clone.status !== 0) throw new Error(`clone failed: ${clone.stderr}`);

    const llm = await resolveLlm({ policy: (process.env.APIDRIFT_INFERENCE as any) || 'managed',
      model: process.env.APIDRIFT_MODEL });
    return await run(dir, {
      mode: 'in-place',
      makeHost: (ws) =>
        new GitHubHost({ repoDir: ws, slug: job.slug, token: job.token, base: job.baseBranch }),
      llm,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); // code never persisted
  }
}
