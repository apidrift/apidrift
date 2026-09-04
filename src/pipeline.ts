import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codemods as defaultCodemods } from './changes/index.js';
import { isPinnedBefore, oldestApiVersion } from './changes/api-version.js';
import { findMatches, loadProject } from './matcher/index.js';
import { resolvePinnedApiVersion, type PinnedApiVersion } from './matcher/api-version.js';
import { applyFix } from './fixer/index.js';
import { verify } from './verifier/index.js';
import { buildPrBody } from './pr.js';
import { LocalGitHost } from './githost/local.js';
import type { GitHost } from './githost/types.js';
import type { Llm } from './fixer/llm.js';
import type { Codemod, PipelineResult } from './types.js';

export interface RunOptions {
  outputDir?: string;
  mode?: 'workspace' | 'in-place';
  makeHost?: (workspaceDir: string, outputDir: string) => GitHost;
  /** The AI fixer. If absent, only changes with a deterministic codemod run. */
  llm?: Llm;
  /** Override the set of changes to run (defaults to the registry). */
  codemods?: Codemod[];
}

function makeWorkspace(targetDir: string): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-'));
  fs.cpSync(targetDir, ws, {
    recursive: true,
    // Exact path-segment match, not a substring test: a naive
    // `src.includes('/.git')` also matches `/.gitignore`, `/.github`,
    // `/.gitattributes`, etc. and silently drops them from the workspace —
    // losing .gitignore in particular means the LocalGitHost baseline commit
    // (`git add -A`) picks up build/coverage artifacts that were only ever
    // meant to stay untracked, which can blow up the later `git diff`.
    filter: (src) => {
      const segments = src.split(path.sep);
      return !segments.includes('node_modules') && !segments.includes('.git');
    },
  });
  return ws;
}

/**
 * The workspace copy deliberately excludes `node_modules` (see makeWorkspace),
 * so the verifier's `npm test` would otherwise fail on a real repo purely for
 * missing dependencies. Rather than `npm install` in the pipeline — which
 * would add network I/O and non-determinism the Free tier explicitly does not
 * promise — link the target's already-installed `node_modules` into the
 * workspace by symlink. Best-effort: if the clone has no `node_modules` (or
 * linking fails), the pipeline proceeds without it rather than crashing.
 *
 * Must run AFTER host.prepare() (which does the baseline `git init` + commit),
 * so the symlink is never part of that baseline commit. We also register it
 * in .git/info/exclude so LocalGitHost's `git add -A` / `git diff` never pick
 * it up — it's a link to code outside the workspace, not a real change.
 */
function linkNodeModules(targetDir: string, workspace: string): void {
  const src = path.join(targetDir, 'node_modules');
  if (!fs.existsSync(src)) return;

  const excludePath = path.join(workspace, '.git', 'info', 'exclude');
  try {
    const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
    if (!existing.split('\n').includes('node_modules')) {
      const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
      fs.appendFileSync(excludePath, `${sep}node_modules\n`);
    }
  } catch {
    // No .git/info yet (e.g. host.prepare() wasn't a git init) — nothing to exclude from.
  }

  try {
    fs.symlinkSync(src, path.join(workspace, 'node_modules'), 'dir');
  } catch {
    // Symlinking unsupported on this filesystem: degrade to running without deps.
  }
}

