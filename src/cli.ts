#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './pipeline.js';
import { resolveLlm } from './fixer/providers.js';
import { resolveInference, describePolicy, type CliFlags } from './config.js';
import { codemods as defaultCodemods } from './changes/index.js';
import { detectChanges, type Fetcher } from './detection/index.js';
import { genericSymbolCodemod } from './matcher/symbol.js';
import type { Change, Codemod } from './types.js';

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', amber: '\x1b[33m', blue: '\x1b[34m', red: '\x1b[31m',
};

function version(): string {
  try {
    const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version ?? '0.0.0';
  } catch { return '0.0.0'; }
}

const HELP = `apidrift ${version()} — open tested PRs when a third-party API you depend on changes

USAGE
  apidrift run <path-to-repo> [options]

OPTIONS
  --deterministic-only   Use only the codemod library. No model, no code sent anywhere.
  --ai                   Enable the AI fixer via your ANTHROPIC_API_KEY (BYOT).
  --model <id>           Override the model (BYOT/managed).
  --out <dir>            Where to write the PR bodies and patches, one pair per
                         change (apidrift-<change-id>.md / .patch, default: ./apidrift-out).
  --detect               Opt-in: poll the real Stripe changelog (network) in
                         addition to the built-in codemod registry. Requires --release.
  --release <id>         Changelog release to poll with --detect, e.g. 2026-08-26.preview.
  -h, --help             Show this help.
  -v, --version          Print version.

INFERENCE (Free tier)
  Default: BYOT if ANTHROPIC_API_KEY is set, otherwise deterministic-only.
  Your code never leaves your machine in either mode.

DETECTION (opt-in, --detect)
  Without --detect: only the hardcoded registry (src/changes) runs — no
  network access, ever, unless you pass this flag. With --detect: the CLI also
  fetches https://docs.stripe.com/changelog.md and the matching release's
  detail pages, and folds in every auto-executable ("forme #1") change it
  finds via a generic AST matcher. Non-auto-executable ("forme #2") changes
  are reported but never fed into the pipeline — they need a hand-written
  codemod. Detected changes have no deterministic fix, so they need --ai (or
  ANTHROPIC_API_KEY) to actually produce one; without it they're matched and
  then skipped by the pipeline (no LLM configured).

EXAMPLES
  apidrift run .
  ANTHROPIC_API_KEY=sk-ant-... apidrift run . --ai
  apidrift run ./service --deterministic-only
  ANTHROPIC_API_KEY=sk-ant-... apidrift run . --ai --detect --release 2026-08-26.preview`;

function parse(argv: string[]) {
  const args = argv.slice(2);
  if (args.includes('-h') || args.includes('--help') || args.length === 0) return { help: true } as const;
  if (args.includes('-v') || args.includes('--version')) return { showVersion: true } as const;

  const cmd = args[0];
  const target = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
  const getVal = (name: string) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };

  const flags: CliFlags = {
    deterministicOnly: args.includes('--deterministic-only'),
    ai: args.includes('--ai'),
    model: getVal('--model'),
  };
  return {
    cmd,
    target,
    out: getVal('--out'),
    flags,
    detect: args.includes('--detect'),
    release: getVal('--release'),
  } as const;
}

/** Real network fetch for --detect. Never called unless the user opts in. */
const httpFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { 'Accept-Language': 'en-US' } });
  if (!res.ok) throw new Error(`detection: GET ${url} -> HTTP ${res.status}`);
  return res.text();
};

