import type { CallExpression, Project } from 'ts-morph';

/**
 * The normalized description of one vendor API change.
 * Everything downstream depends on this shape, never on where it came from
 * (OpenAPI spec diff, SDK release, or changelog).
 */
export interface Change {
  id: string;
  vendor: string;
  source: 'spec' | 'sdk' | 'changelog';
  kind: 'breaking' | 'deprecation' | 'new_feature';
  title: string;
  target: {
    type: 'symbol' | 'endpoint';
    symbol?: string; // e.g. "stripe.charges.create"
  };
  migration: {
    op: 'rename' | 'param_move' | 'type_change' | 'removed' | 'replaced_by';
    detail?: string;
  };
  references: string[];
  confidence: 'high' | 'medium' | 'low';
}

/** One place in the codebase affected by a Change. */
export interface Match {
  filePath: string;
  line: number;
  snippet: string;
  node: CallExpression;
}

/**
 * A Codemod pairs a Change (data) with the deterministic logic to find and fix
 * it (code). This is the "tier 1" fixer. The future AI agent is the fallback
 * for changes that have no Codemod yet.
 */
export interface Codemod {
  change: Change;
  find(project: Project): Match[];
  /** Deterministic fix (tier 1). Optional: if absent, the AI agent handles it. */
  apply?(match: Match): void;
}

export interface VerifyResult {
  passed: boolean;
  command: string;
  output: string;
}

export interface PipelineResult {
  change: Change;
  matches: Match[];
  applied: boolean;
  verify: VerifyResult | null;
  branch: string;
  prPath: string | null;
  patchPath: string | null;
  draft: boolean;
  method?: 'deterministic' | 'ai';
}
