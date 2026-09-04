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
 * ## The second source (US-9)
 * The client option is only the pin a human WROTE. Since stripe-node v12 the
 * SDK also pins IMPLICITLY, to the API version current at its own release, so
 * "no apiVersion in the source" does NOT mean "latest". That second source is
 * read by `./installed-sdk.ts` and folded in by `resolvePinnedApiVersion`
 * below; the `source` discriminant was placed here in US-7 precisely so it
 * could arrive without changing a single caller — and it did.
 *
 * ## Explicitly out of scope
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
import { resolveInstalledSdkDefaultApiVersion } from './installed-sdk.js';
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
 * What the CLIENT-OPTION reader alone can establish — the US-7 verdict set,
 * unchanged.
 */
export type AstClientOptionApiVersion =
  | { status: 'pinned'; source: 'ast-client-option'; versions: PinnedApiVersionSite[] }
  | { status: 'unresolved'; reason: 'no-client' | 'no-option' | 'non-literal' };

/**
 * Why we could not name a pinned version. Six reasons, deliberately NOT
 * collapsed: three describe the target's SOURCE (US-7), three the installed
 * SDK (US-9), and each maps to a different sentence to a human. Merging
 * "we could not look" with "we looked and found nothing" is the exact
 * regression US-9 exists to prevent.
 */
export type UnresolvedPinReason =
  /** No vendor client construction found in the source. */
  | 'no-client'
  /** A client, but no `apiVersion` key on it. */
  | 'no-option'
  /** An `apiVersion` we can see but not read statically (env var, variable, spread, `'latest'`). */
  | 'non-literal'
  /** No `node_modules/<vendor>`: an uninstalled clone. WE DID NOT LOOK. */
  | 'sdk-not-installed'
  /** Installed major <= 11: the SDK sends no version header, the ACCOUNT default applies. */
  | 'sdk-predates-implicit-pin'
  /** The package is there but its version / generated `apiVersion.js` is unreadable. */
  | 'sdk-version-unreadable';

/**
 * What we could establish about the target's pinned API version.
 *
 * `source` was present from day one (US-7) so that a second source could slot
 * in as another variant without changing the shape callers destructure. US-9
 * is that second source, and it kept the promise: both `pinned` variants carry
 * the SAME `versions` array, so `pipeline.ts` and `pr.ts` still read
 * `.versions` with no branching on `source` — they branch on it only to NAME
 * the source to a human, which is the point.
 */
export type PinnedApiVersion =
  | { status: 'pinned'; source: 'ast-client-option'; versions: PinnedApiVersionSite[] }
  | {
      status: 'pinned';
      source: 'installed-sdk-default';
      /** The installed package version that carries this default (`'13.0.0'`). */
      sdkVersion: string;
      versions: PinnedApiVersionSite[];
    }
  | {
      status: 'unresolved';
      reason: UnresolvedPinReason;
      /** Present only when we got far enough to read it. Disclosure only. */
      sdkVersion?: string;
    };

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
 * Reads the vendor API version this project's SOURCE pins its client to — the
 * explicit pin, and nothing else. This is the US-7 resolver, extracted
 * verbatim so that US-9 could add a second source above it without touching a
 * line of its logic; the US-7 tests point straight at it.
 *
 * Exported for those tests and for that reason only: production code goes
 * through `resolvePinnedApiVersion`, which is the one that also consults the
 * implicit pin. Calling this directly re-opens the hole US-9 closed.
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
export function resolveAstClientOption(project: Project, vendorModule: string): AstClientOptionApiVersion {
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

/**
 * Resolves the vendor API version this project runs on, from BOTH sources —
 * the pin a human wrote and the pin the installed SDK imposes (US-9).
 *
 * ## Precedence, read off the SDK itself
 * stripe-node's core does `version: props.apiVersion || DEFAULT_API_VERSION`,
 * and this mirrors it exactly:
 *   - `'pinned'` (an explicit literal) -> returned as-is. The explicit pin
 *     wins, because at runtime it does.
 *   - `'non-literal'` -> returned as-is. The code DOES set `apiVersion`, to
 *     something we cannot read; it therefore overwrites the SDK default, so
 *     reading that default would be reporting a version that never applies.
 *   - `'no-client'` AND `'no-option'` -> consult the installed SDK. `no-option`
 *     is the MAIN case (a client built with just a key): stopping at
 *     `no-client` would miss nearly every repo this exists for.
 *
 * ## `projectPath` is REQUIRED, on purpose
 * Making it optional would let any future caller silently fall back to
 * source-only resolution — i.e. silently re-open the hole this closes. A
 * caller that has no path must be forced to notice.
 *
 * It is the WORKSPACE root, not the user's checkout: `linkNodeModules()` has
 * already symlinked the target's `node_modules` in, and the guard runs after.
 *
 * ## Known limitation, documented rather than hidden
 * An explicit `{ apiVersion: undefined }` is falsy to the SDK — the default
 * therefore applies — but we classify it `'non-literal'` and do not consult the
 * implicit source. Zero cases observed; disclosure covers it.
 */
export function resolvePinnedApiVersion(
  project: Project,
  vendorModule: string,
  projectPath: string,
): PinnedApiVersion {
  const explicit = resolveAstClientOption(project, vendorModule);
  if (explicit.status === 'pinned' || explicit.reason === 'non-literal') return explicit;

  const implicit = resolveInstalledSdkDefaultApiVersion(projectPath, vendorModule);
  if (implicit.status === 'resolved') {
    return {
      status: 'pinned',
      source: 'installed-sdk-default',
      sdkVersion: implicit.sdkVersion,
      // One element, same shape as the explicit variant: callers keep mapping
      // `.versions` without ever branching on `source`.
      versions: [{ version: implicit.apiVersion, filePath: implicit.filePath, line: implicit.line }],
    };
  }

  // Never emit `sdkVersion: undefined` — an own key holding `undefined` is not
  // the same object as one without it, and callers (and tests) compare deeply.
  return implicit.sdkVersion === undefined
    ? { status: 'unresolved', reason: implicit.reason }
    : { status: 'unresolved', reason: implicit.reason, sdkVersion: implicit.sdkVersion };
}
