import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  API_PROTOCOL_VERSION,
  DATA_SCHEMA_VERSION,
  DESKTOP_ENGINE_VERSION,
  getRuntimeManifestSigningPayload,
  hashRuntimeFile,
  RUNTIME_HOST_API_VERSION,
  RUNTIME_MANIFEST_SCHEMA_VERSION,
  type RuntimeManifest,
} from "./runtime-manifest.js";
import { RuntimeStore } from "./runtime-store.js";

const temporaryRoots: string[] = [];
const keys = generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "coder-studio-runtime-store-test-"));
  temporaryRoots.push(root);
  return root;
}

async function createRuntime(
  root: string,
  runtimeVersion: string,
  options: { signed?: boolean; packageFile?: string } = {}
): Promise<RuntimeManifest> {
  await mkdir(resolve(root, "web"), { recursive: true });
  await Promise.all([
    writeFile(
      resolve(root, "server.mjs"),
      `export const version = ${JSON.stringify(runtimeVersion)};`
    ),
    writeFile(resolve(root, "web/index.html"), `<html>${runtimeVersion}</html>`),
  ]);
  const files = await Promise.all(
    ["server.mjs", "web/index.html"].map(async (path) => ({
      path,
      ...(await hashRuntimeFile(resolve(root, ...path.split("/")))),
    }))
  );
  let manifest: RuntimeManifest = {
    schemaVersion: RUNTIME_MANIFEST_SCHEMA_VERSION,
    publishedAt: "2026-08-08T01:02:03.000Z",
    runtimeVersion,
    minShellVersion: "0.5.0",
    requiredEngineVersion: DESKTOP_ENGINE_VERSION,
    requiredNodeVersion: "24.19.0",
    runtimeHostApiVersion: RUNTIME_HOST_API_VERSION,
    apiProtocolVersion: API_PROTOCOL_VERSION,
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    platform: process.platform,
    arch: process.arch,
    entrypoint: "server.mjs",
    webRoot: "web",
    files,
    ...(options.packageFile ? { packageFile: options.packageFile } : {}),
  };
  if (options.signed) {
    manifest = {
      ...manifest,
      signature: {
        algorithm: "ed25519",
        value: sign(null, getRuntimeManifestSigningPayload(manifest), keys.privateKey).toString(
          "base64"
        ),
      },
    };
  }
  await writeFile(resolve(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function createStore(): Promise<{
  store: RuntimeStore;
  factoryRoot: string;
}> {
  const root = await createRoot();
  const factoryRoot = resolve(root, "factory");
  await createRuntime(factoryRoot, "0.5.6");
  return {
    factoryRoot,
    store: new RuntimeStore({
      root: resolve(root, "store"),
      factoryRuntimeRoot: factoryRoot,
      shellVersion: "0.5.6",
      nodeVersion: "24.19.0",
      publicKeyPem,
    }),
  };
}

describe("RuntimeStore", () => {
  it("uses the trusted Factory Runtime when no update is installed", async () => {
    const { store, factoryRoot } = await createStore();
    await expect(store.getLaunchCandidate()).resolves.toMatchObject({
      root: factoryRoot,
      source: "factory",
      manifest: { runtimeVersion: "0.5.6" },
    });
  });

  it("promotes a verified pending Runtime only after launch succeeds", async () => {
    const { store } = await createStore();
    const downloadRoot = resolve(await createRoot(), "download");
    await createRuntime(downloadRoot, "0.5.7", { signed: true });

    const staged = await store.stageDownloadedRuntime(downloadRoot);
    expect(staged.source).toBe("pending");
    await expect(store.getLaunchCandidate()).resolves.toMatchObject({
      source: "pending",
      manifest: { runtimeVersion: "0.5.7" },
    });

    await store.markLaunchSuccessful(staged);
    await expect(store.getLaunchCandidate()).resolves.toMatchObject({
      source: "active",
      manifest: { runtimeVersion: "0.5.7" },
    });
  });

  it("rolls a failed pending Runtime back to Factory", async () => {
    const { store } = await createStore();
    const downloadRoot = resolve(await createRoot(), "download");
    await createRuntime(downloadRoot, "0.5.7", { signed: true });
    const staged = await store.stageDownloadedRuntime(downloadRoot);

    await expect(
      store.fallbackAfterFailure(staged, new Error("startup failed"))
    ).resolves.toMatchObject({
      source: "factory",
      manifest: { runtimeVersion: "0.5.6" },
    });
    await expect(store.readPendingVersion()).resolves.toBeNull();
    await expect(store.readFailedVersion()).resolves.toBe("0.5.7");
  });

  it("rejects a signed Runtime after a file is tampered with", async () => {
    const { store } = await createStore();
    const downloadRoot = resolve(await createRoot(), "download");
    await createRuntime(downloadRoot, "0.5.7", { signed: true });
    await writeFile(resolve(downloadRoot, "server.mjs"), "tampered");

    await expect(store.stageDownloadedRuntime(downloadRoot)).rejects.toThrow(
      "file verification failed"
    );
  });

  it("rejects a Runtime that requires a newer shell", async () => {
    const { store } = await createStore();
    const downloadRoot = resolve(await createRoot(), "download");
    const manifest = await createRuntime(downloadRoot, "0.5.7", { signed: true });
    const incompatible: RuntimeManifest = {
      ...manifest,
      minShellVersion: "9.0.0",
      signature: undefined,
    };
    incompatible.signature = {
      algorithm: "ed25519",
      value: sign(null, getRuntimeManifestSigningPayload(incompatible), keys.privateKey).toString(
        "base64"
      ),
    };
    await writeFile(resolve(downloadRoot, "manifest.json"), JSON.stringify(incompatible));

    await expect(store.stageDownloadedRuntime(downloadRoot)).rejects.toThrow(
      "requires Desktop 9.0.0"
    );
  });

  it("does not trust an unsigned downloaded Runtime", async () => {
    const { store } = await createStore();
    const downloadRoot = resolve(await createRoot(), "download");
    await createRuntime(downloadRoot, "0.5.7");
    const manifestText = await readFile(resolve(downloadRoot, "manifest.json"), "utf8");
    expect(manifestText).not.toContain("signature");

    await expect(store.stageDownloadedRuntime(downloadRoot)).rejects.toThrow(
      "signature is invalid"
    );
  });

  it("prefers a newer Factory Runtime and keeps only one stored rollback", async () => {
    const root = await createRoot();
    const storeRoot = resolve(root, "store");
    const oldFactoryRoot = resolve(root, "factory-old");
    await createRuntime(oldFactoryRoot, "0.5.4");
    const oldStore = new RuntimeStore({
      root: storeRoot,
      factoryRuntimeRoot: oldFactoryRoot,
      shellVersion: "0.5.6",
      nodeVersion: "24.19.0",
      publicKeyPem,
    });
    const firstRoot = resolve(await createRoot(), "first");
    const secondRoot = resolve(await createRoot(), "second");
    await createRuntime(firstRoot, "0.5.5", { signed: true });
    await createRuntime(secondRoot, "0.5.7", { signed: true });
    const first = await oldStore.stageDownloadedRuntime(firstRoot);
    await oldStore.markLaunchSuccessful(first);
    const second = await oldStore.stageDownloadedRuntime(secondRoot);
    await oldStore.markLaunchSuccessful(second);

    const newFactoryRoot = resolve(root, "factory-new");
    await createRuntime(newFactoryRoot, "0.5.8");
    const upgradedStore = new RuntimeStore({
      root: storeRoot,
      factoryRuntimeRoot: newFactoryRoot,
      shellVersion: "0.6.0",
      nodeVersion: "24.19.0",
      publicKeyPem,
    });
    const selected = await upgradedStore.getLaunchCandidate();

    expect(selected).toMatchObject({
      source: "factory",
      manifest: { runtimeVersion: "0.5.8" },
    });
    await upgradedStore.markLaunchSuccessful(selected);
    await expect(readFile(resolve(first.root, "server.mjs"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(resolve(second.root, "server.mjs"), "utf8")).resolves.toContain("0.5.7");
  });

  it("preserves a leased Runtime until the other Desktop instance releases it", async () => {
    const { store } = await createStore();
    const createAndActivate = async (version: string) => {
      const runtimeRoot = resolve(await createRoot(), version);
      await createRuntime(runtimeRoot, version, { signed: true });
      const staged = await store.stageDownloadedRuntime(runtimeRoot);
      await store.markLaunchSuccessful(staged);
      return staged;
    };
    const first = await createAndActivate("0.5.7");
    const releaseLease = await store.acquireLease(first);
    await createAndActivate("0.5.8");
    await createAndActivate("0.5.9");

    await expect(readFile(resolve(first.root, "server.mjs"), "utf8")).resolves.toContain("0.5.7");
    await releaseLease();
    await store.markLaunchSuccessful(await store.getLaunchCandidate());
    await expect(readFile(resolve(first.root, "server.mjs"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("falls back to the stored active Runtime when a newer Factory Runtime fails", async () => {
    const root = await createRoot();
    const storeRoot = resolve(root, "store");
    const oldFactoryRoot = resolve(root, "factory-old");
    await createRuntime(oldFactoryRoot, "0.5.6");
    const oldStore = new RuntimeStore({
      root: storeRoot,
      factoryRuntimeRoot: oldFactoryRoot,
      shellVersion: "0.5.6",
      nodeVersion: "24.19.0",
      publicKeyPem,
    });
    const activeRoot = resolve(await createRoot(), "active");
    await createRuntime(activeRoot, "0.5.7", { signed: true });
    await oldStore.markLaunchSuccessful(await oldStore.stageDownloadedRuntime(activeRoot));

    const newFactoryRoot = resolve(root, "factory-new");
    await createRuntime(newFactoryRoot, "0.5.8");
    const upgradedStore = new RuntimeStore({
      root: storeRoot,
      factoryRuntimeRoot: newFactoryRoot,
      shellVersion: "0.6.0",
      nodeVersion: "24.19.0",
      publicKeyPem,
    });
    const factory = await upgradedStore.getLaunchCandidate();
    const fallback = await upgradedStore.fallbackAfterFailure(factory, new Error("factory failed"));

    expect(fallback).toMatchObject({
      source: "active",
      manifest: { runtimeVersion: "0.5.7" },
    });
    await expect(upgradedStore.getLaunchCandidate()).resolves.toMatchObject({
      source: "active",
      manifest: { runtimeVersion: "0.5.7" },
    });
  });
});
