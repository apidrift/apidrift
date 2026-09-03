import path from 'node:path';
import { Node } from 'ts-morph';
import type { Node as TsMorphNode, Project } from 'ts-morph';
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

    // Blast radius only (CLAUDE.md): format the AST range each match actually
    // edited, never the whole file — see
    // .claude/agent-memory/architecte/decision_fixer_format_scope.md. Capture
    // a fallback formatting target for each match BEFORE apply() runs, since
    // a codemod (e.g. stripe-subscription-current-period-to-items) may
    // `replaceWithText` the matched node itself, forgetting it. The fallback
    // is the closest ancestor `Statement`, captured up front because ancestry
    // can change once earlier matches in the same file are applied.
    const fallbacks: Array<TsMorphNode | undefined> = matches.map((m) =>
      m.node.getFirstAncestor((a) => Node.isStatement(a)),
    );

    for (const match of matches) apply(match);

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const target = !match.node.wasForgotten() ? match.node : fallbacks[i];
      // No fallback survived either: format nothing for this match. Formatting
      // the whole file is not an acceptable fallback — that is the US-6 bug.
      if (target && !target.wasForgotten()) {
        target.formatText({ indentSize: 2, convertTabsToSpaces: true });
      }
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
