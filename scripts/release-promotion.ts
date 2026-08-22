import { isDeepStrictEqual } from "node:util";

export interface AcceptanceRunIdentity {
  workflow: string;
  runId: string;
  attempt: number;
}

interface PromotionInput {
  version: string;
  commit: string;
  candidateTag: string;
  artifactDigests: Record<string, string>;
  acceptanceRun: AcceptanceRunIdentity;
  previousPointerDigest: string | null;
  finalPointerDigest: string;
  promotedAt: string;
}

export interface ProductPromotionInput extends PromotionInput {
  packageName: string;
  npmIntegrity: string;
  finalDistTag: string;
  temporaryDistTag: string;
}

export interface DesktopPromotionInput extends PromotionInput {}

export interface PromotionRecord {
  schemaVersion: 1;
  channel: "product" | "desktop";
  version: string;
  commit: string;
  candidateTag: string;
  artifactDigests: Record<string, string>;
  acceptanceRun: AcceptanceRunIdentity;
  previousPointerDigest: string | null;
  finalPointerDigest: string;
  promotedAt: string;
}

export interface CandidateReleaseState {
  exists: boolean;
  prerelease: boolean;
  artifactDigests: Record<string, string>;
}

interface PromotionState {
  candidateRelease: CandidateReleaseState;
  pointerDigest: string | null;
  promotionRecord: PromotionRecord | null;
}

export interface ProductPromotionState extends PromotionState {
  npmVersionIntegrity: string | null;
  finalDistTagVersion: string | null;
  temporaryDistTagVersion: string | null;
  verifiedFinalDistTagVersion: string | null;
  verifiedPointerDigest: string | null;
}

export interface DesktopPromotionState extends PromotionState {
  verifiedPointerDigest: string | null;
}

export type ProductPromotionAction =
  | {
      type: "set-npm-dist-tag";
      packageName: string;
      version: string;
      distTag: string;
    }
  | { type: "promote-product-release"; candidateTag: string }
  | {
      type: "update-product-pointer";
      candidateTag: string;
      expectedPreviousDigest: string | null;
      finalDigest: string;
    }
  | {
      type: "verify-product-promotion";
      packageName: string;
      version: string;
      distTag: string;
      pointerDigest: string;
    }
  | { type: "remove-temporary-npm-dist-tag"; packageName: string; distTag: string }
  | { type: "write-promotion-record"; filename: "promotion.json"; record: PromotionRecord };

export type DesktopPromotionAction =
  | { type: "promote-desktop-release"; candidateTag: string }
  | {
      type: "update-desktop-pointer";
      candidateTag: string;
      expectedPreviousDigest: string | null;
      finalDigest: string;
    }
  | {
      type: "verify-desktop-promotion";
      version: string;
      pointerDigest: string;
    }
  | { type: "write-promotion-record"; filename: "promotion.json"; record: PromotionRecord };

export function buildPromotionRecord(
  channel: "product" | "desktop",
  input: PromotionInput
): PromotionRecord {
  return {
    schemaVersion: 1,
    channel,
    version: input.version,
    commit: input.commit,
    candidateTag: input.candidateTag,
    artifactDigests: input.artifactDigests,
    acceptanceRun: input.acceptanceRun,
    previousPointerDigest: input.previousPointerDigest,
    finalPointerDigest: input.finalPointerDigest,
    promotedAt: input.promotedAt,
  };
}

function assertCandidateRelease(
  expectedDigests: Record<string, string>,
  release: CandidateReleaseState
): void {
  if (!release.exists) throw new Error("Accepted immutable candidate release does not exist");
  const expectedNames = Object.keys(expectedDigests).sort();
  const actualNames = Object.keys(release.artifactDigests).sort();
  if (
    !isDeepStrictEqual(expectedNames, actualNames) ||
    expectedNames.some((name) => expectedDigests[name] !== release.artifactDigests[name])
  ) {
    throw new Error("Immutable candidate release artifact digest does not match acceptance");
  }
}

