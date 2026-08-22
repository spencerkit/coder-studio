import { describe, expect, it } from "vitest";
import {
  buildPromotionRecord,
  type DesktopPromotionInput,
  type DesktopPromotionState,
  type ProductPromotionInput,
  type ProductPromotionState,
  planDesktopPromotion,
  planProductPromotion,
} from "./release-promotion.js";

const previousPointerDigest = "a".repeat(64);
const finalPointerDigest = "b".repeat(64);
const artifactDigests = {
  "product-channel.json": finalPointerDigest,
  "windows-runtime.tgz": "c".repeat(64),
  "wsl-runtime.tgz": "d".repeat(64),
};

const productInput: ProductPromotionInput = {
  version: "0.6.0",
  commit: "1234567890abcdef",
  candidateTag: "v0.6.0",
  artifactDigests,
  acceptanceRun: { workflow: "product-release", runId: "42", attempt: 2 },
  previousPointerDigest,
  finalPointerDigest,
  promotedAt: "2026-08-22T08:09:10.000Z",
  packageName: "@spencer-kit/coder-studio",
  npmIntegrity: "sha512-candidate",
  finalDistTag: "latest",
  temporaryDistTag: "rc-42-2",
};

function productState(overrides: Partial<ProductPromotionState> = {}): ProductPromotionState {
  return {
    npmVersionIntegrity: productInput.npmIntegrity,
    finalDistTagVersion: "0.5.0",
    temporaryDistTagVersion: productInput.version,
    candidateRelease: {
      exists: true,
      prerelease: true,
      artifactDigests: productInput.artifactDigests,
    },
    pointerDigest: productInput.previousPointerDigest,
    verifiedFinalDistTagVersion: null,
    verifiedPointerDigest: null,
    promotionRecord: null,
    ...overrides,
  };
}

describe("Product promotion planner", () => {
  it("orders npm, versioned release, pointer, verification, cleanup, and record actions", () => {
    expect(planProductPromotion(productInput, productState()).map((action) => action.type)).toEqual(
      [
        "set-npm-dist-tag",
        "promote-product-release",
        "update-product-pointer",
        "verify-product-promotion",
        "remove-temporary-npm-dist-tag",
        "write-promotion-record",
      ]
    );
  });

  it("returns only remaining actions and becomes idempotently empty", () => {
    const record = buildPromotionRecord("product", productInput);
    expect(
      planProductPromotion(
        productInput,
        productState({
          finalDistTagVersion: productInput.version,
          temporaryDistTagVersion: null,
          candidateRelease: {
            exists: true,
            prerelease: false,
            artifactDigests: productInput.artifactDigests,
          },
          pointerDigest: productInput.finalPointerDigest,
          verifiedFinalDistTagVersion: productInput.version,
          verifiedPointerDigest: productInput.finalPointerDigest,
          promotionRecord: record,
        })
      )
    ).toEqual([]);

    expect(
      planProductPromotion(
        productInput,
        productState({
          finalDistTagVersion: productInput.version,
          candidateRelease: {
            exists: true,
            prerelease: false,
            artifactDigests: productInput.artifactDigests,
          },
        })
      ).map((action) => action.type)
    ).toEqual([
      "update-product-pointer",
      "verify-product-promotion",
      "remove-temporary-npm-dist-tag",
      "write-promotion-record",
    ]);
  });

  it("stops when npm or immutable release bytes do not match acceptance", () => {
    expect(() =>
      planProductPromotion(productInput, productState({ npmVersionIntegrity: "sha512-other" }))
    ).toThrow(/npm.*integrity.*accepted/i);
    expect(() =>
      planProductPromotion(
        productInput,
        productState({
          candidateRelease: {
            exists: true,
            prerelease: true,
            artifactDigests: { ...artifactDigests, "wsl-runtime.tgz": "e".repeat(64) },
          },
        })
      )
    ).toThrow(/immutable.*digest/i);
  });
});

const desktopInput: DesktopPromotionInput = {
  version: "0.3.0",
  commit: "fedcba0987654321",
  candidateTag: "desktop-v0.3.0",
  artifactDigests: {
    "desktop-channel.json": finalPointerDigest,
    "Coder-Studio-Setup-0.3.0.exe": "e".repeat(64),
    "coder-studio-engine-2-linux-x64.tgz": "f".repeat(64),
    "factory-runtime": "1".repeat(64),
  },
  acceptanceRun: { workflow: "desktop-release", runId: "84", attempt: 1 },
  previousPointerDigest,
  finalPointerDigest,
  promotedAt: "2026-08-22T08:10:11.000Z",
};

function desktopState(overrides: Partial<DesktopPromotionState> = {}): DesktopPromotionState {
  return {
    candidateRelease: {
      exists: true,
      prerelease: true,
      artifactDigests: desktopInput.artifactDigests,
    },
    pointerDigest: desktopInput.previousPointerDigest,
    verifiedPointerDigest: null,
    promotionRecord: null,
    ...overrides,
  };
}

describe("Desktop promotion planner", () => {
  it("orders versioned release, pointer, verification, and record actions", () => {
    expect(planDesktopPromotion(desktopInput, desktopState()).map((action) => action.type)).toEqual(
      [
        "promote-desktop-release",
        "update-desktop-pointer",
        "verify-desktop-promotion",
        "write-promotion-record",
      ]
    );
  });

  it("is empty after the accepted Desktop bytes and pointer are fully promoted", () => {
    const record = buildPromotionRecord("desktop", desktopInput);
    expect(
      planDesktopPromotion(
        desktopInput,
        desktopState({
          candidateRelease: {
            exists: true,
            prerelease: false,
            artifactDigests: desktopInput.artifactDigests,
          },
          pointerDigest: desktopInput.finalPointerDigest,
          verifiedPointerDigest: desktopInput.finalPointerDigest,
          promotionRecord: record,
        })
      )
    ).toEqual([]);
  });

  it("stops on an immutable Desktop digest or unexpected pointer", () => {
    expect(() =>
      planDesktopPromotion(
        desktopInput,
        desktopState({
          candidateRelease: {
            exists: true,
            prerelease: true,
            artifactDigests: {
              ...desktopInput.artifactDigests,
              "factory-runtime": "2".repeat(64),
            },
          },
        })
      )
    ).toThrow(/immutable.*digest/i);
    expect(() =>
      planDesktopPromotion(desktopInput, desktopState({ pointerDigest: "3".repeat(64) }))
    ).toThrow(/pointer.*digest/i);
  });
});

describe("promotion record", () => {
  it("records accepted identity and before/after pointer digests", () => {
    expect(buildPromotionRecord("product", productInput)).toEqual({
      schemaVersion: 1,
      channel: "product",
      version: productInput.version,
      commit: productInput.commit,
      candidateTag: productInput.candidateTag,
      artifactDigests: productInput.artifactDigests,
      acceptanceRun: productInput.acceptanceRun,
      previousPointerDigest,
      finalPointerDigest,
      promotedAt: productInput.promotedAt,
    });
  });
});
