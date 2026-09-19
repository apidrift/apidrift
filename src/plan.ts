/**
 * The read-only PLAN pass — what will actually run, what will only be
 * reported, and the BYOT cost cap that stands between them and the model
 * (US-13, module B / D3).
 *
 * ## Why here and not in `src/pipeline.ts`
 * `applyFix()` is the ONLY caller of the `Llm`, and it lives inside `run()`.
 * A gate placed before `run()` is therefore structurally before any token can
 * be spent — no ordering to respect, no flag to thread through the pipeline,
 * and `src/pipeline.ts` keeps exactly the plumbing US-14 AC4 asks it to keep.
 * The existing seam (`RunOptions.codemods`) is enough.
 *
 * ## Why the cap counts MATCHES, not detections
 * A walk over a real version range detects tens of changes; typically one or
 * two of them touch the repo at all. A cap on DETECTED changes would fire on
 * the first release, every run, and be disarmed by reflex — which is a cap
 * that does nothing but train its user to ignore it. The number that predicts
 * cost is the number of changes with at least one call site.
 *
 * Beneficial side effect, and not a small one: `run()` makes a full recursive
 * copy of the target repo PER codemod (`makeWorkspace`, src/pipeline.ts). With
 * 28 candidates that is 28 copies of the user's repo for, typically, one or
 * two matches. Filtering here brings it back to one or two.
 *
 * ## The trap this module must not open
 * Dropping zero-match candidates removes them from the one code path that
 * emits `PipelineResult.warning: 'vendor-present-no-match'` (commit 78dbfe2),
 * the guard that keeps "the matcher does not recognize this repo's shape" from
 * reading as "nothing to do". So the pass calls the pipeline's OWN
 * `noMatchWarning` on the candidates it discards — same function, same
 * `Project`, one implementation.
 *
 * ## Cost of the double pass
 * `find()` runs twice for a surviving candidate (here, then in the pipeline).
 * That is AST work on an already-loaded `Project` — no tokens, no network —
 * against 26 repo copies avoided and zero tokens wasted. Accepted, on purpose.
 *
 * AST, never regex (CLAUDE.md): counting goes through `findMatches` /
 * `genericSymbolCodemod`, never a textual search of the target's source.
 */
import { findMatches, loadProject } from './matcher/index.js';
import { noMatchWarning, run, type RunOptions } from './pipeline.js';
import type { DetectedChange } from './detection/stripe-changelog.js';
import type { Change, Codemod, Match, PipelineResult } from './types.js';

/**
 * N = 5 matched changes. Not calibrated on the 28 forme #1 changes the
 * reference walk produced — that is ONE walk from ONE bound; it is a
 * "something unusual is happening, look at it" threshold, and both escape
 * hatches move it.
 */
export const DEFAULT_MAX_CHANGES = 5;

export interface PlannedChange {
  codemod: Codemod;
  /** The call sites found, read-only — nothing here edits anything. Its length is what the cap counts and what the blocked listing prints. */
  matches: Match[];
}

export interface PlanWarning {
  change: Change;
  warning: NonNullable<PipelineResult['warning']>;
}

export interface ChangePlan {
  /** Candidates with at least one call site, input order — hand straight to `RunOptions.codemods`. */
  matched: PlannedChange[];
  /** Candidates dropped for zero matches that must still be said out loud (78dbfe2). */
  warnings: PlanWarning[];
  /** Every candidate dropped for zero matches, warned about or not — the count a summary needs so filtering does not shrink "checked N changes". */
  discarded: Change[];
  /** The threshold in force for this plan. */
  cap: number;
  /** `matched.length > cap` and no explicit confirmation. FAIL-CLOSED: never a "yes" assumed. */
  blocked: boolean;
}

export interface PlanOptions {
  /** `--max-changes <n>`: raises OR lowers the threshold. Integer > 0; there is no "unlimited" value. */
  maxChanges?: number;
  /** `--yes` / `-y`: confirms without any prompt. */
  yes?: boolean;
}

/**
 * Counts, in READ-ONLY, which candidates actually touch this repo — and
 * decides whether that is more than the user agreed to pay for.
 *
 * The `Project` is loaded ONCE for all candidates, exactly like the guard in
 * `src/pipeline.ts` does per codemod.
 */
