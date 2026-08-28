import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Node } from 'ts-morph';
import { run } from '../src/pipeline.js';
import type { Codemod, Match } from '../src/types.js';
import type { Llm, LlmRequest, LlmResponse } from '../src/fixer/llm.js';

// A change with NO deterministic codemod -> only the AI agent can fix it.
// This is the general mechanism of the real product.
const aiOnlyChange: Codemod = {
  change: {
    id: 'stripe-tokens-deprecated',
    vendor: 'stripe',
    source: 'changelog',
    kind: 'deprecation',
    title: 'Migrate deprecated stripe.tokens.create',
    target: { type: 'symbol', symbol: 'stripe.tokens.create' },
    migration: { op: 'replaced_by', detail: 'use paymentMethods.create' },
    references: ['https://docs.stripe.com/'],
    confidence: 'medium',
  },
  // No `apply` -> forces the AI path.
  find(project) {
    const out: Match[] = [];
    for (const sf of project.getSourceFiles()) {
      sf.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return;
        const callee = node.getExpression();
        if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'create') return;
        const recv = callee.getExpression();
        if (!Node.isPropertyAccessExpression(recv) || recv.getName() !== 'tokens') return;
        const { line } = sf.getLineAndColumnAtPos(node.getStart());
        out.push({ filePath: sf.getFilePath(), line, snippet: node.getText().split('\n')[0], node });
      });
    }
    return out;
  },
};

/** A scripted LLM: on first turn it writes `newContent`, then it stops. */
function mockLlm(targetRel: string, newContent: string): Llm {
  let turn = 0;
  return {
    async createMessage(_req: LlmRequest): Promise<LlmResponse> {
      turn += 1;
      if (turn === 1) {
        return {
          stop_reason: 'tool_use',
          content: [
            { type: 'tool_use', id: 't1', name: 'write_file', input: { path: targetRel, content: newContent } },
          ],
        };
      }
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
    },
  };
}

function makeRepo(sourceBody: string, testBody: string): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-ai-'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.mkdirSync(path.join(repo, 'lib'));
  fs.mkdirSync(path.join(repo, 'test'));
  fs.writeFileSync(path.join(repo, 'package.json'),
    JSON.stringify({ name: 'ai', type: 'commonjs', scripts: { test: 'node --test' } }));
  fs.copyFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'fixtures', 'acme-payments', 'lib', 'stripe-mock.js'),
    path.join(repo, 'lib', 'stripe-mock.js'));
  fs.writeFileSync(path.join(repo, 'src', 'pay.js'), sourceBody);
  fs.writeFileSync(path.join(repo, 'test', 'pay.test.js'), testBody);
  return repo;
}

const oldSource = `'use strict';
async function pay(stripe, token) {
  const t = await stripe.tokens.create({ card: token });
  return t.id;
}
module.exports = { pay };
`;

const goodTest = `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeStripe } = require('../lib/stripe-mock');
const { pay } = require('../src/pay');
test('returns an id', async () => {
  const stripe = makeStripe();
  stripe.tokens = { create: async () => ({ id: 'tok_1' }) };
  stripe.paymentMethods = { create: async () => ({ id: 'pm_1' }) };
  const id = await pay(stripe, 'x');
  assert.ok(id);
});
`;

test('AI path: agent writes the fix and a passing suite opens a real PR', async () => {
  const repo = makeRepo(oldSource, goodTest);
  const fixed = `'use strict';
async function pay(stripe, token) {
  const t = await stripe.paymentMethods.create({ card: token });
  return t.id;
}
module.exports = { pay };
`;
  const results = await run(repo, {
    outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'out-')),
    codemods: [aiOnlyChange],
    llm: mockLlm('src/pay.js', fixed),
  });
  const r = results[0];
  assert.strictEqual(r.applied, true, 'AI fix should be applied');
  assert.strictEqual(r.method, 'ai', 'should have used the AI path');
  assert.strictEqual(r.verify?.passed, true, 'tests pass after AI fix');
  assert.strictEqual(r.draft, false, 'passing AI fix opens a real PR');
});

test('AI guardrail: agent cannot edit a test file (write is refused)', async () => {
  const repo = makeRepo(oldSource, goodTest);
  // Malicious/confused agent tries to overwrite the TEST instead of the source.
  const results = await run(repo, {
    outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'out-')),
    codemods: [aiOnlyChange],
    llm: mockLlm('test/pay.test.js', '// gutted test\n'),
  });
  const r = results[0];
  // The write was refused, so nothing changed -> no PR opened.
  assert.strictEqual(r.applied, false, 'editing a test must be refused, leaving no diff');
});
