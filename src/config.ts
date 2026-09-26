/**
 * Resolves the inference policy for a run. Precedence: CLI flags > env >
 * apidrift.json (in the target repo, then cwd) > safe default.
 * Default: BYOT if ANTHROPIC_API_KEY is set, else deterministic-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { InferenceConfig, InferencePolicy } from './fixer/providers.js';

const POLICIES: InferencePolicy[] = ['deterministic-only', 'byot', 'managed', 'byo-endpoint'];

function readConfigFile(dir: string): Partial<InferenceConfig> | null {
  const p = path.join(dir, 'apidrift.json');
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const out: Partial<InferenceConfig> = {};
    if (raw.inference && POLICIES.includes(raw.inference)) out.policy = raw.inference;
    if (typeof raw.model === 'string') out.model = raw.model;
    return out;
  } catch {
    return null;
  }
}

export interface CliFlags {
  deterministicOnly?: boolean;
  ai?: boolean; // force BYOT
  model?: string;
}

/**
 * WHERE the policy came from — US-14, AC2bis.
 *
 * `'deterministic-only'` is returned by two radically different situations: a
 * user who ASKED for it (flag / `APIDRIFT_INFERENCE` / `apidrift.json`), and
 * the safe default of a machine that simply has no `ANTHROPIC_API_KEY`. The
 * first is APIdrift's offline mode — no network, no detection, exit 0. The
 * second is a run that still detects and LISTS what drifted (Vision B) and
 * exits 20. Branching on the policy VALUE alone cannot tell them apart, so the
 * provenance travels with it.
 *
 * Additive on purpose: the precedence below, the resolved values,
 * `describePolicy` and `resolveLlm` are all unchanged.
 */
export type InferenceSource = 'flag' | 'env' | 'file' | 'default';

export interface ResolvedInference extends InferenceConfig {
  source: InferenceSource;
}

export function resolveInference(flags: CliFlags, targetDir: string): ResolvedInference {
  const fromFile = readConfigFile(targetDir) ?? readConfigFile(process.cwd()) ?? {};

  let policy: InferencePolicy;
  let source: InferenceSource;
  if (flags.deterministicOnly) { policy = 'deterministic-only'; source = 'flag'; }
  else if (flags.ai) { policy = 'byot'; source = 'flag'; }
  else if (process.env.APIDRIFT_INFERENCE && POLICIES.includes(process.env.APIDRIFT_INFERENCE as InferencePolicy)) {
    policy = process.env.APIDRIFT_INFERENCE as InferencePolicy;
    source = 'env';
  } else if (fromFile.policy) { policy = fromFile.policy; source = 'file'; }
  else { policy = process.env.ANTHROPIC_API_KEY ? 'byot' : 'deterministic-only'; source = 'default'; }

  return { policy, source, model: flags.model ?? fromFile.model ?? process.env.APIDRIFT_MODEL };
}

/**
 * The offline contract, on all THREE channels (US-14, AC2bis — human decision
 * OPTION B, 2026-09-19): a CI that already wrote `{"inference":
 * "deterministic-only"}` into its `apidrift.json` must not start reaching the
 * network, nor go red, because APIdrift changed its default underneath it.
 *
 * `source: 'default'` is deliberately NOT offline: nothing was chosen there,
 * the key was just absent — that run detects and lists (Vision B).
 */
export function isExplicitOfflineChoice(cfg: ResolvedInference): boolean {
  return cfg.policy === 'deterministic-only' && cfg.source !== 'default';
}

/** How the offline mode was asked for — so the run can say which knob to release. */
export function describeInferenceSource(source: InferenceSource): string {
  switch (source) {
    case 'flag': return '--deterministic-only';
    case 'env': return 'APIDRIFT_INFERENCE=deterministic-only';
    case 'file': return '"inference": "deterministic-only" in apidrift.json';
    case 'default': return 'the default (no ANTHROPIC_API_KEY found)';
  }
}

export function describePolicy(cfg: InferenceConfig): string {
  switch (cfg.policy) {
    case 'deterministic-only': return 'deterministic-only (no model — codemod library only)';
    case 'byot': return 'BYOT (your ANTHROPIC_API_KEY)';
    case 'managed': return 'managed gateway';
    case 'byo-endpoint': return `BYO-endpoint (${cfg.endpoint ?? 'bedrock'})`;
  }
}
