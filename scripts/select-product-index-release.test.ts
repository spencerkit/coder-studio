import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProductIndex, ProductIndexRelease } from "../packages/desktop/src/product-index.js";
import { canonicalSigningPayload } from "../packages/desktop/src/signed-json.js";
import { selectProductIndexRelease } from "./select-product-index-release.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function release(
  version: string,
  minShellVersion: string,
  engineVersion = "2"
): ProductIndexRelease {
  return {
    version,
    releaseTag: `v${version}`,
    publishedAt: "2026-08-25T08:00:00.000Z",
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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "coder-studio-select-index-"));
  roots.push(root);
  const keys = generateKeyPairSync("ed25519");
  const releases = [
    release("0.5.11", "0.1.0"),
    release("0.5.12", "0.1.0", "3"),
    release("0.5.13", "0.1.5"),
  ];
  const unsigned: Omit<ProductIndex, "signature"> = {
    schemaVersion: 1,
    channel: "product-index",
    generatedAt: "2026-08-25T08:00:00.000Z",
    latestVersion: "0.5.13",
    releases,
  };
  const index = {
    ...unsigned,
    signature: {
      algorithm: "ed25519" as const,
      value: sign(null, canonicalSigningPayload(unsigned), keys.privateKey).toString("base64"),
    },
  };
  const buildInfo = {
    schemaVersion: 1,
    shellVersion: "0.1.5",
    builtAt: "2026-08-25T08:00:00.000Z",
    publishedAt: "2026-08-25T08:00:00.000Z",
    engineVersion: "2",
    nodeVersion: "24.19.0",
    runtimeHostApiVersion: 1,
    apiProtocolVersion: 1,
    dataSchemaVersion: 1,
  };
  const indexFile = join(root, "product-index.json");
  const buildInfoFile = join(root, "build-info.json");
  const outputFile = join(root, "selected.json");
  await Promise.all([
    writeFile(indexFile, JSON.stringify(index)),
    writeFile(buildInfoFile, JSON.stringify(buildInfo)),
  ]);
  return {
    publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    indexFile,
    buildInfoFile,
    outputFile,
  };
}

describe("Product index release selector", () => {
  it("selects the highest compatible accepted Runtime", async () => {
    const value = await fixture();
    await expect(selectProductIndexRelease({ ...value })).resolves.toMatchObject({
      version: "0.5.13",
      releaseTag: "v0.5.13",
    });
  });

  it("selects the immediately previous accepted Runtime without skipping incompatibility", async () => {
    const value = await fixture();
    await expect(
      selectProductIndexRelease({ ...value, previousToVersion: "0.5.13" })
    ).resolves.toMatchObject({ version: "0.5.12" });
    await expect(
      selectProductIndexRelease({ ...value, requiredVersion: "0.5.12" })
    ).rejects.toThrow("No accepted Product Runtime");
  });
});
