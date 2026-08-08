import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  getRuntimeManifestSigningPayload,
  getRuntimePublishedAt,
  isSafeRuntimeRelativePath,
  parseInstalledRuntimeManifest,
  parseNetworkRuntimeManifest,
  type RuntimeManifestV1,
  type RuntimeManifestV2,
  verifyRuntimeManifestSignature,
} from "./runtime-manifest.js";

function manifest(): RuntimeManifestV1 {
  return {
    schemaVersion: 1,
    runtimeVersion: "0.5.7",
    minShellVersion: "0.5.6",
    requiredEngineVersion: "1",
    requiredNodeVersion: "24.19.0",
    runtimeHostApiVersion: 1,
    apiProtocolVersion: 1,
    dataSchemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    entrypoint: "server.mjs",
    webRoot: "web",
    files: [{ path: "server.mjs", sha256: "a".repeat(64), size: 10 }],
  };
}

describe("Runtime manifest", () => {
  it("verifies Ed25519 signatures over canonical manifest data", () => {
    const keys = generateKeyPairSync("ed25519");
    const value = manifest();
    value.signature = {
      algorithm: "ed25519",
      value: sign(null, getRuntimeManifestSigningPayload(value), keys.privateKey).toString(
        "base64"
      ),
    };
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyRuntimeManifestSignature(value, publicKey)).toBe(true);
    value.runtimeVersion = "0.5.8";
    expect(verifyRuntimeManifestSignature(value, publicKey)).toBe(false);
  });

  it("rejects traversal and absolute paths", () => {
    expect(isSafeRuntimeRelativePath("web/assets/app.js")).toBe(true);
    expect(isSafeRuntimeRelativePath("../server.mjs")).toBe(false);
    expect(isSafeRuntimeRelativePath("C:/server.mjs")).toBe(false);
    expect(isSafeRuntimeRelativePath("/server.mjs")).toBe(false);
  });

  it("validates hashed entrypoints", () => {
    const value = manifest();
    value.entrypoint = "missing.mjs";
    expect(() => parseInstalledRuntimeManifest(value)).toThrow("entrypoint is not hashed");
  });

  it("signs publishedAt and requires schema v2 for network updates", () => {
    const keys = generateKeyPairSync("ed25519");
    const value: RuntimeManifestV2 = {
      ...manifest(),
      schemaVersion: 2,
      publishedAt: "2026-08-08T01:02:03.000Z",
    };
    value.signature = {
      algorithm: "ed25519",
      value: sign(null, getRuntimeManifestSigningPayload(value), keys.privateKey).toString(
        "base64"
      ),
    };
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

    expect(parseNetworkRuntimeManifest(value).publishedAt).toBe("2026-08-08T01:02:03.000Z");
    value.publishedAt = "2026-08-09T01:02:03.000Z";
    expect(verifyRuntimeManifestSignature(value, publicKey)).toBe(false);
  });

  it("reads installed schema v1 but rejects it as a network candidate", () => {
    const legacy = manifest();

    expect(parseInstalledRuntimeManifest(legacy).schemaVersion).toBe(1);
    expect(getRuntimePublishedAt(legacy)).toBeNull();
    expect(() => parseNetworkRuntimeManifest(legacy)).toThrow("schema 2");
  });

  it.each(["", "08/08/2026", "not-a-date"])("rejects invalid release time %j", (publishedAt) => {
    expect(() =>
      parseNetworkRuntimeManifest({
        ...manifest(),
        schemaVersion: 2,
        publishedAt,
      })
    ).toThrow("publishedAt");
  });

  it("compares release versions numerically", () => {
    expect(compareVersions("0.5.10", "0.5.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});
