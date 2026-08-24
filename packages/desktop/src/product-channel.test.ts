import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type ProductChannel,
  parseProductChannel,
  resolveProductChannelUrl,
} from "./product-channel.js";
import { resolveVersionedReleaseAsset } from "./release-channel.js";
import { canonicalSigningPayload } from "./signed-json.js";

function signedProductChannel(): { channel: ProductChannel; publicKeyPem: string } {
  const keys = generateKeyPairSync("ed25519");
  const unsigned: Omit<ProductChannel, "signature"> = {
    schemaVersion: 1,
    channel: "product",
    version: "0.6.0",
    releaseTag: "v0.6.0",
    generatedAt: "2026-08-08T01:02:03.000Z",
    minShellVersion: "0.3.0",
    requirements: {
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
        manifestSha256: "a".repeat(64),
      },
      "linux-x64": {
        version: "0.6.0",
        publishedAt: "2026-08-08T01:02:03.000Z",
        manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
        manifestSha256: "b".repeat(64),
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

describe("Product release channel", () => {
  const channelUrl =
    "https://github.com/spencerkit/coder-studio/releases/download/product-stable/product-channel.json";

  it("verifies one Product version across Windows and WSL Runtime manifests", () => {
    const { channel, publicKeyPem } = signedProductChannel();

    expect(parseProductChannel(channel, publicKeyPem, channelUrl)).toEqual(channel);
  });

  it("rejects version, digest, timestamp, and signature drift", () => {
    const { channel, publicKeyPem } = signedProductChannel();

    expect(() =>
      parseProductChannel(
        {
          ...channel,
          runtimes: {
            ...channel.runtimes,
            "linux-x64": { ...channel.runtimes["linux-x64"], version: "0.7.0" },
          },
        },
        publicKeyPem,
        channelUrl,
        { allowUnsigned: true }
      )
    ).toThrow("same Product version");
    expect(() =>
      parseProductChannel(
        {
          ...channel,
          runtimes: {
            ...channel.runtimes,
            "win32-x64": {
              ...channel.runtimes["win32-x64"],
              manifestSha256: "wrong",
            },
          },
        },
        publicKeyPem,
        channelUrl,
        { allowUnsigned: true }
      )
    ).toThrow("SHA-256");
    expect(() =>
      parseProductChannel({ ...channel, generatedAt: "08/08/2026" }, publicKeyPem, channelUrl, {
        allowUnsigned: true,
      })
    ).toThrow("generatedAt");
    expect(() =>
      parseProductChannel({ ...channel, releaseTag: "v0.6.1" }, publicKeyPem, channelUrl)
    ).toThrow("signature");
  });

  it("resolves assets from the trusted repository and signed immutable tag", () => {
    expect(
      resolveVersionedReleaseAsset(
        channelUrl,
        "v0.6.0",
        "coder-studio-runtime-win32-x64.manifest.json"
      )
    ).toBe(
      "https://github.com/spencerkit/coder-studio/releases/download/v0.6.0/coder-studio-runtime-win32-x64.manifest.json"
    );
    expect(() => resolveVersionedReleaseAsset(channelUrl, "../latest", "runtime.json")).toThrow(
      "release tag"
    );
    expect(() =>
      resolveVersionedReleaseAsset(channelUrl, "v0.6.0", "https://evil.example/runtime.json")
    ).toThrow("asset name");
    expect(() =>
      resolveVersionedReleaseAsset("https://updates.example/product.json", "v0.6.0", "runtime.json")
    ).toThrow("tag-pinned");
  });

  it("allows a Product channel override only during acceptance", () => {
    const override =
      "https://github.com/spencerkit/coder-studio/releases/download/candidate/product-channel.json";

    expect(
      resolveProductChannelUrl({ CODER_STUDIO_PRODUCT_CHANNEL_URL: override }, channelUrl)
    ).toBe(channelUrl);
    expect(
      resolveProductChannelUrl(
        {
          CODER_STUDIO_DESKTOP_ACCEPTANCE: "1",
          CODER_STUDIO_PRODUCT_CHANNEL_URL: override,
        },
        channelUrl
      )
    ).toBe(override);
  });
});
