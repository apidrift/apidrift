import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codemods as defaultCodemods } from './changes/index.js';
import { findMatches, loadProject } from './matcher/index.js';
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
    filter: (src) => !src.includes('node_modules') && !src.includes('/.git'),
  });
  return ws;
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

  const project = loadProject(workspace);
  const matches = findMatches(project, codemod);
  if (matches.length === 0) { cleanup(); return empty; }

  // An AI-only change (no deterministic codemod) needs an LLM. Without one, skip
  // it cleanly rather than failing the whole run.
  if (typeof codemod.apply !== 'function' && !opts.llm) {
    cleanup();
    return { ...empty, applied: false };
  }

  host.createBranch(branch);
  const outcome = await applyFix({ workspaceDir: workspace, project, codemod, matches, llm: opts.llm });

  const result = verify(workspace);

  const diff = host.diff();
  // If the fixer produced no actual change (e.g. a guardrail refused the edit),
  // there is nothing to commit or open.
  if (diff.trim() === '') {
    cleanup();
    return { ...empty, applied: false };
  }

  host.commitAll(codemod.change.title);
  const draft = !result.passed;
  const { title, body } = buildPrBody({
    change: codemod.change, matches, diff, verify: result, workspaceDir: workspace, draft,
  });
  const cr = await host.publish({ branch, title, body, draft });

  const displayMatches = matches.map((m) => ({ ...m, filePath: path.relative(workspace, m.filePath) }));
  cleanup();

  return {
    change: codemod.change, matches: displayMatches, applied: true,
    verify: result, branch, prPath: cr.url,
    patchPath: opts.mode === 'workspace'
      ? path.join(opts.outputDir, `${branch.replace(/\//g, '-')}.patch`) : null,
    draft, method: outcome.method,
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