function assertPointerState(input: PromotionInput, pointerDigest: string | null): void {
  if (pointerDigest !== input.finalPointerDigest && pointerDigest !== input.previousPointerDigest) {
    throw new Error("Stable pointer digest changed after acceptance");
  }
}

function assertPromotionRecord(expected: PromotionRecord, actual: PromotionRecord | null): void {
  if (actual && !isDeepStrictEqual(actual, expected)) {
    throw new Error("Existing promotion.json does not match the accepted promotion identity");
  }
}

export function planProductPromotion(
  input: ProductPromotionInput,
  state: ProductPromotionState
): ProductPromotionAction[] {
  if (state.npmVersionIntegrity !== input.npmIntegrity) {
    throw new Error("npm candidate integrity does not match the accepted Product package");
  }
  if (state.temporaryDistTagVersion !== null && state.temporaryDistTagVersion !== input.version) {
    throw new Error("Temporary npm dist-tag points to a different immutable version");
  }
  assertCandidateRelease(input.artifactDigests, state.candidateRelease);
  assertPointerState(input, state.pointerDigest);
  const record = buildPromotionRecord("product", input);
  assertPromotionRecord(record, state.promotionRecord);

  const actions: ProductPromotionAction[] = [];
  if (state.finalDistTagVersion !== input.version) {
    actions.push({
      type: "set-npm-dist-tag",
      packageName: input.packageName,
      version: input.version,
      distTag: input.finalDistTag,
    });
  }
  if (state.candidateRelease.prerelease) {
    actions.push({ type: "promote-product-release", candidateTag: input.candidateTag });
  }
  if (state.pointerDigest !== input.finalPointerDigest) {
    actions.push({
      type: "update-product-pointer",
      candidateTag: input.candidateTag,
      expectedPreviousDigest: input.previousPointerDigest,
      finalDigest: input.finalPointerDigest,
    });
  }
  if (
    state.verifiedFinalDistTagVersion !== input.version ||
    state.verifiedPointerDigest !== input.finalPointerDigest
  ) {
    actions.push({
      type: "verify-product-promotion",
      packageName: input.packageName,
      version: input.version,
      distTag: input.finalDistTag,
      pointerDigest: input.finalPointerDigest,
    });
  }
  if (state.temporaryDistTagVersion === input.version) {
    actions.push({
      type: "remove-temporary-npm-dist-tag",
      packageName: input.packageName,
      distTag: input.temporaryDistTag,
    });
  }
  if (!state.promotionRecord) {
    actions.push({ type: "write-promotion-record", filename: "promotion.json", record });
  }
  return actions;
}

export function planDesktopPromotion(
  input: DesktopPromotionInput,
  state: DesktopPromotionState
): DesktopPromotionAction[] {
  assertCandidateRelease(input.artifactDigests, state.candidateRelease);
  assertPointerState(input, state.pointerDigest);
  const record = buildPromotionRecord("desktop", input);
  assertPromotionRecord(record, state.promotionRecord);

  const actions: DesktopPromotionAction[] = [];
  if (state.candidateRelease.prerelease) {
    actions.push({ type: "promote-desktop-release", candidateTag: input.candidateTag });
  }
  if (state.pointerDigest !== input.finalPointerDigest) {
    actions.push({
      type: "update-desktop-pointer",
      candidateTag: input.candidateTag,
      expectedPreviousDigest: input.previousPointerDigest,
      finalDigest: input.finalPointerDigest,
    });
  }
  if (state.verifiedPointerDigest !== input.finalPointerDigest) {
    actions.push({
      type: "verify-desktop-promotion",
      version: input.version,
      pointerDigest: input.finalPointerDigest,
    });
  }
  if (!state.promotionRecord) {
    actions.push({ type: "write-promotion-record", filename: "promotion.json", record });
  }
  return actions;
}
