/**
 * The Free CLI, as a FUNCTION — argv in, exit code out (US-14).
 *
 * ## Why this module exists at all
 * `src/cli.ts` calls `main()` at import time, so nothing in it was ever
 * reachable from a test except through `spawnSync`. That was tolerable while
 * the default path touched no network; it is not tolerable now that the
 * default path IS the changelog walk. AC11 ("zero network in the tests") and
 * AC3bis ("assert the NUMERIC exit code") together require a seam where a
 * fixture `Fetcher` can be injected and an exit code observed. So the logic
 * moved here, `src/cli.ts` became the four-line binary shim, and the injection
 * points are the two this codebase already uses everywhere else: `Fetcher`
 * (src/detection/index.ts) and `Llm` (src/fixer/llm.ts).
 *
 * ## The switch this module carries (US-14)
 * Before: the hardcoded registry ran, and detection existed only behind
 * `--detect --release <id>` — a release number the user had to know and type.
 * After: the dynamic diff, driven by the API version the repo is actually
 * pinned to, is the DEFAULT. Offline is now a CHOICE (`--deterministic-only`,
 * on any of its three channels), never a consequence of not having a key.
 *
 * ## One produced path, two destinations
 * There are deliberately NOT two rendering loops ("with a model" / "without").
 * The analysis is identical in both cases — resolve the pin, walk, then the
 * read-only `planChanges` pass. Exactly two things depend on whether a model
 * was resolved:
 *   1. whether the cost cap has any tokens to protect (AC14), and
 *   2. whether `plan.matched` is handed to `run()` or merely LISTED (AC2ter b
 *      — `run()` copies the whole repo per codemod, so feeding it N changes it
 *      is guaranteed to skip would cost N copies for nothing).
 * Everything printed below those two points is shared.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLlm as defaultResolveLlm } from './fixer/providers.js';
import type { Llm } from './fixer/llm.js';
import type { InferenceConfig } from './fixer/providers.js';
import {
  describeInferenceSource,
  describePolicy,
  isExplicitOfflineChoice,
  resolveInference,
  type CliFlags,
} from './config.js';
import { codemods as defaultCodemods } from './changes/index.js';
import { DEFAULT_CHANGELOG_INDEX_URL, httpFetcher, type Fetcher } from './detection/index.js';
import { vendorSourceFor } from './detection/stripe-source.js';
import { changesSinceBound } from './detection/bound.js';
import type { VendorDiff } from './detection/vendor-source.js';
import { loadProject } from './matcher/index.js';
import { genericSymbolCodemod } from './matcher/symbol.js';
import { apiVersionNote } from './pr.js';
import { cleanRunNote } from './cli-summary.js';
import {
  DEFAULT_MAX_CHANGES,
  capBreachLines,
  parseMaxChanges,
  planChanges,
  reportOnlyEntries,
  runPlanned,
  type ChangePlan,
} from './plan.js';
import type { Change, Codemod, PipelineResult } from './types.js';

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', amber: '\x1b[33m', blue: '\x1b[34m', red: '\x1b[31m',
};

/**
 * EXIT CODES (US-14, AC3bis) — the contract, in one place.
 *
 * `20` is a VERDICT, not an error: the run went all the way through, found
 * call sites that a vendor change affects, and produced no fix because no
 * model is configured. It exists because the alternative — exiting 0 — is the
 * false "nothing to do" this tool exists to prevent.
 *
 * Anything that STOPS the run (bad argument, unreachable or unreadable
 * changelog, `--offline`, an API version we cannot resolve) exits `1` and
 * always wins: a run that did not complete has no verdict to report. `20` and
 * the cost-cap refusal (also `1`) are mutually exclusive by construction — the
 * cap only applies when a model IS resolved, and `20` only happens when none
 * is.
 *
 * Why 20 and not something smaller: 0 and 1 are taken; 2 is bash's "builtin
 * misuse" and would invert the grep/diff convention (there 1 = results, 2 =
 * error — here 1 is ALREADY the error); 3..13 are Node's own documented
 * internal codes and a Node crash must stay distinguishable from a verdict;
 * 64..78 are the BSD sysexits; 126/127/128+N/255 belong to the shell. 20..29
 * is reserved for APIdrift verdicts of this kind.
 */
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_DRIFT_UNFIXED = 20;

