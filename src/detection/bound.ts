/**
 * The LOWER BOUND of a walk when we could not read one — US-13, AC3(d), and
 * the one place that decides "do not walk blind".
 *
 * `resolvePinnedApiVersion` (US-7/US-9) already answers "which API version does
 * this repo run on", and US-12 already exposes it as
 * `VendorSource.resolveCurrentApiVersion`. What was missing is the CALLER's
 * behaviour when the answer is `unresolved`: walking anyway would mean picking
 * a bound out of thin air and editing code against it. So:
 *
 *   - ZERO fetch. There is nothing to learn from 200 KB of changelog when we
 *     have nothing to compare it to. `changesSinceBound` below makes that
 *     structural, not a convention: `source.changesSince` is not reached.
 *   - ZERO tokens, which follows: no diff, no candidate change, nothing for the
 *     fixer to be handed.
 *   - A message that says what is missing AND HOW TO SUPPLY IT. A sentence that
 *     stops at "no API version found" leaves the reader with no next move; the
 *     next move is naming the bound by hand.
 *
 * ## The six reasons stay six (US-9 D3, US-13 D2b)
 * They are not variations of "no version": "this repo has no Stripe client",
 * "we could not look because `node_modules` is absent", and "we looked, and
 * this SDK pins nothing because the ACCOUNT default applies" are three
 * different facts with three different remedies. Collapsing them is precisely
 * the regression US-9 exists to prevent, so each gets its own sentence here and
 * a test asserts the six are distinct.
 *
 * The escape hatch is named `--since <api-version>`; the flag itself lands in
 * US-14 (which retires `--release`). Naming it here, before it exists, is
 * deliberate: the sentence and the flag ship in the same release train, and a
 * message with no way out is what AC3(d) forbids.
 */
import { oldestApiVersion } from '../changes/api-version.js';
import type { PinnedApiVersion, UnresolvedPinReason } from '../matcher/api-version.js';
import type { VendorDiff, VendorSource } from './vendor-source.js';

/** Concrete, copy-pasteable, and a real heading on the live changelog. */
const SINCE_EXAMPLE = '--since 2025-03-31.basil';

const HOW_TO_SUPPLY_IT = `name the API version your integration runs on yourself: \`--since <api-version>\` (e.g. \`${SINCE_EXAMPLE}\`)`;

/**
 * One sentence per `UnresolvedPinReason`. Every one of them names the escape
 * hatch; none of them is reachable from another (a `switch` with no default,
 * so a seventh reason would fail the typecheck rather than fall into a generic
 * sentence).
 */
function sentenceFor(reason: UnresolvedPinReason, sdkVersion?: string): string {
  switch (reason) {
    case 'no-client':
      return `no Stripe client construction found in this repo — it may simply not use Stripe. If it does, ${HOW_TO_SUPPLY_IT}.`;
    case 'no-option':
      return `this repo builds a Stripe client but sets no \`apiVersion\`, and the installed SDK could not supply one either — we could NOT look up the version it runs on. Install the dependencies and re-run, or ${HOW_TO_SUPPLY_IT}.`;
    case 'non-literal':
      return `this repo sets \`apiVersion\` to something we cannot read statically (an environment variable, a computed value) — we can see it, not resolve it. To walk anyway, ${HOW_TO_SUPPLY_IT}.`;
    case 'sdk-not-installed':
      return `no \`node_modules/stripe\`: this is an uninstalled clone, so we could NOT look at the version the SDK pins. Install the dependencies and re-run, or ${HOW_TO_SUPPLY_IT}.`;
    case 'sdk-predates-implicit-pin':
      return `the installed Stripe SDK${sdkVersion ? ` (v${sdkVersion})` : ''} predates implicit pinning (v11 and earlier send no version header), so the version in force is your ACCOUNT default, set in the Stripe dashboard — it is not in this repo and no static analysis can reach it. Read it in the dashboard, then ${HOW_TO_SUPPLY_IT}.`;
    case 'sdk-version-unreadable':
      return `the Stripe package is installed but we could not read its version or its generated \`apiVersion.js\`${sdkVersion ? ` (saw: ${sdkVersion})` : ''} — an assumption of ours is broken, please report it. In the meantime, ${HOW_TO_SUPPLY_IT}.`;
  }
}

export type BoundResolution =
  | { status: 'resolved'; from: string }
  | {
      status: 'unresolved';
      reason: UnresolvedPinReason;
      /** What is missing AND how to supply it — always names `--since <api-version>`. */
      message: string;
    };

/**
 * Turns what we established about the repo's pinned version into a walkable
 * bound, or into a reason plus a way out. No I/O, no ts-morph.
 *
 * When several versions are pinned, the bound is the OLDEST — the same
 * conservative choice `src/pipeline.ts` already makes: we cannot know which
 * call site belongs to which client, so the repo may be running on any of them.
 */
export function resolveWalkBound(pinned: PinnedApiVersion): BoundResolution {
  if (pinned.status === 'unresolved') {
    return { status: 'unresolved', reason: pinned.reason, message: sentenceFor(pinned.reason, pinned.sdkVersion) };
  }

  const oldest = oldestApiVersion(pinned.versions.map((v) => v.version));
  if (oldest === undefined) {
    // Defensive: the resolver never emits a `pinned` verdict with no readable
    // version. If it ever did, "we saw something we cannot read" is the honest
    // reading, and it must NOT degrade into a blind walk.
    return { status: 'unresolved', reason: 'non-literal', message: sentenceFor('non-literal') };
  }
  return { status: 'resolved', from: oldest };
}

/**
 * The walk, gated on the bound — the function that makes "no blind walk"
 * structural rather than a rule every caller has to remember.
 *
 * `diff` is `null` if and only if the bound is unresolved, and in that case
 * `source.changesSince` is never called, so nothing is fetched at all (AC3d's
 * invariant, asserted with a counting fetcher in tests/walk.test.ts).
 */
export async function changesSinceBound(
  source: VendorSource,
  pinned: PinnedApiVersion,
): Promise<{ bound: BoundResolution; diff: VendorDiff | null }> {
  const bound = resolveWalkBound(pinned);
  if (bound.status === 'unresolved') return { bound, diff: null };
  return { bound, diff: await source.changesSince(bound.from) };
}
