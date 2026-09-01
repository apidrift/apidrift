/**
 * A generic `find()`, driven entirely by `Change.target.symbol`, for changes
 * that have no hand-written codemod — the case for everything the detection
 * poller (`src/detection/`) emits. Wrapped with no `apply()`, so the pipeline
 * always routes these through the AI fixer (tier 2): see
 * src/fixer/index.ts and the "qui_produit_le_fix" section of the US-2 DoR.
 *
 * This does NOT replace `stripe-charges-to-intents.ts` or
 * `stripe-subscription-current-period-to-items.ts` — those stay hand-written
 * (tier 1, the deterministic reference). This module only serves changes with
 * no codemod, and only forme #1 changes (the symbol IS the call being edited)
 * are ever handed to it — forme #2 changes are filtered out before reaching
 * here (see src/detection/stripe-changelog.ts's discriminant).
 *
 * ## The safety-critical part: root resolution
 * The two hand-written find()s only look at the LAST TWO segments of
 * `target.symbol` (e.g. `charges`/`create`) and never check what the
 * receiver's root resolves to — `db.subscriptions.retrieve(id)` matches
 * `stripe.subscriptions.retrieve` today. That is tolerable for two symbols a
 * human chose and reviewed (US-5 AC3). It is NOT tolerable here: a symbol
 * emitted by a markdown poller is not human-reviewed, and generic Stripe
 * method names (`prices.create`, `customers.update`, `sessions.create`) would
 * false-positive on code from a completely different domain
 * (`db.prices.create()`, `redis.sessions.create()`) and hand it to the AI
 * fixer with a Stripe migration prompt. So this matcher additionally requires
 * the ROOT of the call chain to resolve — via the AST/language service, not
 * by name — to the vendor's module:
 *   - `new Stripe(...)` where `Stripe` is imported (default, named, or
 *     namespace) from the vendor's npm package, or
 *   - `require('<vendor>')(...)` called directly,
 *   - either bound to a plain identifier (`const stripe = ...`,
 *     `const stripeClient = ...`) or assigned to `this.<prop>`
 *     (`this.stripe = new Stripe(...)`).
 * A root that resolves to anything else, or to nothing resolvable at all
 * (e.g. a function parameter with no traceable initializer), does NOT match —
 * fail closed, never "match anyway". A false negative costs an unopened PR; a
 * false positive edits code with no relationship to the vendor.
 *
 * Deliberately NOT handled (documented gaps, not silent bugs):
 *   - reassignment (`let stripe = ...; stripe = somethingElse;`) — same gap
 *     US-5 AC2 tracks for the hand-written codemods;
 *   - destructured `const { Stripe } = require('vendor')` factories;
 *   - resolving a `this.<prop>` root through more than one class level, or
 *     through a property whose only definition is a TS type/interface (would
 *     need `node_modules`' types, which this project doesn't require).
 * All of these resolve to "no match", per the fail-closed rule above.
 */
import { Node, SyntaxKind } from 'ts-morph';
import type { Identifier, Project } from 'ts-morph';
import type { Change, Codemod, Match } from '../types.js';

/** `require('<moduleName>')` */
function isRequireCall(node: Node, moduleName: string): boolean {
  if (!Node.isCallExpression(node)) return false;
  const callee = node.getExpression();
  if (!Node.isIdentifier(callee) || callee.getText() !== 'require') return false;
  const [arg] = node.getArguments();
  return !!arg && Node.isStringLiteral(arg) && arg.getLiteralValue() === moduleName;
}

/** `require('<moduleName>')(...)` — the CommonJS factory-call shape. */
function isVendorFactoryCall(node: Node, moduleName: string): boolean {
  if (!Node.isCallExpression(node)) return false;
  return isRequireCall(node.getExpression(), moduleName);
}

/** Does `id`'s declaration trace back to an `import ... from '<moduleName>'`? */
function identifierImportedFromModule(id: Identifier, moduleName: string): boolean {
  const symbol = id.getSymbol();
  if (!symbol) return false;
  for (const decl of symbol.getDeclarations()) {
    const importDecl = decl.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    if (importDecl && importDecl.getModuleSpecifierValue() === moduleName) return true;
  }
  return false;
}

/** `new Stripe(...)` where `Stripe` is imported from `moduleName`. */
function isVendorConstructor(node: Node, moduleName: string): boolean {
  if (!Node.isNewExpression(node)) return false;
  const ctor = node.getExpression();
  return Node.isIdentifier(ctor) && identifierImportedFromModule(ctor, moduleName);
}

