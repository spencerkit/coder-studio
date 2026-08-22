import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DesktopChannel } from "./desktop-channel.js";
import {
  parseDesktopChannel,
  resolveDesktopChannelUrl,
  resolveDesktopRuntimePublicKey,
} from "./desktop-channel.js";
import { canonicalSigningPayload } from "./signed-json.js";

function signedDesktopChannel(): { channel: DesktopChannel; publicKeyPem: string } {
  const keys = generateKeyPairSync("ed25519");
  const unsigned: Omit<DesktopChannel, "signature"> = {
    schemaVersion: 1,
    channel: "desktop",
    version: "0.3.0",
    releaseTag: "desktop-v0.3.0",
    generatedAt: "2026-08-08T01:02:03.000Z",
    shell: {
      version: "0.3.0",
      publishedAt: "2026-08-08T01:02:03.000Z",
      updaterMetadata: "latest.yml",
      installer: "Coder-Studio-Setup-0.3.0.exe",
      engineVersion: "2",
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
    },
    wslEngine: {
      version: "2",
      nodeVersion: "24.19.0",
      manifest: "coder-studio-engine-linux-x64.manifest.json",
      manifestSha256: "a".repeat(64),
    },
    factoryProduct: {
      version: "0.6.0",
      releaseTag: "v0.6.0",
      runtimes: {
        "win32-x64": {
          manifest: "coder-studio-runtime-win32-x64.manifest.json",
          manifestSha256: "b".repeat(64),
        },
        "linux-x64": {
          manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
          manifestSha256: "c".repeat(64),
        },
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

describe("Desktop release channel", () => {
  it("verifies Shell, Engine, and immutable Factory Product provenance", () => {
    const { channel, publicKeyPem } = signedDesktopChannel();

    expect(
      parseDesktopChannel(
        channel,
        publicKeyPem,
        "https://github.com/spencerkit/coder-studio/releases/download/desktop-stable/desktop-channel.json"
      )
    ).toEqual(channel);
  });

  it("rejects unsigned identity drift and unsafe immutable assets", () => {
    const { channel, publicKeyPem } = signedDesktopChannel();
    const channelUrl =
      "https://github.com/spencerkit/coder-studio/releases/download/desktop-stable/desktop-channel.json";

    expect(() =>
      parseDesktopChannel({ ...channel, releaseTag: "desktop-v0.3.1" }, publicKeyPem, channelUrl)
    ).toThrow("signature");
    expect(() =>
      parseDesktopChannel(
        {
          ...channel,
          wslEngine: { ...channel.wslEngine, manifestSha256: "not-a-digest" },
        },
        publicKeyPem,
        channelUrl,
        { allowUnsigned: true }
      )
    ).toThrow("SHA-256");
    expect(() =>
      parseDesktopChannel(
        {
          ...channel,
          factoryProduct: {
            ...channel.factoryProduct,
            runtimes: {
              ...channel.factoryProduct.runtimes,
              "linux-x64": {
                ...channel.factoryProduct.runtimes["linux-x64"],
                manifest: "../runtime.json",
              },
            },
          },
        },
        publicKeyPem,
        channelUrl,
        { allowUnsigned: true }
      )
    ).toThrow("asset name");
  });

  it("allows channel and key overrides only for explicit acceptance", () => {
    const compiled =
      "https://github.com/spencerkit/coder-studio/releases/download/desktop-stable/desktop-channel.json";
    const override =
      "https://github.com/spencerkit/coder-studio/releases/download/candidate/desktop-channel.json";
    const readKey = vi.fn(() => "acceptance-public-key\n");

    expect(resolveDesktopChannelUrl({ CODER_STUDIO_DESKTOP_CHANNEL_URL: override }, compiled)).toBe(
      compiled
    );
    expect(
      resolveDesktopChannelUrl(
        {
          CODER_STUDIO_DESKTOP_ACCEPTANCE: "1",
          CODER_STUDIO_DESKTOP_CHANNEL_URL: override,
        },
        compiled
      )
    ).toBe(override);
    expect(
      resolveDesktopRuntimePublicKey(
        { CODER_STUDIO_DESKTOP_PUBLIC_KEY_FILE: "C:\\acceptance\\public.pem" },
        "compiled-key",
        readKey
      )
    ).toBe("compiled-key");
    expect(
      resolveDesktopRuntimePublicKey(
        {
          CODER_STUDIO_DESKTOP_ACCEPTANCE: "1",
          CODER_STUDIO_DESKTOP_PUBLIC_KEY_FILE: "C:\\acceptance\\public.pem",
        },
        "compiled-key",
        readKey
      )
    ).toBe("acceptance-public-key");
  });
});