function version(): string {
  try {
    const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version ?? '0.0.0';
  } catch { return '0.0.0'; }
}

export const HELP = `apidrift ${version()} — open tested PRs when a third-party API you depend on changes

USAGE
  apidrift run <path-to-repo> [options]

WHAT A RUN DOES (no flag required)
  apidrift reads the Stripe API version YOUR repo is pinned to — the one you
  wrote on your client, or the one the stripe package you installed imposes —
  walks the Stripe changelog from there up to the latest release on that line,
  and works on what it finds. You never type a release number: the repo says
  where to start. The built-in codemod registry runs on every run too; it
  costs no token and is never capped.

OPTIONS
  --deterministic-only   OFFLINE MODE. Built-in codemod registry only: no
                         network, no changelog walk, no model. Exits 0.
  --offline              Refuse to run at all rather than reach the network.
                         Exits 1 immediately — see the note below.
  --ai                   Enable the AI fixer via your ANTHROPIC_API_KEY (BYOT).
  --model <id>           Override the model (BYOT/managed).
  --since <api-version>  Override the lower bound of the walk, e.g.
                         --since 2025-03-31.basil. Use it when apidrift cannot
                         resolve the version your integration runs on.
  --out <dir>            Where to write the PR bodies and patches, one pair per
                         change (apidrift-<change-id>.md / .patch, default: ./apidrift-out).
  --max-changes <n>      Raise or lower the cost cap (default: ${DEFAULT_MAX_CHANGES}). Integer > 0;
                         there is no "unlimited" value — type a number. Takes
                         effect only when a model is configured.
  -y, --yes              Confirm a run above the cost cap. No prompt, ever.
                         Accepted and inert when no model is configured.
  -h, --help             Show this help.
  -v, --version          Print version.

--offline IS NOT --deterministic-only
  Both mean "do not touch the network", and they are not the same answer.
  --deterministic-only RUNS: the built-in registry is applied, verified, and
  can still open a pull request — it exits 0. --offline STOPS: it refuses the
  run before any fetch and exits 1, so a pipeline that must never reach out
  fails loudly instead of quietly doing less. If what you wanted was "work,
  just without the network", that is --deterministic-only.

INFERENCE (Free tier)
  Default: BYOT if ANTHROPIC_API_KEY is set, otherwise no model at all.
  Your own code never leaves your machine in either mode. The changelog fetch
  reads the vendor's PUBLIC documentation and sends nothing of yours; the AI
  fixer, when you enable it, does send the affected source to your provider.

WITHOUT A MODEL
  apidrift still detects and LISTS every change that affects this repo, with
  its call sites, and exits ${EXIT_DRIFT_UNFIXED} — it will not tell you there is nothing to do
  when there is. Set ANTHROPIC_API_KEY and pass --ai to get the fix.

COST CAP (detected changes only)
  Detected changes are the ones that reach the model. Before any of them does,
  apidrift counts — read-only, no model involved — how many actually match code
  in your repo. Above ${DEFAULT_MAX_CHANGES}, it lists them and STOPS with a non-zero exit
  rather than assume a yes. There is no prompt, in a terminal or out of one:
  re-run with --yes, or with --max-changes <n>. Your confirmation then lives in
  your shell history or your CI log. The built-in registry is never capped —
  it costs no tokens.

EXIT CODES
  0   the run completed and nothing is left for you to do.
  1   the run STOPPED: bad argument, unreachable or unreadable changelog,
      --offline, or an API version that could not be resolved. No verdict.
  ${EXIT_DRIFT_UNFIXED}  drift detected: changes affect this repo and no fix was produced,
      because no model is configured. ${EXIT_DRIFT_UNFIXED}-29 is reserved for verdicts.

EXAMPLES
  apidrift run .
  ANTHROPIC_API_KEY=sk-ant-... apidrift run . --ai
  apidrift run ./service --deterministic-only
  apidrift run . --ai --since 2025-03-31.basil`;

