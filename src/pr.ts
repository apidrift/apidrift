import path from 'node:path';
import type { Change, Match, VerifyResult } from './types.js';

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
${verify.output.split('\n').slice(-12).join('\n')}
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
