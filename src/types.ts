import type { Node, Project } from 'ts-morph';
// Type-only, so it is erased at compile time and creates no runtime cycle.
import type { PinnedApiVersion } from './matcher/api-version.js';

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
  /**
   * The vendor API version this change TAKES EFFECT FROM, verbatim as the
   * vendor writes it (`'2025-03-31.basil'`, `'2023-08-16'`).
   *
   * ABSENT means "not gated on an API version" — a product/SDK deprecation
   * whose source is a migration guide rather than a versioned changelog entry
   * (e.g. `stripe-charges-create-to-payment-intents`). The pipeline's
   * pinned-version guard then never fires. Absent is the default, and it is
   * what keeps every pre-US-7 change behaving exactly as before.
   *
   * When PRESENT, the pipeline refuses to apply the change to a repo it can
   * prove pins an OLDER API version (src/matcher/api-version.ts +
   * src/changes/api-version.ts) — the fix would otherwise migrate correct code
   * to a shape the vendor will never return to that account.
   */
  apiVersion?: string;
}

/**
 * One place in the codebase affected by a Change.
 *
 * `node` is the node the codemod's `apply()` rewrites — deliberately typed as
 * the generic `Node`, not `CallExpression`. Not every migration is anchored on
 * a call: `stripe-subscription-current-period-to-items` matches a
 * `PropertyAccessExpression` read off the *result* of a call. Each codemod
 * narrows with the `Node.isX()` guards before touching it.
 */
export interface Match {
  filePath: string;
  line: number;
  snippet: string;
  node: Node;
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
  /**
   * Set ONLY when the change matched real call sites but was deliberately not
   * applied. Optional by design: every existing consumer branches on
   * `applied`, so none of them break by ignoring this.
   *
   * `applied: false` alone is ambiguous (no match / no LLM / guardrail refusal
   * / this). Callers that want to tell a user "we found N sites and chose not
   * to touch them" need this field — see src/cli.ts, which prints it. A skip
   * nobody sees reads as "0 pull requests", i.e. "your code is fine".
   */
  skipped?: {
    reason: 'pinned-api-version';
    /** The version compared against: the OLDEST of `pinnedVersions`. */
    pinnedVersion: string;
    /** `change.apiVersion` — the version the change takes effect from. */
    changeApiVersion: string;
    /**
     * EVERY pinned version found, with workspace-relative `file:line`. Two
     * clients pinned differently are both reported: we cannot know which call
     * site belongs to which client, so a human must see both.
     */
    pinnedVersions: Array<{ version: string; filePath: string; line: number }>;
    /**
     * WHERE the pin came from (US-9). A human must be able to tell "you wrote
     * this pin" from "the stripe package you installed imposes it" — the
     * remedy is completely different, and for the implicit one the version
     * appears nowhere in their own code.
     */
    source: 'ast-client-option' | 'installed-sdk-default';
    /** The installed SDK version, when the pin came from it. */
    sdkVersion?: string;
  };
  /**
   * What the pinned-version guard established, for a version-gated change
   * (US-9). Carried so the CLI can disclose it on APPLIED changes too: "we
   * could not look at your installed SDK" and "we looked and there is no pin"
   * must never print as the same thing.
   *
   * Absent for changes with no `apiVersion` — those never reach the guard.
   */
  pinnedApiVersion?: PinnedApiVersion;
}