/**
 * Flags that were removed in US-14 and the flag that replaces them. Passing a
 * retired flag must never be silently ignored — someone whose script says
 * `--detect --release 2026-08-26.preview` is asking for a behaviour that no
 * longer has a name, and ignoring it would run something else entirely under
 * the same command line.
 */
const RETIRED_FLAGS: Record<string, string> = {
  '--detect': 'the changelog walk is now the DEFAULT — drop --detect. To go back to the registry alone, pass --deterministic-only.',
  '--release': 'replaced by `--since <api-version>`, which sets the LOWER BOUND of the walk instead of selecting one release. Usually you need neither: the version your repo is pinned to is the bound.',
};

const VALUE_FLAGS = new Set(['--model', '--out', '--since', '--max-changes']);
const BOOL_FLAGS = new Set([
  '--deterministic-only', '--ai', '--offline', '--yes', '-y', '-h', '--help', '-v', '--version',
]);

type ParseResult =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string }
  | {
      kind: 'run';
      cmd?: string;
      target?: string;
      out?: string;
      since?: string;
      offline: boolean;
      maxChanges?: string;
      yes: boolean;
      flags: CliFlags;
    };

export function parse(argv: string[]): ParseResult {
  const args = argv.slice(2);
  if (args.includes('-h') || args.includes('--help') || args.length === 0) return { kind: 'help' };
  if (args.includes('-v') || args.includes('--version')) return { kind: 'version' };

  const cmd = args[0];
  const values = new Map<string, string>();
  const seen = new Set<string>();
  let target: string | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      if (target === undefined) target = arg;
      continue;
    }
    const retired = RETIRED_FLAGS[arg];
    if (retired) return { kind: 'error', message: `\`${arg}\` no longer exists: ${retired}` };
    if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        return { kind: 'error', message: `${arg} expects a value. Try --help.` };
      }
      values.set(arg, value);
      i += 1;
      continue;
    }
    if (!BOOL_FLAGS.has(arg)) {
      return { kind: 'error', message: `unknown option \`${arg}\`. Try --help for the full list.` };
    }
    seen.add(arg);
  }

  return {
    kind: 'run',
    cmd,
    target,
    out: values.get('--out'),
    since: values.get('--since'),
    maxChanges: values.get('--max-changes'),
    offline: seen.has('--offline'),
    yes: seen.has('--yes') || seen.has('-y'),
    flags: {
      deterministicOnly: seen.has('--deterministic-only'),
      ai: seen.has('--ai'),
      model: values.get('--model'),
    },
  };
}

/**
 * The two injection points of the CLI. Production passes neither, and gets the
 * real `httpFetcher` and the real policy-driven `resolveLlm`. Tests pass
 * fixture markdown and a stub `Llm` — which is how the whole default path is
 * covered without a single real request (AC11).
 */
export interface CliDeps {
  fetcher?: Fetcher;
  resolveLlm?: (cfg: InferenceConfig) => Promise<Llm | undefined>;
}

/** Strip a leak: `resolveCurrentApiVersion`/`findMatches` return ABSOLUTE paths by contract (US-11). */
const rel = (targetDir: string, filePath: string) => path.relative(targetDir, filePath) || filePath;

/**
 * Every path that reaches the terminal goes through here, unless it is already
 * relative to the target repo (`rel`). `path.resolve` gave us absolute paths to
 * work with; printing them puts the layout of the user's machine — `/home/<who>/…`,
 * a CI runner's `/tmp/…` — into logs and pasted bug reports (the US-11 leak).
 *
 * Inside the directory the user ran the command from: shown relative to it, the
 * way the README shows it (`./fixtures/acme-payments`). Outside it: only the
 * last segment, behind an ellipsis. A `../../../..` chain would not do — it is
 * still the shape of the machine, and it still CONTAINS the absolute path as a
 * substring, which is exactly what a grep for the leak looks for.
 */
const shown = (absPath: string) => {
  const r = path.relative(process.cwd(), absPath);
  if (r === '') return '.';
  if (r.startsWith('..') || path.isAbsolute(r)) return `…${path.sep}${path.basename(absPath)}`;
  return `.${path.sep}${r}`;
};

