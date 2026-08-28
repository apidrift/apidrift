import path from 'node:path';
import type { Project } from 'ts-morph';
import { runAgent } from './agent.js';
import type { Llm } from './llm.js';
import type { Codemod, Match } from '../types.js';

export interface FixInput {
  workspaceDir: string;
  project: Project;
  codemod: Codemod;
  matches: Match[];
  llm?: Llm;
}

export interface FixOutcome {
  method: 'deterministic' | 'ai';
  wrote: boolean;
}

/**
 * Produces the fix for a set of matches.
 *   - If the codemod ships a deterministic transform, use it (tier 1: fast, free).
 *   - Otherwise use the AI agent (tier 2: the general mechanism). Requires an LLM.
 * Either way, the pipeline's verifier decides whether the fix ships.
 */
export async function applyFix(input: FixInput): Promise<FixOutcome> {
  const { workspaceDir, project, codemod, matches, llm } = input;

  if (typeof codemod.apply === 'function') {
    const apply = codemod.apply.bind(codemod);
    const touched = new Set(matches.map((m) => m.filePath));
    for (const match of matches) apply(match);
    for (const filePath of touched) {
      const sf = project.getSourceFile(filePath);
      if (sf) sf.formatText({ indentSize: 2, convertTabsToSpaces: true });
    }
    project.saveSync();
    return { method: 'deterministic', wrote: true };
  }

  if (!llm) {
    throw new Error(
      `No deterministic codemod for "${codemod.change.id}" and no LLM configured. ` +
        'Set ANTHROPIC_API_KEY (or pass an Llm) to enable the AI fixer.',
    );
  }

  // Blast radius = the files that contain matched usages.
  const editableFiles = [...new Set(matches.map((m) => path.resolve(m.filePath)))];
  const result = await runAgent(llm, codemod.change, { workspaceDir, editableFiles });
  return { method: 'ai', wrote: result.wrote };
}