async function main() {
  const p = parse(process.argv);
  if ('help' in p) { console.log(HELP); process.exit(0); }
  if ('showVersion' in p) { console.log(version()); process.exit(0); }

  if (p.cmd !== 'run' || !p.target) {
    console.error(`${c.red}error:${c.reset} expected \`apidrift run <path-to-repo>\`. Try --help.`);
    process.exit(1);
  }

  const targetDir = path.resolve(p.target);
  if (!fs.existsSync(targetDir)) {
    console.error(`${c.red}error:${c.reset} no such directory: ${targetDir}`);
    process.exit(1);
  }

  const outputDir = p.out ? path.resolve(p.out) : path.resolve('apidrift-out');
  const inference = resolveInference(p.flags, targetDir);

  let llm;
  try {
    llm = await resolveLlm(inference);
  } catch (err) {
    console.error(`${c.red}error:${c.reset} ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`\n${c.blue}${c.bold}apidrift${c.reset} ${c.dim}v${version()}${c.reset}  scanning ${c.bold}${targetDir}${c.reset}`);
  console.log(`${c.dim}inference: ${describePolicy(inference)}${c.reset}\n`);

  // Detection is opt-in and additive: without --detect, `codemods` stays
  // undefined and `run()` falls back to the hardcoded registry exactly as
  // before US-2 (non-regression). Network is never touched unless --detect
  // is passed explicitly.
  let codemods: Codemod[] | undefined;
  if (p.detect) {
    if (!p.release) {
      console.error(`${c.red}error:${c.reset} --detect requires --release <id>, e.g. --release 2026-08-26.preview`);
      process.exit(1);
    }
    console.log(`${c.dim}detect: polling https://docs.stripe.com/changelog.md for release ${p.release}...${c.reset}`);
    const detection = await detectChanges({ fetcher: httpFetcher, release: p.release });
    for (const d of detection.all) {
      const status = d.autoExecutable ? `${c.green}auto-executable${c.reset}` : `${c.amber}forme #2 — needs a hand-written codemod, not run${c.reset}`;
      console.log(`  ${c.dim}[${d.classification}]${c.reset} ${d.change.target.symbol} — ${status}`);
    }
    console.log(`${c.dim}detect: ${detection.autoExecutable.length} auto-executable change(s) added to this run${c.reset}\n`);
    codemods = [...defaultCodemods, ...detection.autoExecutable.map((change: Change) => genericSymbolCodemod(change))];
  }

  const results = await run(targetDir, { outputDir, mode: 'workspace', llm, codemods });
  let opened = 0, skipped = 0, blocked = 0;

  for (const r of results) {
    if (!r.applied) {
      // A change we matched and then deliberately did NOT apply has to be
      // said out loud. Silence here reads as "done — 0 pull requests", i.e.
      // "your code is clean", which is the exact opposite of the truth: we
      // found call sites and left them alone on purpose. No artifact is
      // written for this case either — a draft PR carrying a known-wrong fix
      // would just invite someone to merge it.
      if (r.skipped?.reason === 'pinned-api-version') {
        blocked += 1;
        const s = r.skipped;
        console.log(`${c.amber}●${c.reset} ${c.bold}${r.change.title}${c.reset}`);
        console.log(`  ${c.amber}not applied — this repo pins an older Stripe API version${c.reset}`);
        console.log(`  ${c.dim}change takes effect from:${c.reset} ${s.changeApiVersion}`);
        for (const p of s.pinnedVersions) {
          console.log(`  ${c.dim}this repo pins:${c.reset} ${p.version}  ${c.dim}(${p.filePath}:${p.line})${c.reset}`);
        }
        console.log(`  ${c.dim}${r.matches.length} site${r.matches.length === 1 ? '' : 's'} found and left UNCHANGED:${c.reset}`);
        for (const m of r.matches) console.log(`    ${c.dim}${m.filePath}:${m.line}  ${m.snippet}${c.reset}`);
        console.log(`  ${c.dim}applying it would migrate code that is correct on ${s.pinnedVersion}. Upgrade your`);
        console.log(`  pinned API version first, then re-run apidrift.${c.reset}`);
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
    for (const m of r.matches) console.log(`    ${c.dim}${m.filePath}:${m.line}  ${m.snippet}${c.reset}`);
    console.log(`  ${verdict}`);
    console.log(`  ${c.dim}PR:${c.reset} ${r.prPath}`);
    if (r.patchPath) console.log(`  ${c.dim}patch:${c.reset} ${r.patchPath}`);
    console.log('');
  }

  const blockedNote = blocked > 0
    ? `, ${c.amber}${blocked} change${blocked === 1 ? '' : 's'} not applied (pinned API version)${c.reset}`
    : '';
  console.log(`${c.bold}done${c.reset} — ${opened} pull request${opened === 1 ? '' : 's'} in ${c.bold}${outputDir}${c.reset}${blockedNote}`);
  if (inference.policy === 'deterministic-only') {
    console.log(`${c.dim}tip: set ANTHROPIC_API_KEY and pass --ai to also fix changes without a codemod.${c.reset}`);
  }
  console.log('');
}

main().catch((err) => { console.error(err); process.exit(1); });