/**
 * ONE sentence per `WalkStatus`, and none of them renders as a silent green run
 * (AC7d). `fatal` is what separates "we looked and there is nothing" from "we
 * could not look, and saying nothing would be a lie".
 */
function walkVerdict(diff: VendorDiff, indexUrl: string): { fatal: boolean; lines: string[] } {
  switch (diff.status) {
    case 'behind':
      return {
        fatal: false,
        lines: [`walked ${diff.releases.length} release(s) on your line: after ${diff.from}, up to ${diff.to}`],
      };
    case 'up-to-date':
      return {
        fatal: false,
        lines: [`${diff.from} IS the latest release published on its line — the vendor has changed nothing since. Checked, not assumed.`],
      };
    case 'ahead-of-index':
      return {
        fatal: false,
        lines: [
          `${diff.from} is NEWER than anything this changelog publishes on its line (latest seen: ${diff.to}).`,
          `nothing was walked. Either the index is stale, or this bound is not one the vendor published — verify it before reading this run as "up to date".`,
        ],
      };
    case 'unreadable-bound':
      return {
        fatal: true,
        lines: [
          `\`${diff.from}\` cannot be ordered against the changelog: an API version reads \`<date>[.<channel>]\`, e.g. 2025-03-31.basil.`,
          `nothing was fetched. Fix the value you passed to --since.`,
        ],
      };
    case 'index-empty':
      return {
        fatal: true,
        lines: [
          `the changelog index at ${indexUrl} was read and parsed to ZERO release headings.`,
          `this is NOT a network failure — the document arrived. Its format is not one we recognize, so we cannot tell "nothing changed" from "we understood none of it". Please report it.`,
        ],
      };
    case 'line-not-published':
      return {
        fatal: true,
        lines: [
          `the changelog index at ${indexUrl} publishes no release at all on ${diff.from}'s line.`,
          `the index was read, so this is not a network failure — but a bound whose line does not exist cannot yield a trustworthy "nothing changed". Check the version, or pass --since.`,
        ],
      };
  }
}

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const fetcher = deps.fetcher ?? httpFetcher;
  const resolveLlmFn = deps.resolveLlm ?? defaultResolveLlm;
  const fail = (message: string) => { console.error(`${c.red}error:${c.reset} ${message}`); return EXIT_ERROR; };

  const p = parse(argv);
  if (p.kind === 'help') { console.log(HELP); return EXIT_OK; }
  if (p.kind === 'version') { console.log(version()); return EXIT_OK; }
  if (p.kind === 'error') return fail(p.message);

  if (p.cmd !== 'run' || !p.target) return fail('expected `apidrift run <path-to-repo>`. Try --help.');

  const targetDir = path.resolve(p.target);
  if (!fs.existsSync(targetDir)) return fail(`no such directory: ${shown(targetDir)}`);

  // AC7c — FAIL-CLOSE, unconditionally and before anything else could reach
  // out. `--offline` is not "do less": it is "if this run would need the
  // network, I want to hear about it".
  if (p.offline) {
    return fail(
      '--offline: this run needs the Stripe changelog and you asked for no network. Nothing was fetched.\n'
      + '       to work without the network, use --deterministic-only: it runs the built-in codemod registry, fixes what it can, and exits 0.',
    );
  }

  const outputDir = p.out ? path.resolve(p.out) : path.resolve('apidrift-out');
  const inference = resolveInference(p.flags, targetDir);

  // Validated BEFORE anything else happens: a malformed cap must never be
  // silently replaced by the default — that would be a cap the user believes
  // they set. No network has been touched at this point.
  let maxChanges: number | undefined;
  try {
    maxChanges = parseMaxChanges(p.maxChanges);
  } catch (err) {
    return fail((err as Error).message);
  }

  let llm: Llm | undefined;
  try {
    llm = await resolveLlmFn(inference);
  } catch (err) {
    return fail((err as Error).message);
  }

  console.log(`\n${c.blue}${c.bold}apidrift${c.reset} ${c.dim}v${version()}${c.reset}  scanning ${c.bold}${shown(targetDir)}${c.reset}`);
  console.log(`${c.dim}inference: ${describePolicy(inference)}${c.reset}\n`);

  // ── The default path: resolve the pin, then walk from it ────────────────────
  const offline = isExplicitOfflineChoice(inference);
  let detected: Codemod[] = [];
  // True when the walk's COVERAGE is holed (an unreadable changelog page, or a
  // bound ahead of the index): the clean-run note must then not be emitted.
  let coverageIncomplete = false;

  if (offline) {
    // AC2bis: the fallback is ANNOUNCED, never silent. Said on every run
    // concerned, and it names both what did not happen and how to get it.
    console.log(`${c.dim}offline mode (${describeInferenceSource(inference.source)}): the changelog walk did NOT run and nothing was fetched.${c.reset}`);
    console.log(`${c.dim}only the built-in codemod registry ran. To detect what Stripe changed since your pinned API version, drop it and re-run.${c.reset}`);
    // Fail loud (human decision 6): a flag the user typed must never be dropped
    // in silence. `--since` is a bound for a walk, and no walk runs here.
    if (p.since) {
      console.log(`${c.amber}⚠${c.reset}  ${c.dim}--since ${p.since} was IGNORED: it sets the lower bound of the changelog walk, and this mode does not walk. Drop --deterministic-only to use it.${c.reset}`);
    }
    console.log('');
  } else {
    const source = vendorSourceFor('stripe', { fetcher });
    const project = loadProject(targetDir);
    const pinned = source.resolveCurrentApiVersion(project, targetDir);

    let diff: VendorDiff;
    try {
      if (p.since) {
        // AC3: `--since` overrides the LOWER BOUND. The six sentences in
        // src/detection/bound.ts have been naming this flag since US-13; this
        // is where they stop being a promise.
        console.log(`${c.dim}walking from ${p.since} (--since overrides the version resolved from this repo)${c.reset}`);
        diff = await source.changesSince(p.since);
      } else {
        const walked = await changesSinceBound(source, pinned);
        if (walked.diff === null) {
          // Zero fetch by construction (`changesSinceBound`): there is nothing
          // to learn from 200 KB of changelog with nothing to compare it to.
          // Explicit error, never a green run and never a verdict — the run did
          // not happen (human decision 2, 2026-09-19).
          console.error(`\n${c.red}error:${c.reset} ${c.bold}could not establish the Stripe API version this repo runs on${c.reset}`);
          console.error(`  ${(walked.bound as { message: string }).message}`);
          if (pinned.status === 'pinned') {
            for (const v of pinned.versions) console.error(`  ${c.dim}${rel(targetDir, v.filePath)}:${v.line}${c.reset}`);
          }
          return EXIT_ERROR;
        }
        diff = walked.diff;
      }
    } catch (err) {
      // AC7a. Before this, the exception walked all the way up to a bare
      // `console.error(err)`: a stack trace, with absolute paths off the user's
      // machine in it (the US-11 leak). Offline, `fetch` throws
      // `TypeError: fetch failed`, which names no URL at all — so naming it is
      // this layer's job, not the fetcher's.
      return fail(
        `could not read the Stripe changelog at ${DEFAULT_CHANGELOG_INDEX_URL}\n`
        + `       cause: ${(err as Error).message}\n`
        + '       nothing was analysed. Check your network access to docs.stripe.com, or use --deterministic-only to run the built-in registry with no network at all.',
      );
    }

    const verdict = walkVerdict(diff, DEFAULT_CHANGELOG_INDEX_URL);
    if (verdict.fatal) {
      console.error(`\n${c.red}error:${c.reset} ${c.bold}${verdict.lines[0]}${c.reset}`);
      for (const line of verdict.lines.slice(1)) console.error(`  ${c.dim}${line}${c.reset}`);
      return EXIT_ERROR;
    }
    for (const line of verdict.lines) console.log(`${c.dim}${line}${c.reset}`);
    if (diff.status === 'ahead-of-index') coverageIncomplete = true;

    // A page we could not read is NOT "this release had nothing" (US-13,
    // AC4/AC5/AC10) — name it, with its URL, and say how many.
    if (diff.gaps.length > 0) {
      coverageIncomplete = true;
      console.log(`${c.amber}⚠${c.reset}  ${c.bold}${diff.gaps.length} page(s) could not be read${c.reset}`);
      for (const gap of diff.gaps) console.log(`  ${c.dim}${gap.url}\n    ${gap.reason}${c.reset}`);
    }

    // US-13, AC9: a response-shaped change never produces a branch, a patch or
    // a PR — it is not in `autoExecutable`, so it has no seam into the pipeline
    // at all. What it DOES get is a report naming its release and its page.
    const reportOnly = reportOnlyEntries(diff.reportOnly);
    if (reportOnly.length > 0) {
      console.log(`${c.amber}report-only${c.reset} ${c.dim}— ${reportOnly.length} response-shaped change(s): reported, never edited, no PR.${c.reset}`);
      for (const e of reportOnly) {
        console.log(`  ${c.dim}${e.symbol}  (from ${e.release})${c.reset}`);
        console.log(`    ${c.dim}${e.url}${c.reset}`);
      }
    }

    console.log(`${c.dim}detected: ${diff.autoExecutable.length} auto-executable change(s) in this range${c.reset}\n`);
    detected = diff.autoExecutable.map((change: Change) => genericSymbolCodemod(change));
  }

  // ── The one branch (AC14 / AC2ter b), then one shared rendering ─────────────
  // With a model: plan, cap, run. Without: plan (read-only) and LIST, while the
  // registry still runs — it is tier 1, it costs no token and no request, and
  // "Deterministic-first" does not stop applying because a key is missing.
  const capApplies = llm !== undefined;
  let plan: ChangePlan;
  let results: PipelineResult[];

  if (capApplies) {
    const planned = await runPlanned(targetDir, detected, {
      outputDir, mode: 'workspace', llm, maxChanges, yes: p.yes, alwaysRun: defaultCodemods,
    });
    if (!planned.results) {
      console.error(`\n${c.red}error:${c.reset} ${c.bold}${planned.plan.matched.length} detected change(s) match code in this repo${c.reset}, above the cap of ${planned.plan.cap}.`);
      console.error(`${c.dim}each one would be sent to the model. Nothing has been sent, and nothing has been written.${c.reset}\n`);
      for (const line of capBreachLines(planned.plan)) console.error(`  ${line}`);
      console.error(`\n${c.dim}re-run with ${c.reset}--yes${c.dim} to confirm, or ${c.reset}--max-changes <n>${c.dim} to set your own threshold.${c.reset}`);
      return EXIT_ERROR;
    }
    plan = planned.plan;
    results = planned.results;
  } else {
    // AC14: no model means no token is spendable (`applyFix` is the only caller
    // of the `Llm` and it lives inside `run()`), so the cap has nothing to
    // protect and must not fire — firing would replace the listing, which IS
    // this mode's deliverable, with a refusal, and train the user to type
    // --yes by reflex. `--yes` stays accepted and inert.
    plan = planChanges(targetDir, detected, { maxChanges, yes: true });
    const planned = await runPlanned(targetDir, [], {
      outputDir, mode: 'workspace', llm, alwaysRun: defaultCodemods,
    });
    results = planned.results!;
  }

  let opened = 0, skipped = 0, blocked = 0, warned = 0;

  // The anti-silence guard (78dbfe2) for the candidates the plan pass dropped
  // before the pipeline could ever see them — same predicate, same sentence.
  // It has to be printed in BOTH modes: the listing mode never enters run(),
  // which is the only other place this warning is emitted (AC8).
  for (const w of plan.warnings) {
    warned += 1;
    console.log(`${c.amber}⚠${c.reset}  ${c.bold}${w.change.title}${c.reset}`);
    console.log(`  ${c.amber}WARNING: change detected but no matching call site found for ${w.change.target.symbol}${c.reset}`);
    console.log(`  ${c.dim}this repo DOES construct a ${w.change.vendor} client somewhere — the usage pattern may not be one the matcher recognizes.${c.reset}`);
    console.log(`  ${c.dim}this is NOT a confirmed "not applicable" — verify manually before assuming there is nothing to fix.${c.reset}`);
    console.log('');
  }

  for (const r of results) {
    if (!r.applied) {
      // A change we matched and then deliberately did NOT apply has to be
      // said out loud. Silence here reads as "done — 0 pull requests", i.e.
      // "your code is clean", which is the exact opposite of the truth: we
      // found call sites and left them alone on purpose. No artifact is
      // written for this case either — a draft PR carrying a known-wrong fix
      // would just invite someone to merge it.
      // Anti-silence guard: a detection-fed change (no hand-written apply())
      // matched zero call sites in a repo that DOES construct this vendor's
      // client somewhere. Never let that read as an ordinary "nothing to do" —
      // it may mean the matcher just doesn't recognize this repo's
      // construction shape, which is a real gap, not a clean bill of health.
      if (r.warning?.reason === 'vendor-present-no-match') {
        warned += 1;
        console.log(`${c.amber}⚠${c.reset}  ${c.bold}${r.change.title}${c.reset}`);
        console.log(`  ${c.amber}WARNING: change detected but no matching call site found for ${r.change.target.symbol}${c.reset}`);
        console.log(`  ${c.dim}this repo DOES construct a ${r.change.vendor} client somewhere — the usage pattern may not be one the matcher recognizes.${c.reset}`);
        console.log(`  ${c.dim}this is NOT a confirmed "not applicable" — verify manually before assuming there is nothing to fix.${c.reset}`);
        console.log('');
        continue;
      }
      if (r.skipped?.reason === 'pinned-api-version') {
        blocked += 1;
        const s = r.skipped;
        // US-9: name the SOURCE of the pin. "You wrote this" and "the package
        // you installed imposes this" have different remedies, and in the
        // implicit case the blocking version appears nowhere in the user's own
        // code — printing it without saying where it came from reads as noise.
        const fromSdk = s.source === 'installed-sdk-default';
        console.log(`${c.amber}●${c.reset} ${c.bold}${r.change.title}${c.reset}`);
        console.log(`  ${c.amber}not applied — ${fromSdk
          ? `the installed ${r.change.vendor} SDK (v${s.sdkVersion}) pins an older Stripe API version`
          : 'this repo pins an older Stripe API version'}${c.reset}`);
        console.log(`  ${c.dim}change takes effect from:${c.reset} ${s.changeApiVersion}`);
        for (const v of s.pinnedVersions) {
          const label = fromSdk ? 'the installed SDK pins IMPLICITLY:' : 'this repo pins:';
          console.log(`  ${c.dim}${label}${c.reset} ${v.version}  ${c.dim}(${v.filePath}:${v.line})${c.reset}`);
        }
        console.log(`  ${c.dim}${r.matches.length} site${r.matches.length === 1 ? '' : 's'} found and left UNCHANGED:${c.reset}`);
        for (const m of r.matches) console.log(`    ${c.dim}${m.filePath}:${m.line}  ${m.snippet}${c.reset}`);
        console.log(`  ${c.dim}applying it would migrate code that is correct on ${s.pinnedVersion}. ${fromSdk
          ? `Upgrade the ${r.change.vendor} package (or set a newer apiVersion on your client)`
          : 'Upgrade your pinned API version'}`);
        console.log(`  first, then re-run apidrift.${c.reset}`);
        console.log('');
        continue;
      }
      const needsAi = !r.verify && r.matches.length === 0;
      if (!needsAi) skipped += 1;
      continue;
    }
    opened += 1;
    const passed = r.verify?.passed;
    const dot = passed ? `${c.green}●${c.reset}` : `${c.amber}●${c.reset}`;
    const verdict = passed ? `${c.green}tests passed${c.reset}` : `${c.amber}tests failed — draft${c.reset}`;
    console.log(`${dot} ${c.bold}${r.change.title}${c.reset}`);
    console.log(`  ${c.dim}vendor:${c.reset} ${r.change.vendor}  ${c.dim}confidence:${c.reset} ${r.change.confidence}  ${c.dim}via:${c.reset} ${r.method}`);
    console.log(`  ${c.dim}branch:${c.reset} ${c.blue}${r.branch}${c.reset}`);
    // US-9, AC7: applying is not the end of the story. When we could NOT check
    // the API version this repo really runs on (uninstalled clone, unreadable
    // package), the terminal must say so — silence here reads as "checked, all
    // good", which is the one thing we must never imply about something we did
    // not look at. Same sentence as the PR body, so the two never diverge.
    const note = apiVersionNote(r.change, r.pinnedApiVersion);
    if (note) console.log(`  ${c.dim}api version: takes effect from ${r.change.apiVersion} — ${note.replace(/`/g, '')}${c.reset}`);
    for (const m of r.matches) console.log(`    ${c.dim}${m.filePath}:${m.line}  ${m.snippet}${c.reset}`);
    console.log(`  ${verdict}`);
    console.log(`  ${c.dim}PR:${c.reset} ${r.prPath ? shown(r.prPath) : r.prPath}`);
    if (r.patchPath) console.log(`  ${c.dim}patch:${c.reset} ${shown(r.patchPath)}`);
    console.log('');
  }

  // ── Vision B: detected, matched, NOT fixed — and said so (AC2ter) ───────────
  const listed = capApplies ? 0 : plan.matched.length;
  if (listed > 0) {
    // Counted as `skipped`, which is what inhibits the clean-run note
    // (src/cli-summary.ts): printing "no known API change affects this repo"
    // next to a list of changes that do is the one outcome AC2ter(f) forbids.
    skipped += listed;
    console.log(`${c.amber}●${c.reset} ${c.bold}${listed} detected change(s) affect this repo and were NOT fixed${c.reset}`);
    console.log(`  ${c.dim}no model is configured, so apidrift detected and listed them instead of guessing.${c.reset}`);
    console.log('');
    for (const { codemod, matches } of plan.matched) {
      const { change } = codemod;
      const from = change.apiVersion ? ` (from ${change.apiVersion})` : '';
      console.log(`  ${c.bold}${change.title}${c.reset}`);
      console.log(`    ${c.dim}${change.target.symbol ?? change.target.type}${from} — ${matches.length} site${matches.length === 1 ? '' : 's'}${c.reset}`);
      for (const m of matches) console.log(`      ${c.dim}${rel(targetDir, m.filePath)}:${m.line}  ${m.snippet}${c.reset}`);
      for (const ref of change.references.slice(0, 1)) console.log(`      ${c.dim}${ref}${c.reset}`);
    }
    console.log('');
    console.log(`  ${c.amber}an API key is required to generate the fix${c.reset}${c.dim}: set ANTHROPIC_API_KEY and re-run with --ai. apidrift will then write the change, run YOUR test suite on it, and open a pull request.${c.reset}`);
    console.log('');
  }

  const blockedNote = blocked > 0
    ? `, ${c.amber}${blocked} change${blocked === 1 ? '' : 's'} not applied (pinned API version)${c.reset}`
    : '';
  const warnedNote = warned > 0
    ? `, ${c.amber}${warned} change${warned === 1 ? '' : 's'} detected but unmatched — see WARNING above${c.reset}`
    : '';
  const listedNote = listed > 0
    ? `, ${c.amber}${listed} change${listed === 1 ? '' : 's'} detected but NOT fixed (no model)${c.reset}`
    : '';
  console.log(`${c.bold}done${c.reset} — ${opened} pull request${opened === 1 ? '' : 's'} in ${c.bold}${shown(outputDir)}${c.reset}${blockedNote}${warnedNote}${listedNote}`);
  // `checked` counts what was EVALUATED, which includes the candidates the
  // plan pass evaluated and discarded, and — in the listing mode — the ones it
  // matched and did not hand to run(). Filtering them out of the pipeline must
  // never shrink the coverage this sentence claims.
  const clean = cleanRunNote({ checked: results.length + plan.discarded.length + listed, opened, warned, blocked, skipped, incomplete: coverageIncomplete });
  if (clean) console.log(`${c.green}✓${c.reset} ${c.dim}${clean}${c.reset}`);
  if (!capApplies && listed === 0) {
    console.log(`${c.dim}tip: set ANTHROPIC_API_KEY and pass --ai to also fix changes without a codemod.${c.reset}`);
  }
  console.log('');

  return listed > 0 ? EXIT_DRIFT_UNFIXED : EXIT_OK;
}
