export interface ChangeRequestInput {
  branch: string;
  title: string;
  body: string;
  draft: boolean;
}

export interface ChangeRequestResult {
  /** A PR/MR URL (GitHub, GitLab) or a local file path (LocalGitHost). */
  url: string;
  draft: boolean;
}

/**
 * Abstracts the git host so the ONE engine serves every tier:
 *   - Free      -> LocalGitHost (emits a branch + patch, code stays local)
 *   - Pro       -> GitHubHost, called by our service on a cloned repo
 *   - Enterprise-> GitHubHost, called by our runner inside the client's CI
 *
 * The pipeline only ever calls these methods; swapping tiers swaps the host.
 */
export interface GitHost {
  /** Establish the base to diff/PR against. Local inits a repo; GitHub captures HEAD. */
  prepare(): void;
  createBranch(name: string): void;
  commitAll(message: string): void;
  /** Unified diff of the fix vs the base, for the PR body. */
  diff(): string;
  /** "Open" the change request. Local writes a patch; GitHub pushes + opens a PR. */
  publish(input: ChangeRequestInput): Promise<ChangeRequestResult>;
}
