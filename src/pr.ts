import path from 'node:path';
import type { Change, Match, VerifyResult } from './types.js';

/**
 * Patterns matching the "final tally" line(s) that popular JS test runners
 * print at the end of a passing run. Order doesn't matter; we scan the whole
 * output and keep whichever pattern's matches appear latest.
 *
 * - Mocha:            "  328 passing (9s)"
 * - Node test runner: "# tests 13" / "# pass 13" / "# fail 0" (TAP)
 * - Jest:              "Tests:       13 passed, 13 total"
 * - Vitest:             "Tests  13 passed (13)"
 * - Ava:               "13 tests passed"
 * - Jasmine/RSpec-ish: "13 examples, 0 failures"
 */
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;

/** Strips ANSI color/style escape codes (many runners, e.g. mocha/c8, colorize their summary line). */
function stripAnsi(line: string): string {
  return line.replace(ANSI_ESCAPE_PATTERN, '');
}

const SUMMARY_LINE_PATTERNS: RegExp[] = [
  /^#\s+(tests|pass|fail|suites|cancelled|skipped|todo)\s+\d+/i,
  /^\s*\d+\s+passing\b/i,
  /^\s*tests:\s*\d+\s+passed/i,
  /^\s*test files\s+\d+\s+passed/i,
  /^\s*tests\s+\d+\s+passed/i,
  /^\s*\d+\s+tests?\s+passed\b/i,
  /^\s*\d+\s+examples?,\s*\d+\s+failures?/i,
];

/**
 * Picks a verification excerpt that's faithful to the verdict:
 *  - When the suite is RED, the raw tail is the useful diagnostic — keep it.
 *  - When the suite is GREEN, don't show raw stdout+stderr tail: a trailing
 *    line from an unrelated-but-passing test (e.g. an intentional
 *    `console.error` in an error-path test) can land there and read like a
 *    failure next to the "All checks passed" header. Instead, prefer the
 *    runner's own summary line(s) (mocha "N passing", `node --test`'s TAP
 *    tally, jest/vitest/ava/jasmine equivalents...). This is runner-agnostic
 *    by design: it recognizes common formats rather than assuming one.
 */
export function summarizeVerification(verify: Pick<VerifyResult, 'passed' | 'output'>): string {
  const lines = verify.output.split('\n');

  if (!verify.passed) {
    const tail = lines.slice(-12).join('\n').trim();
    return tail || '(no output captured)';
  }

  const matched = lines
    .map(stripAnsi)
    .filter((line) => SUMMARY_LINE_PATTERNS.some((re) => re.test(line)))
    .map((l) => l.trim());
  if (matched.length > 0) {
    return matched.join('\n');
  }

  // Green (exit code 0) but no recognized summary format: don't guess by
  // showing an arbitrary raw tail that might be misread as a failure.
  return '(all checks passed — command exited 0; no recognized test-summary line found in its output)';
}

/** Builds the PR/MR description in APIdrift's house format. */
export function buildPrBody(args: {
  change: Change;
  matches: Match[];
  diff: string;
  verify: VerifyResult;
  workspaceDir: string;
  draft: boolean;
}): { title: string; body: string } {
  const { change, matches, diff, verify, workspaceDir, draft } = args;

  const files = [...new Set(matches.map((m) => path.relative(workspaceDir, m.filePath)))];
  const status = verify.passed
    ? '✅ **All checks passed** — your test suite, unmodified.'
    : '⚠️ **Tests did not pass** — opened as a draft for a human to finish.';

  const title = `${draft ? '[draft] ' : ''}${change.title}`;

  const body = `# ${change.title}

${status}

## What changed upstream
- **Vendor:** ${change.vendor}
- **Type:** ${change.kind} (confidence: ${change.confidence})
- **What:** \`${change.target.symbol}\` — ${change.migration.detail}
- **Changelog:** ${change.references[0] ?? 'n/a'}

## What this PR does
Updated ${matches.length} usage${matches.length === 1 ? '' : 's'} across ${files.length} file${files.length === 1 ? '' : 's'}:
${files.map((f) => `- \`${f}\``).join('\n')}

## Verification
Ran \`${verify.command}\` in an isolated sandbox against your own tests:

\`\`\`
${summarizeVerification(verify)}
\`\`\`

## Diff
\`\`\`diff
${diff}
\`\`\`

---
_Opened automatically by apidrift[bot]. The fixer edits source only; your tests were run unmodified._
`;

  return { title, body };
}