/** Does this initializer expression resolve to the vendor module (factory call or constructor)? */
function initializerResolvesToVendor(init: Node, moduleName: string): boolean {
  return isVendorFactoryCall(init, moduleName) || isVendorConstructor(init, moduleName);
}

/** `this.<propName>` assigned (as a class property initializer, or `this.x = ...` in a method) to the vendor module. */
function resolveThisPropertyToVendor(propName: string, fromNode: Node, moduleName: string): boolean {
  const classDecl = fromNode.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  if (!classDecl) return false;

  for (const prop of classDecl.getProperties()) {
    if (prop.getName() === propName) {
      const init = prop.getInitializer();
      if (init && initializerResolvesToVendor(init, moduleName)) return true;
    }
  }

  let resolved = false;
  classDecl.forEachDescendant((node, traversal) => {
    if (resolved) { traversal.stop(); return; }
    if (!Node.isBinaryExpression(node)) return;
    if (node.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return;
    const left = node.getLeft();
    if (!Node.isPropertyAccessExpression(left)) return;
    if (!Node.isThisExpression(left.getExpression())) return;
    if (left.getName() !== propName) return;
    if (initializerResolvesToVendor(node.getRight(), moduleName)) resolved = true;
  });
  return resolved;
}

/** Does the identifier's own variable declaration resolve to the vendor module? */
function resolveIdentifierToVendor(id: Identifier, moduleName: string): boolean {
  const symbol = id.getSymbol();
  if (!symbol) return false;
  for (const decl of symbol.getDeclarations()) {
    if (Node.isVariableDeclaration(decl)) {
      const init = decl.getInitializer();
      if (init && initializerResolvesToVendor(init, moduleName)) return true;
    }
  }
  return false;
}

/**
 * Resolves the ROOT of a call chain (the leftmost expression) to the vendor
 * module, or refuses. `root` is whatever `matchesSuffix` peeled the target
 * symbol's segments off of.
 */
function resolveRootToVendor(root: Node, moduleName: string): boolean {
  if (Node.isIdentifier(root)) return resolveIdentifierToVendor(root, moduleName);
  if (Node.isCallExpression(root)) return isVendorFactoryCall(root, moduleName); // require('stripe')(key).x.y()
  if (Node.isNewExpression(root)) return isVendorConstructor(root, moduleName); // new Stripe(key).x.y()
  if (Node.isPropertyAccessExpression(root) && Node.isThisExpression(root.getExpression())) {
    return resolveThisPropertyToVendor(root.getName(), root, moduleName);
  }
  return false; // unresolvable root: fail closed, never match "just in case"
}

/**
 * Walks a property-access chain backward against `segments` (e.g.
 * `["paymentIntents", "confirm"]`), returning whatever expression remains
 * once every segment has matched, or `null` on any mismatch.
 */
function matchesSuffix(expr: Node, segments: string[]): Node | null {
  let current = expr;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!Node.isPropertyAccessExpression(current)) return null;
    if (current.getName() !== segments[i]) return null;
    current = current.getExpression();
  }
  return current;
}

/**
 * Builds a `find()` for `symbol` (e.g. `"stripe.paymentIntents.confirm"`),
 * matching `<root>.<namespace...>.<method>(...)` calls whose root resolves to
 * `vendorModule` (see module doc). The leading segment of `symbol` (`stripe`)
 * is a label, not matched against source text — only the AST-resolved root
 * matters.
 */
export function createSymbolMatcher(symbol: string, vendorModule: string): (project: Project) => Match[] {
  const segments = symbol.split('.').slice(1);

  return function find(project: Project): Match[] {
    const matches: Match[] = [];

    for (const sourceFile of project.getSourceFiles()) {
      sourceFile.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return;

        const callee = node.getExpression();
        const root = matchesSuffix(callee, segments);
        if (!root) return;
        if (!resolveRootToVendor(root, vendorModule)) return;

        const { line } = sourceFile.getLineAndColumnAtPos(node.getStart());
        matches.push({
          filePath: sourceFile.getFilePath(),
          line,
          snippet: node.getText().split('\n')[0].trim(),
          node,
        });
      });
    }

    return matches;
  };
}

/**
 * Wraps a detected `Change` (forme #1 only — callers must filter forme #2 out
 * before this point) into a `Codemod` with a generic `find()` and no
 * `apply()`, so the pipeline routes it to the AI fixer.
 */
export function genericSymbolCodemod(change: Change): Codemod {
  if (change.target.type !== 'symbol' || !change.target.symbol) {
    return { change, find: () => [] };
  }
  return { change, find: createSymbolMatcher(change.target.symbol, change.vendor) };
}