async function runCodemod(
  codemod: Codemod,
  targetDir: string,
  opts: Required<Pick<RunOptions, 'mode' | 'outputDir' | 'makeHost'>> & { llm?: Llm },
): Promise<PipelineResult> {
  const inPlace = opts.mode === 'in-place';
  const workspace = inPlace ? targetDir : makeWorkspace(targetDir);
  const host = opts.makeHost(workspace, opts.outputDir);
  const branch = `apidrift/${codemod.change.id}`;
  const cleanup = () => { if (!inPlace) fs.rmSync(workspace, { recursive: true, force: true }); };

  const empty: PipelineResult = {
    change: codemod.change, matches: [], applied: false,
    verify: null, branch, prPath: null, patchPath: null, draft: false,
  };

  host.prepare();
  if (!inPlace) linkNodeModules(targetDir, workspace);

  const project = loadProject(workspace);
  const matches = findMatches(project, codemod);
  if (matches.length === 0) { cleanup(); return empty; }

  const relativize = (list: typeof matches) =>
    list.map((m) => ({ ...m, filePath: path.relative(workspace, m.filePath) }));

  // ── US-7: the pinned-API-version guard ────────────────────────────────────
  // Runs AFTER find() on purpose. A repo with no matches must report "no
  // match" (the ordinary case), not "blocked" — "blocked" is only interesting
  // when there ARE call sites we are choosing to leave alone. And it runs
  // BEFORE createBranch(): a refusal here must produce no branch, no commit,
  // no artifact at all. A draft PR carrying a known-wrong fix invites someone
  // to merge it; the fail-safe is to ship nothing and say why.
  //
  // Only changes that carry an `apiVersion` are gated (see src/types.ts): a
  // product deprecation like charges -> paymentIntents is not tied to an API
  // version, so it never pays for this at all.
  //
  // US-9: the resolution root is the WORKSPACE, not the target directory.
  // linkNodeModules() above has already symlinked the target's node_modules in
  // (and in-place mode makes the two the same directory anyway), so there is
  // one root and no branch — and the reported path relativizes to
  // `node_modules/stripe/cjs/apiVersion.js` with no absolute leak.
  let pinned: PinnedApiVersion | undefined;
  if (codemod.change.apiVersion) {
    pinned = resolvePinnedApiVersion(project, codemod.change.vendor, workspace);
    if (pinned.status === 'pinned') {
      const oldest = oldestApiVersion(pinned.versions.map((v) => v.version));
      if (oldest && isPinnedBefore(oldest, codemod.change.apiVersion)) {
        const skipped = {
          reason: 'pinned-api-version' as const,
          pinnedVersion: oldest,
          changeApiVersion: codemod.change.apiVersion,
          pinnedVersions: pinned.versions.map((v) => ({
            ...v,
            filePath: path.relative(workspace, v.filePath),
          })),
          source: pinned.source,
          ...(pinned.source === 'installed-sdk-default' ? { sdkVersion: pinned.sdkVersion } : {}),
        };
        // Relativize the matches too — without this, throwaway
        // `/tmp/apidrift-xxxx` paths leak into the report and the CLI output.
        const displayMatches = relativize(matches);
        cleanup();
        // verify: null — nothing was edited, so running the suite would be
        // pure cost for an answer we already have.
        return { ...empty, matches: displayMatches, applied: false, skipped, pinnedApiVersion: pinned };
      }
    }
  }

  // An AI-only change (no deterministic codemod) needs an LLM. Without one, skip
  // it cleanly rather than failing the whole run.
  if (typeof codemod.apply !== 'function' && !opts.llm) {
    cleanup();
    return { ...empty, applied: false, pinnedApiVersion: pinned };
  }

  host.createBranch(branch);
  const outcome = await applyFix({ workspaceDir: workspace, project, codemod, matches, llm: opts.llm });

  const result = verify(workspace);

  const diff = host.diff();
  // If the fixer produced no actual change (e.g. a guardrail refused the edit),
  // there is nothing to commit or open.
  if (diff.trim() === '') {
    cleanup();
    return { ...empty, applied: false, pinnedApiVersion: pinned };
  }

  host.commitAll(codemod.change.title);
  const draft = !result.passed;
  const { title, body } = buildPrBody({
    change: codemod.change, matches, diff, verify: result, workspaceDir: workspace, draft,
    // Present only for a version-gated change (see the guard above). This is
    // the OTHER direction of "no silent regression": we applied the change, so
    // the PR must say what we could — or could not — establish about the
    // reader's pinned API version.
    pinnedApiVersion: pinned,
  });
  const cr = await host.publish({ branch, title, body, draft });

  const displayMatches = relativize(matches);
  cleanup();

  return {
    change: codemod.change, matches: displayMatches, applied: true,
    verify: result, branch, prPath: cr.url,
    patchPath: opts.mode === 'workspace'
      ? path.join(opts.outputDir, `${branch.replace(/\//g, '-')}.patch`) : null,
    draft, method: outcome.method,
    // Applied, but the reader still needs to know what we could — or could not
    // — establish about their API version (US-9, AC7).
    pinnedApiVersion: pinned,
  };
}

export async function run(targetDir: string, options: RunOptions = {}): Promise<PipelineResult[]> {
  const outputDir = path.resolve(options.outputDir ?? 'apidrift-out');
  const mode = options.mode ?? 'workspace';
  const makeHost = options.makeHost ?? ((ws: string, out: string) => new LocalGitHost(ws, out));
  const list = options.codemods ?? defaultCodemods;

  if (mode === 'workspace') fs.mkdirSync(outputDir, { recursive: true });

  const results: PipelineResult[] = [];
  for (const c of list) {
    results.push(await runCodemod(c, targetDir, { mode, outputDir, makeHost, llm: options.llm }));
  }
  return results;
}
