import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { create } from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_ENGINE_VERSION,
  getRuntimeManifestSigningPayload,
  hashRuntimeFile,
  type RuntimeManifest,
} from "./runtime-manifest.js";
import { RuntimeStore } from "./runtime-store.js";
import { ProductRuntimeUpdateManager } from "./runtime-update-manager.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "coder-studio-runtime-update-test-"));
  temporaryRoots.push(root);
  return root;
}

async function writeRuntime(
  root: string,
  version: string,
  packageFile: string | undefined,
  privateKey?: KeyObject
): Promise<RuntimeManifest> {
  await mkdir(resolve(root, "web"), { recursive: true });
  await writeFile(
    resolve(root, "server.mjs"),
    `export const version = ${JSON.stringify(version)};`
  );
  await writeFile(resolve(root, "web/index.html"), `<html>${version}</html>`);
  const files = await Promise.all(
    ["server.mjs", "web/index.html"].map(async (path) => ({
      path,
      ...(await hashRuntimeFile(resolve(root, ...path.split("/")))),
    }))
  );
  let manifest: RuntimeManifest = {
    schemaVersion: 1,
    runtimeVersion: version,
    minShellVersion: "0.5.6",
    requiredEngineVersion: DESKTOP_ENGINE_VERSION,
    requiredNodeVersion: "24.19.0",
    runtimeHostApiVersion: 1,
    apiProtocolVersion: 1,
    dataSchemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    entrypoint: "server.mjs",
    webRoot: "web",
    files,
    ...(packageFile ? { packageFile } : {}),
  };
  if (privateKey) {
    manifest = {
      ...manifest,
      signature: {
        algorithm: "ed25519",
        value: sign(null, getRuntimeManifestSigningPayload(manifest), privateKey).toString(
          "base64"
        ),
      },
    };
  }
  await writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest));
  return manifest;
}

describe("ProductRuntimeUpdateManager", () => {
  it("downloads, extracts, verifies, and stages a signed Runtime package", async () => {
    const root = await temporaryRoot();
    const factoryRoot = resolve(root, "factory");
    const updateRoot = resolve(root, "update");
    await writeRuntime(factoryRoot, "0.5.6", undefined);
    const keys = generateKeyPairSync("ed25519");
    const manifest = await writeRuntime(updateRoot, "0.5.7", "runtime.tgz", keys.privateKey);
    const archivePath = resolve(root, "runtime.tgz");
    await create({ cwd: updateRoot, file: archivePath, gzip: true }, [
      "server.mjs",
      "web",
      "manifest.json",
    ]);
    const archive = await readFile(archivePath);
    const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const store = new RuntimeStore({
      root: resolve(root, "store"),
      factoryRuntimeRoot: factoryRoot,
      shellVersion: "0.5.6",
      nodeVersion: "24.19.0",
      publicKeyPem,
    });
    const current = await store.getLaunchCandidate();
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("manifest.json")) return Response.json(manifest);
      if (url.endsWith("runtime.tgz")) return new Response(archive);
      return new Response(null, { status: 404 });
    });
    const manager = new ProductRuntimeUpdateManager({
      store,
      manifestUrl: "https://updates.example.test/manifest.json",
      getCurrentRuntime: () => current,
      fetch: fetchMock,
    });

    await expect(manager.check()).resolves.toMatchObject({
      status: "ready",
      runtime: { source: "pending", manifest: { runtimeVersion: "0.5.7" } },
    });
    await expect(store.getLaunchCandidate()).resolves.toMatchObject({
      source: "pending",
      manifest: { runtimeVersion: "0.5.7" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
