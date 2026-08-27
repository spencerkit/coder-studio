import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type ProductCompatibilityHost,
  type ProductIndexRelease,
  parseProductIndex,
  resolveProductIndexUrl,
  selectHighestCompatibleProductRelease,
} from "./product-index.js";
import { canonicalSigningPayload } from "./signed-json.js";

const channelUrl =
  "https://github.com/spencerkit/coder-studio/releases/download/product-stable/product-index.json";

function release(
  version: string,
  minShellVersion: string,
  engineVersion = "2"
): ProductIndexRelease {
  const publishedAt = `2026-08-${version === "0.5.15" ? "25" : "20"}T08:00:00.000Z`;
  return {
    version,
    releaseTag: `v${version}`,
    publishedAt,
    minShellVersion,
    requirements: {
      engineVersion,
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
    },
    runtimes: {
      "win32-x64": {
        manifest: "coder-studio-runtime-win32-x64.manifest.json",
        manifestSha256: "a".repeat(64),
      },
      "linux-x64": {
        manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
        manifestSha256: "b".repeat(64),
      },
    },
  };
}

function signedIndex() {
  const keys = generateKeyPairSync("ed25519");
  const newest = release("0.5.15", "0.2.0", "3");
  const compatible = release("0.5.14", "0.1.5");
  const unsigned = {
    schemaVersion: 1 as const,
    channel: "product-index" as const,
    generatedAt: "2026-08-25T08:00:00.000Z",
    latestVersion: newest.version,
    releases: [compatible, newest],
  };
  const index = {
    ...unsigned,
    signature: {
      algorithm: "ed25519" as const,
      value: sign(null, canonicalSigningPayload(unsigned), keys.privateKey).toString("base64"),
    },
  };
  return {
    index,
    publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const host: ProductCompatibilityHost = {
  shellVersion: "0.1.6",
  engineVersion: "2",
  nodeVersion: "24.19.0",
  runtimeHostApiVersion: 1,
  apiProtocolVersion: 1,
  dataSchemaVersion: 1,
};

describe("Product index", () => {
  it("parses a signed index and selects the highest compatible release", () => {
    const fixture = signedIndex();
    const parsed = parseProductIndex(fixture.index, fixture.publicKeyPem, channelUrl);

    expect(parsed.latestVersion).toBe("0.5.15");
    expect(selectHighestCompatibleProductRelease(parsed, host)?.version).toBe("0.5.14");
  });

  it("rejects tampering and an incorrect latestVersion", () => {
    const fixture = signedIndex();
    expect(() =>
      parseProductIndex(
        { ...fixture.index, latestVersion: "0.5.14" },
        fixture.publicKeyPem,
        channelUrl
      )
    ).toThrow("highest release");
    expect(() =>
      parseProductIndex(
        { ...fixture.index, generatedAt: "2026-08-25T09:00:00.000Z" },
        fixture.publicKeyPem,
        channelUrl
      )
    ).toThrow("signature is invalid");
    expect(() =>
      parseProductIndex(
        {
          ...fixture.index,
          releases: [{ ...fixture.index.releases[0], version: "latest" }],
          latestVersion: "latest",
        },
        fixture.publicKeyPem,
        channelUrl,
        { allowUnsigned: true }
      )
    ).toThrow("semantic version");
  });

  it("returns null when no accepted release is compatible", () => {
    const fixture = signedIndex();
    const parsed = parseProductIndex(fixture.index, fixture.publicKeyPem, channelUrl);
    expect(
      selectHighestCompatibleProductRelease(parsed, { ...host, engineVersion: "9" })
    ).toBeNull();
  });

  it("derives the signed index URL from the legacy channel URL", () => {
    expect(
      resolveProductIndexUrl(
        "https://github.com/o/r/releases/download/product-stable/product-channel.json?cache=1"
      )
    ).toBe("https://github.com/o/r/releases/download/product-stable/product-index.json");
  });
});
