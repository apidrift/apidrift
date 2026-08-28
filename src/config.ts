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

export function resolveInference(flags: CliFlags, targetDir: string): InferenceConfig {
  const fromFile = readConfigFile(targetDir) ?? readConfigFile(process.cwd()) ?? {};

  let policy: InferencePolicy;
  if (flags.deterministicOnly) policy = 'deterministic-only';
  else if (flags.ai) policy = 'byot';
  else if (process.env.APIDRIFT_INFERENCE && POLICIES.includes(process.env.APIDRIFT_INFERENCE as InferencePolicy))
    policy = process.env.APIDRIFT_INFERENCE as InferencePolicy;
  else if (fromFile.policy) policy = fromFile.policy;
  else policy = process.env.ANTHROPIC_API_KEY ? 'byot' : 'deterministic-only';

  return { policy, model: flags.model ?? fromFile.model ?? process.env.APIDRIFT_MODEL };
}

export function describePolicy(cfg: InferenceConfig): string {
  switch (cfg.policy) {
    case 'deterministic-only': return 'deterministic-only (no model — codemod library only)';
    case 'byot': return 'BYOT (your ANTHROPIC_API_KEY)';
    case 'managed': return 'managed gateway';
    case 'byo-endpoint': return `BYO-endpoint (${cfg.endpoint ?? 'bedrock'})`;
  }
}
