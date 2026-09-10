import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProject } from '../src/matcher/index.js';
import { createSymbolMatcher, genericSymbolCodemod } from '../src/matcher/symbol.js';
import type { Change } from '../src/types.js';

function makeRepo(files: Record<string, string>): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apidrift-symbol-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return repo;
}

test('generic matcher: matches `<stripe>.subscriptions.retrieve(...)` when the root is `require("stripe")(key)`', () => {
  const repo = makeRepo({
    'src/billing.js': `
      const stripe = require('stripe')(process.env.STRIPE_KEY);
      async function loadSub(id) {
        return stripe.subscriptions.retrieve(id);
      }
      module.exports = { loadSub };
    `,
  });
  const project = loadProject(repo);
  const find = createSymbolMatcher('stripe.subscriptions.retrieve', 'stripe');
  const matches = find(project);
  assert.strictEqual(matches.length, 1);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('generic matcher: matches through a renamed binding (`stripeClient`, `client`), not just the literal name `stripe`', () => {
  const repo = makeRepo({
    'src/billing.js': `
      const stripeClient = require('stripe')(process.env.STRIPE_KEY);
      async function loadSub(id) {
        return stripeClient.subscriptions.retrieve(id);
      }
    `,
  });
  const project = loadProject(repo);
  const find = createSymbolMatcher('stripe.subscriptions.retrieve', 'stripe');
  assert.strictEqual(find(project).length, 1);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('generic matcher: matches `new Stripe(...)` bound via CommonJS `const Stripe = require("stripe")`', () => {
  const repo = makeRepo({
    'src/billing.js': `
      const Stripe = require('stripe');
      const client = new Stripe(process.env.STRIPE_KEY);
      async function loadSub(id) {
        return client.subscriptions.retrieve(id);
      }
      module.exports = { loadSub };
    `,
  });
  const project = loadProject(repo);
  const find = createSymbolMatcher('stripe.subscriptions.retrieve', 'stripe');
  assert.strictEqual(find(project).length, 1, 'require + new is an ordinary, common construction shape and must match');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('generic matcher: matches `new Stripe(...)` bound via a default import from the vendor module', () => {
  const repo = makeRepo({
    'src/billing.ts': `
      import Stripe from 'stripe';
      const client = new Stripe(process.env.STRIPE_KEY as string);
      export async function loadSub(id: string) {
        return client.subscriptions.retrieve(id);
      }
    `,
  });
  const project = loadProject(repo);
  const find = createSymbolMatcher('stripe.subscriptions.retrieve', 'stripe');
  assert.strictEqual(find(project).length, 1);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('generic matcher: matches `this.stripe` assigned in a constructor to `new Stripe(...)`', () => {
  const repo = makeRepo({
    'src/billing-service.ts': `
      import Stripe from 'stripe';
      export class BillingService {
        stripe: Stripe;
        constructor(key: string) {
          this.stripe = new Stripe(key);
        }
        async loadSub(id: string) {
          return this.stripe.subscriptions.retrieve(id);
        }
      }
    `,
  });
  const project = loadProject(repo);
  const find = createSymbolMatcher('stripe.subscriptions.retrieve', 'stripe');
  assert.strictEqual(find(project).length, 1);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('generic matcher: matches a multi-segment namespace (`stripe.checkout.sessions.create`)', () => {
  const repo = makeRepo({
    'src/checkout.js': `
      const stripe = require('stripe')(process.env.STRIPE_KEY);
      async function startCheckout(params) {
        return stripe.checkout.sessions.create(params);
      }
    `,
  });
  const project = loadProject(repo);
  const find = createSymbolMatcher('stripe.checkout.sessions.create', 'stripe');
  assert.strictEqual(find(project).length, 1);
  fs.rmSync(repo, { recursive: true, force: true });
});

// ── Safety: the whole point of this module ──────────────────────────────────

test('SAFETY: db.subscriptions.retrieve(...) does NOT match stripe.subscriptions.retrieve — unresolved root never matches', () => {
  const repo = makeRepo({
    'src/db.js': `
      const db = require('./db-client');
      async function loadSub(id) {
        return db.subscriptions.retrieve(id);
      }
    `,
  });
  const project = loadProject(repo);
  const find = createSymbolMatcher('stripe.subscriptions.retrieve', 'stripe');
  assert.strictEqual(find(project).length, 0, 'a root that does not resolve to the vendor module must never match');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('SAFETY: a binding from an unresolvable factory (not require(vendor) / new Vendor) never matches', () => {
  const repo = makeRepo({
    'src/billing.js': `
      const stripeClient = makeSomeUnrelatedClient(process.env.KEY);
      async function loadSub(id) {
        return stripeClient.subscriptions.retrieve(id);
      }
    `,
  });
  const project = loadProject(repo);
  const find = createSymbolMatcher('stripe.subscriptions.retrieve', 'stripe');
  assert.strictEqual(find(project).length, 0, 'an unresolvable initializer must fail closed, never match "just in case"');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('SAFETY: `this.stripe` never assigned to the vendor module does not match', () => {
  const repo = makeRepo({
    'src/db-service.ts': `
      export class DbService {
        stripe: any;
        constructor(client: any) {
          this.stripe = client; // not new Stripe(...) / require('stripe')(...)
        }
        async loadSub(id: string) {
          return this.stripe.subscriptions.retrieve(id);
        }
      }
    `,
  });
  const project = loadProject(repo);
  const find = createSymbolMatcher('stripe.subscriptions.retrieve', 'stripe');
  assert.strictEqual(find(project).length, 0);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('KNOWN GAP: destructured `const { Stripe } = require("stripe")` does not match (documented, not silently regressed)', () => {
  const repo = makeRepo({
    'src/billing.js': `
      const { Stripe } = require('stripe');
      const client = new Stripe(process.env.STRIPE_KEY);
      async function loadSub(id) {
        return client.subscriptions.retrieve(id);
      }
      module.exports = { loadSub };
    `,
  });
  const project = loadProject(repo);
  const find = createSymbolMatcher('stripe.subscriptions.retrieve', 'stripe');
  assert.strictEqual(find(project).length, 0, 'destructured require stays a documented gap, covered instead by the pipeline anti-silence warning');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('SAFETY: a generic-sounding symbol (prices.create) does not match an unrelated domain object of the same shape', () => {
  const repo = makeRepo({
    'src/catalog.js': `
      const db = require('./db-client');
      async function addPrice(payload) {
        return db.prices.create(payload);
      }
    `,
  });
  const project = loadProject(repo);
  const find = createSymbolMatcher('stripe.prices.create', 'stripe');
  assert.strictEqual(find(project).length, 0);
  fs.rmSync(repo, { recursive: true, force: true });
});

// ── genericSymbolCodemod wrapping ───────────────────────────────────────────

test('genericSymbolCodemod: wraps a Change into a Codemod with find() and no apply() (forces the AI tier)', () => {
  const change: Change = {
    id: 'stripe-2026-08-26-preview-x-payment-intents-confirm-payment-method-types',
    vendor: 'stripe',
    source: 'changelog',
    kind: 'breaking',
    title: 'test',
    target: { type: 'symbol', symbol: 'stripe.paymentIntents.confirm' },
    migration: { op: 'removed', detail: '`payment_method_types` — remove it.' },
    references: ['https://docs.stripe.com/changelog.md (consulted 2026-09-01)'],
    confidence: 'low',
  };
  const codemod = genericSymbolCodemod(change);
  assert.strictEqual(typeof codemod.find, 'function');
  assert.strictEqual(codemod.apply, undefined, 'a detected change never ships a deterministic apply()');

  const repo = makeRepo({
    'src/pay.js': `
      const stripe = require('stripe')(process.env.KEY);
      stripe.paymentIntents.confirm(id);
    `,
  });
  const project = loadProject(repo);
  assert.strictEqual(codemod.find(project).length, 1);
  fs.rmSync(repo, { recursive: true, force: true });
});
