import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ChangeRequestInput, ChangeRequestResult, GitHost } from './types.js';

/**
 * A GitHost with no credentials and no network. It creates a real git branch
 * and commit in a throwaway workspace, and "opens" the PR by writing the PR
 * body + a .patch to an output directory. This powers the Free CLI: the user's
 * real repo is never modified and their code never leaves their machine.
 */
export class LocalGitHost implements GitHost {
  private base = 'main';

  constructor(
    private readonly workspaceDir: string,
    private readonly outputDir: string,
  ) {}

  private git(args: string[]): string {
    const run = spawnSync('git', args, {
      cwd: this.workspaceDir,
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

  prepare(): void {
    this.git(['init', '-q', '-b', this.base]);
    this.git(['add', '-A']);
    this.git(['commit', '-q', '-m', 'baseline']);
  }

  createBranch(name: string): void {
    this.git(['checkout', '-q', '-b', name]);
  }

  commitAll(message: string): void {
    this.git(['add', '-A']);
    this.git(['commit', '-q', '-m', message]);
  }

  diff(): string {
    return this.git(['diff', this.base, '--', ':!package-lock.json']);
  }

  async publish(input: ChangeRequestInput): Promise<ChangeRequestResult> {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const patch = this.git(['format-patch', this.base, '--stdout']);
    const patchPath = path.join(this.outputDir, `${input.branch.replace(/\//g, '-')}.patch`);
    fs.writeFileSync(patchPath, patch + '\n');
    const prPath = path.join(this.outputDir, 'PR.md');
    fs.writeFileSync(prPath, input.body);
    return { url: prPath, draft: input.draft };
  }
}
