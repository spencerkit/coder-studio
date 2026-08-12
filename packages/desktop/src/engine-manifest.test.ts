import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type EngineManifest,
  getEngineManifestSigningPayload,
  parseEngineManifest,
  verifyEngineManifestSignature,
} from "./engine-manifest.js";

function createManifest(): EngineManifest {
  return {
    schemaVersion: 1,
    engineVersion: "1",
    nodeVersion: "24.19.0",
    platform: "linux",
    arch: "x64",
    libc: "glibc",
    packageFile: "coder-studio-engine.tgz",
    packageSha256: "a".repeat(64),
    packageSize: 42,
    files: [{ path: "bin/node", sha256: "b".repeat(64), size: 12 }],
  };
}

describe("Engine manifest", () => {
  it("parses safe Linux Engine manifests and rejects unsafe paths", () => {
    expect(parseEngineManifest(createManifest())).toEqual(createManifest());
    expect(() =>
      parseEngineManifest({
        ...createManifest(),
        files: [{ path: "../bin/node", sha256: "b".repeat(64), size: 12 }],
      })
    ).toThrow("invalid file entry");
  });

  it("verifies Ed25519 signatures over canonical manifest content", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const unsigned = createManifest();
    const manifest: EngineManifest = {
      ...unsigned,
      signature: {
        algorithm: "ed25519",
        value: sign(null, getEngineManifestSigningPayload(unsigned), privateKey).toString("base64"),
      },
    };
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    expect(verifyEngineManifestSignature(manifest, publicKeyPem)).toBe(true);
    expect(
      verifyEngineManifestSignature({ ...manifest, nodeVersion: "24.20.0" }, publicKeyPem)
    ).toBe(false);
  });
});
