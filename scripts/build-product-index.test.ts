import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProductChannel } from "../packages/desktop/src/product-channel.js";
import { parseProductIndex } from "../packages/desktop/src/product-index.js";
import { canonicalSigningPayload } from "../packages/desktop/src/signed-json.js";
import { buildProductIndex, parseProductIndexCommand } from "./build-product-index.js";

const roots: string[] = [];
const indexUrl =
  "https://github.com/spencerkit/coder-studio/releases/download/product-stable/product-index.json";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function signedChannel(
  version: string,
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]
): ProductChannel {
  const unsigned: Omit<ProductChannel, "signature"> = {
    schemaVersion: 1,
    channel: "product",
    version,
    releaseTag: `v${version}`,
    generatedAt: `2026-08-${version === "0.5.13" ? "25" : "20"}T08:00:00.000Z`,
    minShellVersion: "0.1.5",
    requirements: {
      engineVersion: "2",
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
    },
    runtimes: {
      "win32-x64": {
        version,
        publishedAt: "2026-08-20T08:00:00.000Z",
        manifest: "coder-studio-runtime-win32-x64.manifest.json",
        manifestSha256: (version === "0.5.13" ? "c" : "a").repeat(64),
      },
      "linux-x64": {
        version,
        publishedAt: "2026-08-20T08:00:00.000Z",
        manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
        manifestSha256: (version === "0.5.13" ? "d" : "b").repeat(64),
      },
    },
  };
  return {
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(null, canonicalSigningPayload(unsigned), privateKey).toString("base64"),
    },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "coder-studio-index-"));
  roots.push(root);
  const keys = generateKeyPairSync("ed25519");
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const candidateFile = join(root, "candidate.json");
  const previousFile = join(root, "previous.json");
  const outputFile = join(root, "product-index.json");
  await Promise.all([
    writeFile(candidateFile, JSON.stringify(signedChannel("0.5.13", keys.privateKey))),
    writeFile(previousFile, JSON.stringify(signedChannel("0.5.12", keys.privateKey))),
  ]);
  return { root, keys, publicKeyPem, privateKeyPem, candidateFile, previousFile, outputFile };
}

describe("Product index builder", () => {
  it("bootstraps from the previous stable channel and adds the accepted candidate", async () => {
    const value = await fixture();
    const index = await buildProductIndex({
      candidateChannelFile: value.candidateFile,
      previousChannelFile: value.previousFile,
      publicKeyPem: value.publicKeyPem,
      privateKeyPem: value.privateKeyPem,
      outputFile: value.outputFile,
    });

    expect(index.latestVersion).toBe("0.5.13");
    expect(index.releases.map((release) => release.version)).toEqual(["0.5.12", "0.5.13"]);
    expect(
      parseProductIndex(
        JSON.parse(await readFile(value.outputFile, "utf8")),
        value.publicKeyPem,
        indexUrl
      )
    ).toEqual(index);
  });

  it("is byte-idempotent when the accepted candidate is already indexed", async () => {
    const value = await fixture();
    await buildProductIndex({
      candidateChannelFile: value.candidateFile,
      previousChannelFile: value.previousFile,
      publicKeyPem: value.publicKeyPem,
      privateKeyPem: value.privateKeyPem,
      outputFile: value.outputFile,
    });
    const before = await readFile(value.outputFile);
    await buildProductIndex({
      candidateChannelFile: value.candidateFile,
      existingIndexFile: value.outputFile,
      publicKeyPem: value.publicKeyPem,
      privateKeyPem: value.privateKeyPem,
      generatedAt: "2026-08-25T12:00:00.000Z",
      outputFile: value.outputFile,
    });
    expect(await readFile(value.outputFile)).toEqual(before);
  });

  it("rejects a conflicting release identity and a tampered existing index", async () => {
    const value = await fixture();
    const index = await buildProductIndex({
      candidateChannelFile: value.candidateFile,
      previousChannelFile: value.previousFile,
      publicKeyPem: value.publicKeyPem,
      privateKeyPem: value.privateKeyPem,
      outputFile: value.outputFile,
    });
    const conflicting = signedChannel("0.5.13", value.keys.privateKey);
    conflicting.runtimes["win32-x64"].manifestSha256 = "e".repeat(64);
    const unsignedConflict = Object.fromEntries(
      Object.entries(conflicting).filter(([key]) => key !== "signature")
    );
    conflicting.signature.value = sign(
      null,
      canonicalSigningPayload(unsignedConflict),
      value.keys.privateKey
    ).toString("base64");
    await writeFile(value.candidateFile, JSON.stringify(conflicting));
    await expect(
      buildProductIndex({
        candidateChannelFile: value.candidateFile,
        existingIndexFile: value.outputFile,
        publicKeyPem: value.publicKeyPem,
        privateKeyPem: value.privateKeyPem,
        outputFile: value.outputFile,
      })
    ).rejects.toThrow("identity conflicts");

    await writeFile(
      value.outputFile,
      JSON.stringify({ ...index, generatedAt: "2026-08-25T12:00:00.000Z" })
    );
    await expect(
      buildProductIndex({
        candidateChannelFile: value.candidateFile,
        existingIndexFile: value.outputFile,
        publicKeyPem: value.publicKeyPem,
        privateKeyPem: value.privateKeyPem,
        outputFile: value.outputFile,
      })
    ).rejects.toThrow("signature is invalid");
  });

  it("refuses to promote a candidate below the highest accepted Product version", async () => {
    const value = await fixture();
    await buildProductIndex({
      candidateChannelFile: value.candidateFile,
      previousChannelFile: value.previousFile,
      publicKeyPem: value.publicKeyPem,
      privateKeyPem: value.privateKeyPem,
      outputFile: value.outputFile,
    });
    await writeFile(value.candidateFile, await readFile(value.previousFile));

    await expect(
      buildProductIndex({
        candidateChannelFile: value.candidateFile,
        existingIndexFile: value.outputFile,
        publicKeyPem: value.publicKeyPem,
        privateKeyPem: value.privateKeyPem,
        outputFile: value.outputFile,
      })
    ).rejects.toThrow("highest indexed version");
  });

  it("parses the release workflow command", () => {
    expect(
      parseProductIndexCommand([
        "--",
        "--candidate-channel",
        "candidate.json",
        "--public-key",
        "public.pem",
        "--private-key",
        "private.pem",
        "--output",
        "product-index.json",
      ])
    ).toMatchObject({
      candidateChannelFile: expect.stringContaining("candidate.json"),
      outputFile: expect.stringContaining("product-index.json"),
    });
  });
});
