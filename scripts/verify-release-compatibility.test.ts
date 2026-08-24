import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalSigningPayload } from "../packages/desktop/src/signed-json.js";
import { parseCompatibilityDesktopChannel } from "./verify-release-compatibility.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function signChannel<T extends object>(
  value: T
): T & {
  signature: { algorithm: "ed25519"; value: string };
} {
  return {
    ...value,
    signature: {
      algorithm: "ed25519",
      value: sign(null, canonicalSigningPayload(value), privateKey).toString("base64"),
    },
  };
}

describe("verify release compatibility desktop parsing", () => {
  it("accepts the legacy stable Desktop channel used by current releases", () => {
    const legacyChannel = signChannel({
      schemaVersion: 1,
      channel: "stable",
      releaseTag: "desktop-v0.1.3",
      generatedAt: "2026-08-21T14:13:55.000Z",
      shell: {
        version: "0.1.3",
        publishedAt: "2026-08-21T14:13:55.000Z",
        updaterMetadata: "modern.yml",
        engineVersion: "2",
        nodeVersion: "24.19.0",
        runtimeHostApiVersion: 1,
        apiProtocolVersion: 1,
        dataSchemaVersion: 1,
      },
      runtimes: {
        "win32-x64": {
          version: "0.5.12",
          publishedAt: "2026-08-21T14:13:55.000Z",
          manifest: "coder-studio-runtime-modern-win32-x64.manifest.json",
        },
        "linux-x64": {
          version: "0.5.12",
          publishedAt: "2026-08-21T14:13:55.000Z",
          manifest: "coder-studio-server-runtime-modern-linux-x64.manifest.json",
        },
      },
    });

    expect(parseCompatibilityDesktopChannel(legacyChannel, publicKeyPem)).toMatchObject({
      releaseTag: "desktop-v0.1.3",
      version: "0.1.3",
      shell: {
        version: "0.1.3",
        engineVersion: "2",
        nodeVersion: "24.19.0",
        runtimeHostApiVersion: 1,
        apiProtocolVersion: 1,
        dataSchemaVersion: 1,
      },
    });
  });

  it("rejects a channel whose signed payload no longer matches", () => {
    const channel = signChannel({
      schemaVersion: 1,
      channel: "stable",
      releaseTag: "desktop-v0.1.3",
      generatedAt: "2026-08-21T14:13:55.000Z",
      shell: {
        version: "0.1.3",
        publishedAt: "2026-08-21T14:13:55.000Z",
        updaterMetadata: "modern.yml",
        engineVersion: "2",
        nodeVersion: "24.19.0",
        runtimeHostApiVersion: 1,
        apiProtocolVersion: 1,
        dataSchemaVersion: 1,
      },
      runtimes: {
        "win32-x64": {
          version: "0.5.12",
          publishedAt: "2026-08-21T14:13:55.000Z",
          manifest: "coder-studio-runtime-modern-win32-x64.manifest.json",
        },
        "linux-x64": {
          version: "0.5.12",
          publishedAt: "2026-08-21T14:13:55.000Z",
          manifest: "coder-studio-server-runtime-modern-linux-x64.manifest.json",
        },
      },
    });

    expect(() =>
      parseCompatibilityDesktopChannel({ ...channel, releaseTag: "desktop-v0.1.4" }, publicKeyPem)
    ).toThrow("Desktop channel signature is invalid");
  });
});
