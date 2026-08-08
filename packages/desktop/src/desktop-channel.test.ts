import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type DesktopChannel,
  parseDesktopChannel,
  resolveChannelAsset,
} from "./desktop-channel.js";
import { canonicalSigningPayload } from "./signed-json.js";

function signedChannel(): { channel: DesktopChannel; publicKeyPem: string } {
  const keys = generateKeyPairSync("ed25519");
  const unsigned = {
    schemaVersion: 1 as const,
    channel: "stable" as const,
    releaseTag: "desktop-v0.3.0",
    generatedAt: "2026-08-08T01:02:03.000Z",
    shell: {
      version: "0.3.0",
      publishedAt: "2026-08-08T01:02:03.000Z",
      updaterMetadata: "latest.yml" as const,
      engineVersion: "2",
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
    },
    runtimes: {
      "win32-x64": {
        version: "0.6.0",
        publishedAt: "2026-08-08T01:02:03.000Z",
        manifest: "coder-studio-runtime-win32-x64.manifest.json",
      },
      "linux-x64": {
        version: "0.6.0",
        publishedAt: "2026-08-08T01:02:03.000Z",
        manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
      },
    },
  };
  return {
    channel: {
      ...unsigned,
      signature: {
        algorithm: "ed25519",
        value: sign(null, canonicalSigningPayload(unsigned), keys.privateKey).toString("base64"),
      },
    },
    publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("Desktop channel", () => {
  it("verifies a pinned same-origin Desktop channel", () => {
    const { channel, publicKeyPem } = signedChannel();

    expect(
      parseDesktopChannel(
        channel,
        publicKeyPem,
        "https://github.com/o/r/releases/download/t/desktop-channel.json"
      )
    ).toMatchObject({ releaseTag: "desktop-v0.3.0" });
  });

  it("rejects signature, release-time, product-version, and asset path drift", () => {
    const { channel, publicKeyPem } = signedChannel();
    const indexUrl = "https://github.com/o/r/releases/download/t/desktop-channel.json";

    expect(() =>
      parseDesktopChannel({ ...channel, releaseTag: "changed" }, publicKeyPem, indexUrl)
    ).toThrow("signature");
    expect(() =>
      parseDesktopChannel({ ...channel, generatedAt: "08/08/2026" }, publicKeyPem, indexUrl)
    ).toThrow("generatedAt");
    expect(() =>
      parseDesktopChannel(
        {
          ...channel,
          runtimes: {
            ...channel.runtimes,
            "linux-x64": { ...channel.runtimes["linux-x64"], version: "0.7.0" },
          },
        },
        publicKeyPem,
        indexUrl
      )
    ).toThrow("same product version");
    expect(() => resolveChannelAsset(indexUrl, "../runtime.json")).toThrow("unsafe");
    expect(() => resolveChannelAsset(indexUrl, "https://evil.example/runtime.json")).toThrow(
      "unsafe"
    );
  });

  it("limits unsigned parsing to an explicit local-validation option", () => {
    const { channel } = signedChannel();
    const indexUrl = "file:///tmp/coder-studio-release/desktop-channel.json";

    expect(() => parseDesktopChannel(channel, "", indexUrl)).toThrow("signature");
    expect(parseDesktopChannel(channel, "", indexUrl, { allowUnsigned: true })).toMatchObject({
      releaseTag: "desktop-v0.3.0",
    });
    expect(() =>
      parseDesktopChannel({ ...channel, generatedAt: "08/08/2026" }, "", indexUrl, {
        allowUnsigned: true,
      })
    ).toThrow("generatedAt");
  });
});
