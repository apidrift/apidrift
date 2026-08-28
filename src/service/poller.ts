/**
 * Pro backend skeleton — the upstream half of the system.
 *
 * This is intentionally a thin outline: the queue, database, and GitHub App
 * webhooks are infra choices, not product logic. The product logic is already
 * in the engine (matcher/fixer/verifier) and in runForRepo below.
 *
 * Flow:
 *   1. cron: for each vendor, fetch the current OpenAPI spec + latest SDK release
 *   2. diff vs the stored snapshot (oasdiff / version compare) -> Change records
 *      (this replaces the hardcoded registry in src/changes)
 *   3. for each Change, fan out to every subscribed repo that depends on it
 *   4. enqueue a RepoJob per (Change x repo)
 *   5. a worker pulls jobs and calls runForRepo()
 */
import { runForRepo, type RepoJob } from './job.js';

export interface Subscription {
  slug: string;
  defaultBranch: string;
  installationId: number; // GitHub App installation -> mint a scoped token per job
}

// Placeholder: real impl mints a short-lived installation token via the App.
async function mintInstallationToken(_installationId: number): Promise<string> {
  throw new Error('TODO: mint a scoped installation token via the GitHub App');
}

export async function processSubscription(sub: Subscription): Promise<void> {
  const token = await mintInstallationToken(sub.installationId);
  const job: RepoJob = { slug: sub.slug, token, baseBranch: sub.defaultBranch };
  const results = await runForRepo(job);
  const opened = results.filter((r) => r.applied).length;
  console.log(`[apidrift] ${sub.slug}: opened ${opened} PR(s)`);
}
