import type { Codemod } from '../types.js';
import { stripeChargesToIntents } from './stripe-charges-to-intents.js';

/**
 * The registry of known Codemods = the MVP's "change feed".
 * Add one entry per supported vendor change. Each ships with its Change record,
 * an AST matcher, a deterministic fix, and (in fixtures) a before/after case.
 */
export const codemods: Codemod[] = [stripeChargesToIntents];
