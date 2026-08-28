import { spawnSync } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import type { ChangeRequestInput, ChangeRequestResult, GitHost } from './types.js';

export interface GitHubHostConfig {
  /** Absolute path to a real git checkout (CI workspace, or a repo we cloned). */
  repoDir: string;
  /** "owner/repo". Falls back to $GITHUB_REPOSITORY, then the origin remote. */
  slug?: string;
  /** Auth token. Falls back to $APIDRIFT_TOKEN, $GH_TOKEN, $GITHUB_TOKEN. */
  token?: string;
  /** Base branch for the PR. Falls back to $GITHUB_REF_NAME, then current HEAD. */
  base?: string;
}

/**
 * Opens a real GitHub PR. Runs entirely where the repo already lives, so in the
 * Enterprise runner the client's code never leaves their CI — only the
 * pulls.create API call goes to GitHub, which already hosts the code.
 */
export class GitHubHost implements GitHost {
  private base: string;
  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly octokit: Octokit;

  constructor(private readonly cfg: GitHubHostConfig) {
    this.token =
      cfg.token ||
      process.env.APIDRIFT_TOKEN ||
      process.env.GH_TOKEN ||
      process.env.GITHUB_TOKEN ||
      '';
    if (!this.token) throw new Error('GitHubHost: no token (set APIDRIFT_TOKEN or GITHUB_TOKEN)');

    const slug = cfg.slug || process.env.GITHUB_REPOSITORY || this.slugFromRemote();
    const [owner, repo] = slug.split('/');
    if (!owner || !repo) throw new Error(`GitHubHost: cannot resolve owner/repo from "${slug}"`);
    this.owner = owner;
    this.repo = repo.replace(/\.git$/, '');
    this.base = cfg.base || process.env.GITHUB_REF_NAME || '';
    this.octokit = new Octokit({ auth: this.token });
  }

  private git(args: string[]): string {
    const run = spawnSync('git', args, {
      cwd: this.cfg.repoDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'apidrift[bot]',
        GIT_AUTHOR_EMAIL: 'bot@apidrift.dev',
        GIT_COMMITTER_NAME: 'apidrift[bot]',
        GIT_COMMITTER_EMAIL: 'bot@apidrift.dev',
      },
    });
    if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${run.stderr}`);
    return (run.stdout ?? '').trim();
  }

  private slugFromRemote(): string {
    const url = this.git(['remote', 'get-url', 'origin']);
    const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : '';
  }

  prepare(): void {
    if (!this.base) this.base = this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  createBranch(name: string): void {
    this.git(['checkout', '-q', '-B', name, this.base]);
  }

  commitAll(message: string): void {
    this.git(['add', '-A']);
    this.git(['commit', '-q', '-m', message]);
  }

  diff(): string {
    return this.git(['diff', this.base, '--', ':!package-lock.json']);
  }

  async publish(input: ChangeRequestInput): Promise<ChangeRequestResult> {
    // Authenticate the push without persisting the token in the checkout config.
    const authRemote = `https://x-access-token:${this.token}@github.com/${this.owner}/${this.repo}.git`;
    this.git(['push', authRemote, `HEAD:refs/heads/${input.branch}`, '--force']);

    // Idempotency: reuse an open PR for this branch instead of duplicating.
    const existing = await this.octokit.pulls.list({
      owner: this.owner,
      repo: this.repo,
      head: `${this.owner}:${input.branch}`,
      state: 'open',
    });
    if (existing.data.length > 0) {
      const pr = existing.data[0];
      await this.octokit.pulls.update({
        owner: this.owner,
        repo: this.repo,
        pull_number: pr.number,
        title: input.title,
        body: input.body,
      });
      return { url: pr.html_url, draft: input.draft };
    }

    const created = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      head: input.branch,
      base: this.base,
      title: input.title,
      body: input.body,
      draft: input.draft,
    });
    return { url: created.data.html_url, draft: input.draft };
  }
}
