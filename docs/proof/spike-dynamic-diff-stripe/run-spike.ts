// PHASE-0 feasibility spike, run 2026-09-10. Kept here as a permanent record,
// not as a maintained product entry point (see README.md in this directory).
// To re-run: `ANTHROPIC_API_KEY=... npx tsx docs/proof/spike-dynamic-diff-stripe/run-spike.ts`
// from the repo root. Note: docs.stripe.com's changelog is live and moves —
// a re-run today will detect whatever is currently published, not necessarily
// the same release/patch captured in this directory's PR.md/fix.patch.
//
// Proves, on Stripe only: (resolved "before") -> live changelog fetch -> a
// dynamically-computed Change (no hardcoded library) -> the generic AST
// matcher -> the REAL tier-2 AI fixer -> the target repo's OWN unmodified
// tests as the gate. Exactly ONE live model call is made (one Change actually
// matches the tiny target repo; the other 4 auto-executable changes from this
// release find 0 matches and short-circuit before ever touching the LLM).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../../src/pipeline.js';
import { detectChanges, type Fetcher } from '../../../src/detection/index.js';
import { genericSymbolCodemod } from '../../../src/matcher/symbol.js';
import { AnthropicLLM } from '../../../src/fixer/llm.js';
import type { Change } from '../../../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const httpFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { 'Accept-Language': 'en-US' } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
};

async function main() {
  console.log('--- step 1: live fetch + parse the real Stripe changelog (docs.stripe.com/changelog.md) ---');
  const detection = await detectChanges({ fetcher: httpFetcher, release: '2026-08-26.preview' });
  console.log(`detected ${detection.all.length} Change(s) for release 2026-08-26.preview:`);
  for (const d of detection.all) {
    console.log(`  [${d.classification}] ${d.change.target.symbol}  autoExecutable=${d.autoExecutable}`);
  }

  const autoExecutable: Change[] = detection.autoExecutable;
  if (autoExecutable.length === 0) throw new Error('spike precondition failed: expected auto-executable changes');

  console.log('\n--- step 2: wrap each as a generic (no hand-written fix) Codemod ---');
  const codemods = autoExecutable.map((c) => genericSymbolCodemod(c));

  console.log('\n--- step 3: real tier-2 AI fixer (model: claude-haiku-4-5-20251001) + repo\'s own tests as the gate ---');
  const llm = new AnthropicLLM({ model: 'claude-haiku-4-5-20251001' });
  const targetDir = path.join(here, 'fixture-target-repo');
  const outputDir = path.join(here, 're-run-out');

  const results = await run(targetDir, { outputDir, mode: 'workspace', llm, codemods });

  console.log('\n--- results ---');
  for (const r of results) {
    if (r.matches.length === 0) continue; // the 4 changes this tiny repo has no call sites for
    console.log(`Change: ${r.change.title}`);
    console.log(`  symbol: ${r.change.target.symbol}`);
    console.log(`  matches: ${r.matches.length}`);
    console.log(`  applied: ${r.applied}  method: ${r.method}`);
    console.log(`  verify: ${r.verify ? (r.verify.passed ? 'PASS' : 'FAIL') : 'n/a'}`);
    console.log(`  draft: ${r.draft}`);
    console.log(`  patch: ${r.patchPath}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
