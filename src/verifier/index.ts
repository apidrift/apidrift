import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { VerifyResult } from '../types.js';

/**
 * Runs the target repo's OWN test suite, unmodified, inside the workspace.
 *
 * This is the moat: a fix only ships if the repo's existing tests still pass.
 * The tests are never edited by the fixer, so the check can't be gamed.
 */
export function verify(workspaceDir: string): VerifyResult {
  const pkgPath = path.join(workspaceDir, 'package.json');
  let command = 'npm test';

  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!pkg.scripts || !pkg.scripts.test) {
      return {
        passed: false,
        command: '(none)',
        output: 'No test script found in package.json — cannot verify. Refusing to ship.',
      };
    }
  }

  // Run in a clean environment. In particular, strip test-runner context vars
  // so a target repo that uses `node --test` reports its OWN exit code instead
  // of deferring to a parent runner (which would mask failures).
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true' };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;

  const run = spawnSync('npm', ['test', '--silent'], {
    cwd: workspaceDir,
    encoding: 'utf8',
    env,
  });

  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
  return { passed: run.status === 0, command, output };
}