export function planChanges(targetDir: string, candidates: Codemod[], opts: PlanOptions = {}): ChangePlan {
  const cap = opts.maxChanges ?? DEFAULT_MAX_CHANGES;
  // Nothing to plan (detection off): do not pay for an AST load to say so.
  if (candidates.length === 0) return { matched: [], warnings: [], discarded: [], cap, blocked: false };

  const project = loadProject(targetDir);

  const matched: PlannedChange[] = [];
  const warnings: PlanWarning[] = [];
  const discarded: Change[] = [];

  for (const codemod of candidates) {
    const matches = findMatches(project, codemod);
    if (matches.length > 0) {
      matched.push({ codemod, matches });
      continue;
    }
    discarded.push(codemod.change);
    const warning = noMatchWarning(codemod, project);
    if (warning) warnings.push({ change: codemod.change, warning });
  }

  return { matched, warnings, discarded, cap, blocked: !opts.yes && matched.length > cap };
}

/**
 * One line per change the cap is refusing to run: id, symbol, the release it
 * came from, and how many call sites it touches. This is the MINIMUM AC8
 * demands — enough for a reader to judge whether to re-run with `--yes` or to
 * lower the range. The surrounding sentence belongs to the call site.
 */
export function capBreachLines(plan: ChangePlan): string[] {
  return plan.matched.map(({ codemod, matches }) => {
    const { change } = codemod;
    const from = change.apiVersion ? ` (from ${change.apiVersion})` : '';
    const sites = `${matches.length} site${matches.length === 1 ? '' : 's'}`;
    return `${change.id}: ${change.target.symbol ?? change.target.type}${from} — ${sites}`;
  });
}

/**
 * Parses `--max-changes <n>`. An integer STRICTLY greater than zero, and
 * nothing else: no `0`, no negative, no `unlimited`. Someone who wants to run
 * everything types a number, which stays readable in a shell history or a CI
 * log — the whole point of the non-interactive design (D3).
 *
 * Throws on a bad value rather than falling back to the default: silently
 * ignoring `--max-changes 0` would be a cap the user believes they set.
 */
export function parseMaxChanges(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--max-changes expects an integer greater than 0 (got ${JSON.stringify(raw)}); there is no "unlimited" value`);
  }
  return n;
}

/**
 * The minimum a forme #2 must be reported WITH (AC9): the release it comes
 * from and the page to open. These changes are response-shaped — the affected
 * node is a property read on a call's result, which `target.symbol` cannot
 * express — so no generic matcher can execute them and nothing here feeds them
 * into `RunOptions.codemods`. The exact wording of the message is US-16's
 * deliverable; this is the DATA it needs.
 */
export function reportOnlyEntries(
  reportOnly: DetectedChange[],
): { id: string; symbol: string; release: string; url: string; title: string }[] {
  return reportOnly.map((d) => ({
    id: d.change.id,
    symbol: d.change.target.symbol ?? d.change.target.type,
    release: d.change.apiVersion ?? '',
    url: d.url,
    title: d.change.title,
  }));
}

/**
 * Plan, then run what the plan allows — the function that makes the cap
 * STRUCTURAL instead of a rule every caller has to remember, the same way
 * `changesSinceBound` does for the lower bound.
 *
 * `results` is `null` if and only if the plan is blocked, and in that case
 * `run()` is never entered — so `applyFix()` is never reached, so no token is
 * spent and no artifact is written (asserted with a spy `Llm` in
 * tests/plan-cap.test.ts).
 */
export async function runPlanned(
  targetDir: string,
  candidates: Codemod[],
  options: Omit<RunOptions, 'codemods'> & PlanOptions & {
    /**
     * Codemods that bypass the plan entirely: the hardcoded registry. They
     * carry an `apply()`, so they cost no token and the cost cap has no
     * business counting them; and a 0-match hand-written codemod is its
     * ordinary, silent case, which is precisely what `noMatchWarning` refuses
     * to warn about. Running them unchanged is what keeps `--detect` ADDITIVE.
     */
    alwaysRun?: Codemod[];
  } = {},
): Promise<{ plan: ChangePlan; results: PipelineResult[] | null }> {
  const { maxChanges, yes, alwaysRun = [], ...runOptions } = options;
  const plan = planChanges(targetDir, candidates, { maxChanges, yes });
  if (plan.blocked) return { plan, results: null };
  return {
    plan,
    results: await run(targetDir, { ...runOptions, codemods: [...alwaysRun, ...plan.matched.map((m) => m.codemod)] }),
  };
}
