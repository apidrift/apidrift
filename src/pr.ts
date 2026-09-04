import path from 'node:path';
import type { PinnedApiVersion } from './matcher/api-version.js';
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

/**
 * The one line said about API versions (US-7, extended by US-9), or `null` for
 * none. Shared verbatim by the PR body and by the CLI, so a reader never gets
 * two different accounts of the same finding.
 *
 * Emitted ONLY when the change is gated on an API version AND we have a
 * resolution to report. That is why the charges -> paymentIntents change — a
 * product deprecation with no `apiVersion` — gains nothing: the most visible
 * path of the product stays byte-identical.
 *
 * Kept to one line inside the existing "What changed upstream" section, on
 * purpose: no banner, no alert emoji, no new section. This is a disclosure
 * that closes a known blind spot, not an incident. A warning that fires on
 * every PR is a warning nobody reads.
 *
 * The blind spot itself, stated rather than assumed known: since stripe-node
 * v12 a client built with NO `apiVersion` is still pinned — implicitly, to
 * whatever API version was current when that SDK release shipped. So "we found
 * no pin" is not "you are on the latest version", and we say so.
 *
 * ## The rule US-9 adds: never claim an absence you did not verify
 * Six reasons, and they do NOT collapse into one sentence. Three situations a
 * reader must be able to tell apart:
 *   - "we LOOKED and there is no pin"  -> `no-client` / `no-option`, only
 *     reachable when a caller resolved from the source alone;
 *   - "we could NOT look"              -> `sdk-not-installed`,
 *     `sdk-version-unreadable`. The old "no pinned apiVersion found in this
 *     repo" line asserted a fact we had not checked, and must never come out
 *     here;
 *   - "the SDK imposes no pin, your ACCOUNT default applies" ->
 *     `sdk-predates-implicit-pin`. Neither a pin nor an absence of one, and
 *     nothing static analysis can ever see.
 */
export function apiVersionNote(change: Change, pinned: PinnedApiVersion | undefined): string | null {
  if (!change.apiVersion || !pinned) return null;

  if (pinned.status === 'pinned') {
    const list = pinned.versions.map((v) => `\`${v.version}\``).join(', ');
    if (pinned.source === 'installed-sdk-default') {
      // The version appears NOWHERE in the reader's own code, so say where it
      // does come from — otherwise this line looks like an invention.
      return `this repo's code sets no \`apiVersion\`, but the installed \`${change.vendor}\` `
        + `v${pinned.sdkVersion} pins IMPLICITLY to ${list} — at or after this change, so the fix applies.`;
    }
    return `this repo pins ${list} — at or after this change, so the fix applies.`;
  }

  switch (pinned.reason) {
    case 'non-literal':
      return 'this repo sets `apiVersion` from a value APIdrift cannot read statically '
        + `(an env var, a variable or a spread) — confirm it is \`${change.apiVersion}\` or later.`;

    case 'sdk-not-installed':
      return `this repo's code sets no \`apiVersion\`, and APIdrift could not check the implicit one: `
        + `\`node_modules/${change.vendor}\` is not installed here. stripe-node v12+ pins IMPLICITLY to `
        + 'the API version current at its own release, so "no pin in the code" is not "latest" — '
        + `install dependencies and re-run, or confirm yours is \`${change.apiVersion}\` or later.`;

    case 'sdk-version-unreadable':
      return `this repo's code sets no \`apiVersion\`, and APIdrift could not read the default one from `
        + `the installed \`${change.vendor}\` package${pinned.sdkVersion ? ` (v${pinned.sdkVersion})` : ''}. `
        + 'stripe-node v12+ pins IMPLICITLY to the API version current at its own release, so "no pin in '
        + `the code" is not "latest" — confirm yours is \`${change.apiVersion}\` or later.`;

    case 'sdk-predates-implicit-pin':
      return `this repo's code sets no \`apiVersion\` and the installed \`${change.vendor}\` `
        + `v${pinned.sdkVersion} predates v12, so it sends no version header at all: this repo runs on your `
        + `${change.vendor} ACCOUNT's default API version, which no static analysis can see — `
        + `confirm it is \`${change.apiVersion}\` or later.`;

    default:
      // `no-client` / `no-option`: we read the source and found no pin there.
      // Reachable only from a source-only resolution — `resolvePinnedApiVersion`
      // always goes on to consult the installed SDK.
      return 'no pinned `apiVersion` found in this repo. Note that stripe-node v12+ pins '
        + 'IMPLICITLY to the API version current at its own release, so "no pin in the code" '
        + 'is not "latest" — check yours.';
  }
}

/** Builds the PR/MR description in APIdrift's house format. */
export function buildPrBody(args: {
  change: Change;
  matches: Match[];
  diff: string;
  verify: VerifyResult;
  workspaceDir: string;
  draft: boolean;
  /**
   * What the pinned-version guard resolved. OPTIONAL: absent (the pre-US-7
   * call shape, and every non-version-gated change) means no API-version line
   * at all.
   */
  pinnedApiVersion?: PinnedApiVersion;
}): { title: string; body: string } {
  const { change, matches, diff, verify, workspaceDir, draft } = args;

  const files = [...new Set(matches.map((m) => path.relative(workspaceDir, m.filePath)))];
  const status = verify.passed
    ? '✅ **All checks passed** — your test suite, unmodified.'
    : '⚠️ **Tests did not pass** — opened as a draft for a human to finish.';

  const title = `${draft ? '[draft] ' : ''}${change.title}`;

  const note = apiVersionNote(change, args.pinnedApiVersion);
  const apiVersionLine = note === null ? '' : `\n- **API version:** takes effect from \`${change.apiVersion}\` — ${note}`;

  const body = `# ${change.title}

${status}

## What changed upstream
- **Vendor:** ${change.vendor}
- **Type:** ${change.kind} (confidence: ${change.confidence})
- **What:** \`${change.target.symbol}\` — ${change.migration.detail}
- **Changelog:** ${change.references[0] ?? 'n/a'}${apiVersionLine}

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
