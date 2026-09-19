/**
 * US-17 — a genuinely clean run says so.
 *
 * Principle set by 78dbfe2: terminal silence is an AFFIRMATION. "done — 0 pull
 * requests" reads as "your code is clean", which was false when call sites were
 * found and left alone. US-17 closes the other end: when the run REALLY is
 * clean, say it — but never in a case 78dbfe2 made loud.
 *
 * T1..T7 cover the pure predicate, including every inhibition branch, with no
 * process and no network. T8 is the ONE subprocess test (the clean repo): it
 * proves the wiring in src/cli.ts and the exit code. The inhibition branches
 * (warned / blocked / skipped) are deliberately NOT tested through a
 * subprocess: warned needs the changelog walk (a real fetch of docs.stripe.com) and
 * skipped needs a matching change without apply() and without an LLM. Zero
 * network in this suite.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanRunNote } from '../src/cli-summary.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const CLEAN = { checked: 2, opened: 0, warned: 0, blocked: 0, skipped: 0 };

test('T1: clean run -> the sentence, naming how many known changes were checked', () => {
  const note = cleanRunNote(CLEAN);
  assert.ok(note !== null);
  assert.ok(note.includes('no known API change affects this repo'));
  assert.match(note, /checked 2 known changes?/);
});

test('T1b: pluralises in-house (1 change / N changes)', () => {
  assert.match(cleanRunNote({ ...CLEAN, checked: 1 })!, /checked 1 known change\)/);
  assert.match(cleanRunNote({ ...CLEAN, checked: 3 })!, /checked 3 known changes\)/);
});

test('T2: warned inhibits — this is the 78dbfe2 anti-silence guard; the two messages never coexist (AC4)', () => {
  assert.strictEqual(cleanRunNote({ ...CLEAN, warned: 1 }), null);
});

test('T3: blocked inhibits — pinned-api-version: sites were found and left UNCHANGED', () => {
  assert.strictEqual(cleanRunNote({ ...CLEAN, blocked: 1 }), null);
});

test('T4: opened inhibits — a PR was produced, so something WAS affected', () => {
  assert.strictEqual(cleanRunNote({ ...CLEAN, opened: 1 }), null);
});

test('T5: skipped inhibits — matched but not applied is NOT a clean repo', () => {
  // Call sites were found and deliberately left as they are (no codemod apply,
  // no LLM). Certifying "no known API change affects this repo" here is the
  // exact false bill of health 78dbfe2 forbade; only the cause differs.
  assert.strictEqual(cleanRunNote({ ...CLEAN, skipped: 1 }), null);
});

test('T6: checked = 0 -> null — never certify a coverage we did not have', () => {
  assert.strictEqual(cleanRunNote({ ...CLEAN, checked: 0 }), null);
});

test('T7: the returned sentence carries no ANSI — colour lives at the call site', () => {
  assert.ok(!cleanRunNote(CLEAN)!.includes('\x1b'));
});

test('T8: subprocess — a clean repo prints the note AFTER "done", exits 0, writes nothing, no warning', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-clean-repo-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-clean-out-'));
  try {
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"clean-repo","version":"1.0.0"}');
    fs.writeFileSync(path.join(repo, 'src', 'index.js'), 'module.exports = { add: (a, b) => a + b };\n');

    const env: NodeJS.ProcessEnv = { ...process.env, NODE_TEST_CONTEXT: undefined };
    delete env.ANTHROPIC_API_KEY;
    const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'run', repo, '--deterministic-only', '--out', out], {
      cwd: repoRoot, encoding: 'utf8', env,
    });
    const output = r.stdout.replace(/\x1b\[[0-9;]*m/g, '');

    assert.strictEqual(r.status, 0, `CLI failed:\n${r.stdout}\n${r.stderr}`);
    assert.match(output, /no known API change affects this repo/);
    assert.match(output, /checked \d+ known changes?/);
    assert.ok(output.includes('done — 0 pull requests'), 'the existing anchor line is untouched');
    assert.ok(
      output.indexOf('done — 0 pull requests') < output.indexOf('no known API change'),
      'the note comes AFTER the done line',
    );
    assert.ok(!output.includes('WARNING'));
    assert.deepStrictEqual(fs.readdirSync(out), [], 'no artifact for a clean run');
    assert.deepStrictEqual(fs.readdirSync(repo).sort(), ['package.json', 'src'], 'nothing written in the target repo');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('T9: an incomplete walk inhibits — an unread page / a bound ahead of the index is a hole in the COVERAGE, not a clean repo (US-14 R1)', () => {
  assert.strictEqual(cleanRunNote({ ...CLEAN, incomplete: true }), null);
  // Additive and optional: absent or false leaves the predicate exactly as it was.
  assert.ok(cleanRunNote({ ...CLEAN, incomplete: false }) !== null);
  assert.ok(cleanRunNote(CLEAN) !== null);
});
