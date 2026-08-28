/**
 * The AI fixer (tier 2): an agentic loop that migrates code for a Change that
 * has no deterministic codemod. This is the general mechanism of the product.
 *
 * Safety is enforced HERE, in the tool implementations, not in the prompt:
 *   - the agent may write ONLY files in the blast radius (the matched files);
 *   - it may NEVER write a test file;
 *   - writes outside the workspace are refused.
 * And regardless of what the agent does, the pipeline's verifier is the final
 * gate: a fix that fails the repo's tests is opened as a draft, never merged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { verify } from '../verifier/index.js';
import type { Change } from '../types.js';
import type { ContentBlock, Llm, LlmMessage, LlmToolDef } from './llm.js';

const TEST_RE = /(\.test\.|\.spec\.|\/tests?\/|__tests__)/;

export interface AgentConfig {
  workspaceDir: string;
  /** Absolute paths the agent is allowed to edit (the blast radius). */
  editableFiles: string[];
  maxIterations?: number;
  maxTokens?: number;
}

const TOOLS: LlmToolDef[] = [
  {
    name: 'read_file',
    description: 'Read a file from the repository.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'write_file',
    description: 'Overwrite an editable source file with new content.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_tests',
    description: "Run the repository's own test suite and see if it passes.",
    input_schema: { type: 'object', properties: {} },
  },
];

function within(workspaceDir: string, p: string): string | null {
  const abs = path.resolve(workspaceDir, p);
  const root = path.resolve(workspaceDir);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

export interface AgentResult {
  wrote: boolean;
  iterations: number;
}

export async function runAgent(llm: Llm, change: Change, cfg: AgentConfig): Promise<AgentResult> {
  const workspaceDir = cfg.workspaceDir;
  const editable = new Set(cfg.editableFiles.map((f) => path.resolve(f)));
  const maxIterations = cfg.maxIterations ?? 6;
  const maxTokens = cfg.maxTokens ?? 4096;
  let wrote = false;

  const system = [
    "You are APIdrift's code-fixing agent.",
    'A third-party API you depend on changed. Migrate the code to the new API.',
    'Rules (enforced): edit ONLY the files listed as editable; NEVER edit tests;',
    'preserve behavior; make the smallest change that passes the tests.',
    'Use write_file to save edits, then run_tests. When tests pass, stop.',
  ].join(' ');

  const fileList = cfg.editableFiles
    .map((f) => {
      const rel = path.relative(workspaceDir, f);
      const body = fs.readFileSync(f, 'utf8');
      return `--- editable: ${rel} ---\n${body}`;
    })
    .join('\n\n');

  const intro =
    `Change: ${change.title}\n` +
    `Vendor: ${change.vendor}\n` +
    `Symbol: ${change.target.symbol}\n` +
    `Migration: ${change.migration.detail}\n` +
    `Reference: ${change.references[0] ?? 'n/a'}\n\n` +
    `Editable files (you may write ONLY these):\n${fileList}`;

  const messages: LlmMessage[] = [{ role: 'user', content: intro }];

  const runTool = (name: string, input: Record<string, unknown>): { content: string; is_error?: boolean } => {
    if (name === 'read_file') {
      const abs = within(workspaceDir, String(input.path ?? ''));
      if (!abs) return { content: 'refused: path outside repository', is_error: true };
      if (!fs.existsSync(abs)) return { content: 'refused: no such file', is_error: true };
      return { content: fs.readFileSync(abs, 'utf8') };
    }
    if (name === 'write_file') {
      const abs = within(workspaceDir, String(input.path ?? ''));
      if (!abs) return { content: 'refused: path outside repository', is_error: true };
      if (TEST_RE.test(abs)) return { content: 'refused: tests are read-only', is_error: true };
      if (!editable.has(abs)) return { content: 'refused: file not in the editable set', is_error: true };
      fs.writeFileSync(abs, String(input.content ?? ''));
      wrote = true;
      return { content: 'ok: written' };
    }
    if (name === 'run_tests') {
      const r = verify(workspaceDir);
      return { content: `${r.passed ? 'PASS' : 'FAIL'}\n${r.output.split('\n').slice(-8).join('\n')}` };
    }
    return { content: `refused: unknown tool ${name}`, is_error: true };
  };

  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const res = await llm.createMessage({ system, messages, tools: TOOLS, max_tokens: maxTokens });
    messages.push({ role: 'assistant', content: res.content });

    const toolUses = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (toolUses.length === 0) break; // model is done

    const results: ContentBlock[] = toolUses.map((tu) => {
      const out = runTool(tu.name, tu.input);
      return { type: 'tool_result', tool_use_id: tu.id, content: out.content, is_error: out.is_error };
    });
    messages.push({ role: 'user', content: results });
  }

  return { wrote, iterations };
}
