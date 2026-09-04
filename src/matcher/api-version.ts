/**
 * Reads the vendor API version a target repo PINS its client to — the input to
 * the pipeline's fail-safe guard (US-7).
 *
 * ## Why this exists
 * US-6 proved on `agnaistic/agnai` that the subscription codemod migrated
 * CORRECT code into a shape Stripe will never return to that account: the
 * client there is constructed with `apiVersion: '2023-08-16'`, older than the
 * `2025-03-31.basil` changelog entry the Change is built on. `npm test` stayed
 * green (the repo's suite never exercises that path), so the moat let a
 * silently-wrong, non-draft PR through. "Verification is the moat" only means
 * something if a green run means something.
 *
 * ## What it looks for: CONSTRUCTIONS, not calls
 * The pinned version lives on the client's *construction* (`new Stripe(key,
 * { apiVersion })` / `require('stripe')(key, { apiVersion })`), never on a
 * method call. `src/matcher/symbol.ts` resolves the other direction (a call
 * chain's root back to its construction); this module walks the constructions
 * themselves and reads their second argument.
 *
 * That makes this a deliberately WIDE finder, and widening it is safe here:
 * more constructions found means more chances to block, and blocking is the
 * conservative outcome. It is used ONLY by the guard, never to decide what
 * gets EDITED — the narrow, fail-closed resolvers in `symbol.ts` keep that
 * job untouched.
 *
 * ## Explicitly out of scope
 * - `node_modules/stripe/API_VERSION` (stripe-node >= v12 pins IMPLICITLY to
 *   the API version current at its own release, so "no apiVersion in the
 *   source" does NOT mean "latest"). That is the biggest remaining hole and it
 *   is tracked as its own US; the `source` discriminant below exists so a
 *   second source can be added without changing a single caller.
 * - Reading the target's `.env`: forbidden — secrets, blast radius
 *   (CLAUDE.md). `apiVersion: process.env.STRIPE_API_VERSION` therefore falls
 *   into `'non-literal'`. That is a decision, not an omission.
 *
 * 100% ts-morph. No regex over target source, ever.
 */
import { Node, SyntaxKind } from 'ts-morph';
import type { Identifier, ObjectLiteralExpression, Project } from 'ts-morph';
// The one place this module crosses into src/changes/: the "is this string a
// readable API version" rule is load-bearing and must be THE SAME rule the
// comparison uses. Duplicating it here would let the resolver accept a value
// the comparator later refuses (or vice-versa) — a silent divergence in
// exactly the code whose job is to prevent silent wrongness.
import { apiVersionDate } from '../changes/api-version.js';
import { identifierImportedFromModule, isRequireCall } from './symbol.js';

/** One `apiVersion` literal read off a client construction. */
export interface PinnedApiVersionSite {
  /** Verbatim vendor string, e.g. `'2023-08-16'` or `'2025-03-31.basil'`. */
  version: string;
  /** Absolute path of the file the construction lives in. */
  filePath: string;
  line: number;
}

/**
 * What we could establish about the target's pinned API version.
 *
 * `source` is present from day one so that a future second source (the
 * implicit stripe-node pin, see the module doc) slots in as another variant
 * without changing the shape callers destructure.
 */
export type PinnedApiVersion =
  | { status: 'pinned'; source: 'ast-client-option'; versions: PinnedApiVersionSite[] }
  | { status: 'unresolved'; reason: 'no-client' | 'no-option' | 'non-literal' };

/** What one client construction told us. */
type SiteVerdict =
  | { kind: 'literal'; version: string; filePath: string; line: number }
  | { kind: 'no-option' }
  | { kind: 'non-literal' };

/**
 * Peels `x as T`, `x satisfies T` and `(x)` off an expression.
 *
 * `{ apiVersion: '2026-08-26.dahlia' as Stripe.LatestApiVersion }` is the
 * idiomatic TypeScript spelling and would be misread as non-literal without
 * this. Verified against ts-morph while scoping US-7.
 */
