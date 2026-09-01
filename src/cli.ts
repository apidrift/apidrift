#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './pipeline.js';
import { resolveLlm } from './fixer/providers.js';
import { resolveInference, describePolicy, type CliFlags } from './config.js';

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
  -h, --help             Show this help.
  -v, --version          Print version.

INFERENCE (Free tier)
  Default: BYOT if ANTHROPIC_API_KEY is set, otherwise deterministic-only.
  Your code never leaves your machine in either mode.

EXAMPLES
  apidrift run .
  ANTHROPIC_API_KEY=sk-ant-... apidrift run . --ai
  apidrift run ./service --deterministic-only`;

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
  return { cmd, target, out: getVal('--out'), flags } as const;
}

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

  const results = await run(targetDir, { outputDir, mode: 'workspace', llm });
  let opened = 0, skipped = 0;

  for (const r of results) {
    if (!r.applied) {
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

  console.log(`${c.bold}done${c.reset} — ${opened} pull request${opened === 1 ? '' : 's'} in ${c.bold}${outputDir}${c.reset}`);
  if (inference.policy === 'deterministic-only') {
    console.log(`${c.dim}tip: set ANTHROPIC_API_KEY and pass --ai to also fix changes without a codemod.${c.reset}`);
  }
  console.log('');
}

main().catch((err) => { console.error(err); process.exit(1); });
