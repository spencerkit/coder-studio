import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  getRuntimeManifestSigningPayload,
  isSafeRuntimeRelativePath,
  parseRuntimeManifest,
  type RuntimeManifest,
  verifyRuntimeManifestSignature,
} from "./runtime-manifest.js";

function manifest(): RuntimeManifest {
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
    expect(() => parseRuntimeManifest(value)).toThrow("entrypoint is not hashed");
  });

  it("compares release versions numerically", () => {
    expect(compareVersions("0.5.10", "0.5.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});