function unwrap(node: Node): Node {
  let current = node;
  for (;;) {
    if (Node.isAsExpression(current) || Node.isSatisfiesExpression(current) || Node.isParenthesizedExpression(current)) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
}

/**
 * Does this identifier name the vendor module itself (or an export of it) —
 * `Stripe` in `new Stripe(...)`?
 *
 * Two routes, both AST-resolved, never by name:
 *   - an `import ... from '<vendor>'` (default, named or namespace), via the
 *     shared `identifierImportedFromModule`;
 *   - a variable whose initializer is `require('<vendor>')`, covering both
 *     `const Stripe = require('stripe')` (VariableDeclaration) and
 *     `const { Stripe } = require('stripe')` (BindingElement — walk up to the
 *     owning VariableDeclaration to reach the initializer).
 */
function identifierIsVendorModule(id: Identifier, vendorModule: string): boolean {
  if (identifierImportedFromModule(id, vendorModule)) return true;

  const symbol = id.getSymbol();
  if (!symbol) return false;

  for (const decl of symbol.getDeclarations()) {
    const varDecl = Node.isVariableDeclaration(decl)
      ? decl
      : decl.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    const init = varDecl?.getInitializer();
    if (init && isRequireCall(unwrap(init), vendorModule)) return true;
  }
  return false;
}

/**
 * Is `node` a construction of the vendor's client?
 *
 * Recognized:
 *   new Stripe(key, opts)          — identifier resolving to the vendor module
 *   new S.Stripe(key, opts)        — namespace import (`import * as S`); the
 *                                    root of the property access is what must
 *                                    resolve, not the property name
 *   require('stripe')(key, opts)   — the CommonJS factory shape
 */
function isVendorClientConstruction(node: Node, vendorModule: string): boolean {
  if (Node.isNewExpression(node)) {
    const ctor = unwrap(node.getExpression());
    if (Node.isIdentifier(ctor)) return identifierIsVendorModule(ctor, vendorModule);
    if (Node.isPropertyAccessExpression(ctor)) {
      const root = unwrap(ctor.getExpression());
      return Node.isIdentifier(root) && identifierIsVendorModule(root, vendorModule);
    }
    return false;
  }

  if (Node.isCallExpression(node)) return isRequireCall(unwrap(node.getExpression()), vendorModule);
  return false;
}

/**
 * Reads `apiVersion` off a client's options object.
 *
 * Every branch that cannot produce a version returns `'non-literal'` rather
 * than a guess:
 *   - any `SpreadAssignment` in the object degrades the WHOLE object, even if
 *     a literal `apiVersion` is also present: a later spread can overwrite it,
 *     and we do not evaluate;
 *   - `{ apiVersion }` is a `ShorthandPropertyAssignment`, NOT a
 *     `PropertyAssignment` — it names a variable we would have to follow, so
 *     it is non-literal;
 *   - identifiers, `process.env.X` and template expressions with substitutions
 *     are non-literal;
 *   - a string literal that is not a readable date (`'latest'`) is
 *     non-literal. Never guess what 'latest' resolves to.
 */
function readApiVersion(options: ObjectLiteralExpression): SiteVerdict {
  const hasSpread = options.getProperties().some((p) => Node.isSpreadAssignment(p));

  const property = options.getProperty('apiVersion');
  if (!property) return hasSpread ? { kind: 'non-literal' } : { kind: 'no-option' };
  if (!Node.isPropertyAssignment(property)) return { kind: 'non-literal' }; // shorthand, method, accessor
  if (hasSpread) return { kind: 'non-literal' };

  const initializer = property.getInitializer();
  if (!initializer) return { kind: 'non-literal' };

  const value = unwrap(initializer);
  if (!Node.isStringLiteral(value) && !Node.isNoSubstitutionTemplateLiteral(value)) {
    return { kind: 'non-literal' };
  }

  const version = value.getLiteralValue();
  if (apiVersionDate(version) === null) return { kind: 'non-literal' };

  const sourceFile = value.getSourceFile();
  const { line } = sourceFile.getLineAndColumnAtPos(value.getStart());
  return { kind: 'literal', version, filePath: sourceFile.getFilePath(), line };
}

/** The options object of a construction: strictly its SECOND argument, and only if it is an object literal. */
function verdictFor(construction: Node): SiteVerdict {
  const args = Node.isNewExpression(construction) || Node.isCallExpression(construction)
    ? construction.getArguments()
    : [];

  const second = args[1];
  if (!second) return { kind: 'no-option' };

  const options = unwrap(second);
  if (!Node.isObjectLiteralExpression(options)) return { kind: 'non-literal' };
  return readApiVersion(options);
}

/**
 * Resolves the vendor API version this project pins its client to.
 *
 * Verdict precedence, from the most to the least informative:
 *   1. at least ONE readable literal anywhere -> `'pinned'`, listing them all.
 *      A literal wins over an unreadable sibling on purpose: `'pinned'` is the
 *      only verdict that can BLOCK, so preferring it is the conservative
 *      direction. Which of the listed versions the guard compares against is
 *      the caller's decision (`oldestApiVersion`, src/changes/api-version.ts).
 *   2. a client whose `apiVersion` we could see but not read -> `'non-literal'`.
 *   3. a client with no options / no `apiVersion` key -> `'no-option'`.
 *   4. no client construction at all -> `'no-client'`.
 * Cases 2-4 all mean APPLY — blocking every repo that configures its client
 * from an environment variable would kill the tool on most real repos, and do
 * it invisibly. They are handled by DISCLOSURE in the PR body, not by blocking.
 *
 * Versions are deduplicated BY VALUE, not by site: a repo that ships a
 * compiled `.js` next to its `.ts` (the agnai shape) carries the identical
 * literal twice and must not read as "two pinned clients".
 *
 * `project` is the one `loadProject()` already built, so this costs no extra
 * parse — and inherits its exclusions (`test/**`, `dist/**`, `examples/**`...),
 * which is why an `apiVersion` in a test or an example never pollutes the
 * verdict.
 */
export function resolvePinnedApiVersion(project: Project, vendorModule: string): PinnedApiVersion {
  const versions: PinnedApiVersionSite[] = [];
  const seenVersions = new Set<string>();
  let sawNonLiteral = false;
  let sawClient = false;

  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant((node) => {
      if (!isVendorClientConstruction(node, vendorModule)) return;
      sawClient = true;

      const verdict = verdictFor(node);
      if (verdict.kind === 'non-literal') { sawNonLiteral = true; return; }
      if (verdict.kind === 'no-option') return;

      if (seenVersions.has(verdict.version)) return;
      seenVersions.add(verdict.version);
      versions.push({ version: verdict.version, filePath: verdict.filePath, line: verdict.line });
    });
  }

  if (versions.length > 0) return { status: 'pinned', source: 'ast-client-option', versions };
  if (sawNonLiteral) return { status: 'unresolved', reason: 'non-literal' };
  if (sawClient) return { status: 'unresolved', reason: 'no-option' };
  return { status: 'unresolved', reason: 'no-client' };
}
