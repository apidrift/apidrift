import { test } from 'node:test';
import assert from 'node:assert';
import { resolveInference, describePolicy } from '../src/config.js';
import { resolveLlm } from '../src/fixer/providers.js';

test('flags: --deterministic-only wins', () => {
  const cfg = resolveInference({ deterministicOnly: true }, process.cwd());
  assert.strictEqual(cfg.policy, 'deterministic-only');
});

test('flags: --ai selects BYOT', () => {
  const cfg = resolveInference({ ai: true }, process.cwd());
  assert.strictEqual(cfg.policy, 'byot');
});

test('default policy is deterministic-only without a key', () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const prevInf = process.env.APIDRIFT_INFERENCE;
  delete process.env.APIDRIFT_INFERENCE;
  const cfg = resolveInference({}, '/tmp/does-not-exist-xyz');
  assert.strictEqual(cfg.policy, 'deterministic-only');
  if (prev) process.env.ANTHROPIC_API_KEY = prev;
  if (prevInf) process.env.APIDRIFT_INFERENCE = prevInf;
});

test('resolveLlm: deterministic-only yields no model', async () => {
  const llm = await resolveLlm({ policy: 'deterministic-only' });
  assert.strictEqual(llm, undefined);
});

test('resolveLlm: managed without config fails with a helpful error', async () => {
  const prevU = process.env.APIDRIFT_GATEWAY_URL, prevT = process.env.APIDRIFT_ORG_TOKEN;
  delete process.env.APIDRIFT_GATEWAY_URL; delete process.env.APIDRIFT_ORG_TOKEN;
  await assert.rejects(() => resolveLlm({ policy: 'managed' }), /APIDRIFT_GATEWAY_URL/);
  if (prevU) process.env.APIDRIFT_GATEWAY_URL = prevU;
  if (prevT) process.env.APIDRIFT_ORG_TOKEN = prevT;
});

test('describePolicy is human-readable', () => {
  assert.match(describePolicy({ policy: 'byot' }), /BYOT/);
});
