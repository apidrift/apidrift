/**
 * A single stable entry point onto the two halves of "what changed and does
 * it apply to me" that already exist but do not talk to each other (US-12):
 *
 *   - Q1/Q3, WHAT the vendor publishes and what `Change`s that implies —
 *     `src/detection/index.ts` (I/O) + `./stripe-changelog.ts` (pure parse).
 *   - Q2, WHICH API version THIS repo actually runs on — US-7's
 *     `resolveAstClientOption` (the pin a human wrote) folded with US-9's
 *     `resolveInstalledSdkDefaultApiVersion` (the pin the installed SDK
 *     imposes) by `resolvePinnedApiVersion`, all in `../matcher/api-version.ts`.
 *
 * Types + interface ONLY. Zero I/O, zero ts-morph at runtime: the `Project`
 * and `PinnedApiVersion` imports below are `import type`, erased at compile
 * time — same convention `../types.ts` already uses for `PinnedApiVersion`.
 * The one implementation lives in `./stripe-source.ts`.
 *
 * ## Why one interface with three methods, not three free functions
 * Before this, `changesSince` (the Q3 half) took an explicit `--release` the
 * USER had to type by hand — nothing connected it to what the repo's
 * installed SDK / client construction (Q2) actually pins to. Bundling the
 * three questions behind one object makes it structurally impossible to call
 * `changesSince()` without having resolved the lower bound first: the
 * coupling IS the deliverable, not an abstraction for its own sake.
 *
 * ## AC2 — no vendor registry
 * There is exactly one implementation. `vendorSourceFor` (in
 * `./stripe-source.ts`) is the only place a `vendor` string is compared
 * against anything, and it exists purely to THROW a named error for anything
 * that is not `'stripe'` — never to select among implementations. If a second
 * `vendor` parameter shows up anywhere else in this module or its sibling,
 * that is the multi-vendor scope creep CLAUDE.md forbids.
 */
import type { Project } from 'ts-morph';
import type { PinnedApiVersion } from '../matcher/api-version.js';
import type { Change } from '../types.js';
import type { ChangelogEntry, DetectedChange } from './stripe-changelog.js';

/** Every index row published under one `## <date>[.<channel>]` heading, Q1, unfiltered — exactly what `parseChangelogIndex` returns, grouped. */
export interface VendorRelease {
  /** Verbatim heading value, e.g. `'2026-08-26.preview'` or `'2023-08-16'` (channel-less releases — US-12, P0 constat 2). */
  release: string;
  entries: ChangelogEntry[];
}

/**
 * One release `changesSince` could not read — a page that failed to fetch or
 * parse, kept NAMED and separate from "this release had zero changes".
 *
 * This is the central field of `VendorDiff` (US-12 DoR, D1): without it,
 * `autoExecutable: []` cannot be told apart from "we fetched N pages and
 * could read none of them" — a real, HTTP-200 scenario (US-12 P0 constat 3).
 * The other half of the same invariant is `PinnedApiVersion`'s `unresolved`
 * reasons (US-9): a "could not look" must never render as "there is nothing
 * there", on either side of this interface.
 */
export interface VendorDiffGap {
  /** The release this gap belongs to, verbatim. */
  release: string;
  /** Why we could not read this release's changes — the underlying fetch/parse error's message, never swallowed. */
  reason: string;
}

/**
 * What changed for this vendor strictly after `from`, up to the latest
 * release on the SAME channel line.
 */
export interface VendorDiff {
  /** The lower bound, verbatim, EXCLUDED. */
  from: string;
  /** The latest release on `from`'s channel line — independent of whether every release up to it was readable (see `gaps`). */
  to: string;
  /** Every release strictly between `from` (excluded) and `to` (included), same channel line, chronological ascending — the full intended walk path, whether or not each one was readable. */
  releases: string[];
  /** Forme #1 (request-shaped) changes, safe to hand to `RunOptions.codemods` via the generic matcher. Never a `Codemod` — see `src/matcher/symbol.ts`'s `genericSymbolCodemod`, which is what turns one of these into a `find()`. */
  autoExecutable: Change[];
  /** Forme #2 (response-shaped) changes: detected, never auto-executable. */
  reportOnly: DetectedChange[];
  /** Named holes in the walk — see `VendorDiffGap`. */
  gaps: VendorDiffGap[];
}

/**
 * Answers, for one vendor, the three questions US-12 exists to connect.
 * There is exactly one implementation (`./stripe-source.ts`); see AC2 above
 * for why this is not a place to imagine a second one.
 */
export interface VendorSource {
  readonly vendor: 'stripe';
  /** Q1 — what the vendor publishes NOW: the full release line, as parsed from the index. */
  releases(): Promise<VendorRelease[]>;
  /**
   * Q2 — the API version THIS repo actually runs on. Pure delegation to
   * `resolvePinnedApiVersion` (US-7/US-9) — no logic of its own.
   *
   * `projectRoot` is the WORKSPACE root passed straight through to
   * `resolvePinnedApiVersion`, so `PinnedApiVersionSite.filePath` on the
   * result is ABSOLUTE, exactly like that function's own contract (see
   * `src/pipeline.ts`, which relativizes with `path.relative` before any
   * display). Callers of THIS method must do the same — this is the US-11
   * leak, and resolving it here would just move the leak, not close it.
   */
  resolveCurrentApiVersion(project: Project, projectRoot: string): PinnedApiVersion;
  /** Q3 — the changes that follow from `from` (excluded) up to the latest release on the same channel line. */
  changesSince(from: string): Promise<VendorDiff>;
}
