import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
    schemaVersion: 2,
    publishedAt: "2026-08-08T01:02:03.000Z",
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
  it("reports the current Runtime version bound to its target environment", async () => {
    const manager = new ProductRuntimeUpdateManager({
      store: null as never,
      getCurrentRuntime: () => ({ manifest: { runtimeVersion: "0.5.6" } }) as never,
    });

    await expect(manager.getCurrentVersion()).resolves.toBe("0.5.6");
  });

  it("checks signed metadata without downloading or staging the package", async () => {
    const root = await temporaryRoot();
    const factoryRoot = resolve(root, "factory");
    const updateRoot = resolve(root, "update");
    await writeRuntime(factoryRoot, "0.5.6", undefined);
    const keys = generateKeyPairSync("ed25519");
    const manifest = await writeRuntime(updateRoot, "0.6.0", "runtime.tgz", keys.privateKey);
    if (manifest.schemaVersion !== 2) throw new Error("Expected schema 2 test manifest");
    const store = new RuntimeStore({
      root: resolve(root, "store"),
      factoryRuntimeRoot: factoryRoot,
      shellVersion: "0.5.6",
      nodeVersion: "24.19.0",
      publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(manifest));
    const manager = new ProductRuntimeUpdateManager({
      store,
      manifestUrl: "https://updates.example.test/channel.json",
      getCurrentRuntime: () => null as never,
      fetch: fetchMock,
    });

    await expect(
      manager.checkMetadata(
        {
          version: "0.6.0",
          publishedAt: "2026-08-08T01:02:03.000Z",
          manifest: "runtime.manifest.json",
        },
        "0.6.0"
      )
    ).resolves.toMatchObject({
      componentId: `runtime:${process.platform}-${process.arch}`,
      version: "0.6.0",
      publishedAt: "2026-08-08T01:02:03.000Z",
      plannedShellVersion: "0.6.0",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://updates.example.test/runtime.manifest.json"
    );
    await expect(store.readPendingVersion()).resolves.toBeNull();
  });

  it("rejects legacy network manifests and signed channel source drift", async () => {
    const root = await temporaryRoot();
    const factoryRoot = resolve(root, "factory");
    const updateRoot = resolve(root, "update");
    await writeRuntime(factoryRoot, "0.5.6", undefined);
    const keys = generateKeyPairSync("ed25519");
    const manifest = await writeRuntime(updateRoot, "0.6.0", "runtime.tgz", keys.privateKey);
    if (manifest.schemaVersion !== 2) throw new Error("Expected schema 2 test manifest");
    const store = new RuntimeStore({
      root: resolve(root, "store"),
      factoryRuntimeRoot: factoryRoot,
      shellVersion: "0.5.6",
      nodeVersion: "24.19.0",
      publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    const expected = {
      version: "0.6.0",
      publishedAt: "2026-08-08T01:02:03.000Z",
      manifest: "runtime.manifest.json",
    } as const;
    const createManager = (value: unknown) =>
      new ProductRuntimeUpdateManager({
        store,
        manifestUrl: "https://updates.example.test/channel.json",
        getCurrentRuntime: () => null as never,
        fetch: vi.fn(async () => Response.json(value)),
      });
    const resign = (value: RuntimeManifest): RuntimeManifest => {
      const unsigned = { ...value, signature: undefined };
      return {
        ...unsigned,
        signature: {
          algorithm: "ed25519",
          value: sign(null, getRuntimeManifestSigningPayload(unsigned), keys.privateKey).toString(
            "base64"
          ),
        },
      };
    };

    await expect(
      createManager({ ...manifest, schemaVersion: 1, publishedAt: undefined }).checkMetadata(
        expected,
        "0.6.0"
      )
    ).rejects.toThrow("must use schema 2");
    await expect(
      createManager(resign({ ...manifest, runtimeVersion: "0.7.0" })).checkMetadata(
        expected,
        "0.6.0"
      )
    ).rejects.toThrow("does not match signed Desktop channel");
    await expect(
      createManager(resign({ ...manifest, publishedAt: "2026-08-08T02:02:03.000Z" })).checkMetadata(
        expected,
        "0.6.0"
      )
    ).rejects.toThrow("does not match signed Desktop channel");
  });

  it("downloads, extracts, verifies, and stages a signed Runtime package", async () => {
    const root = await temporaryRoot();
    const factoryRoot = resolve(root, "factory");
    const updateRoot = resolve(root, "update");
    const keys = generateKeyPairSync("ed25519");
    await writeRuntime(factoryRoot, "0.5.6", undefined, keys.privateKey);
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
      now: () => 321,
    });

    await expect(manager.check()).resolves.toMatchObject({
      status: "ready",
      runtime: { source: "pending", manifest: { runtimeVersion: "0.5.7" } },
    });
    await expect(store.getLaunchCandidate()).resolves.toMatchObject({
      source: "pending",
      manifest: { runtimeVersion: "0.5.7" },
    });
    await expect(
      readFile(resolve(root, "store", "active.json"), "utf8").then(JSON.parse)
    ).resolves.toMatchObject({ active: { runtimeVersion: "0.5.6" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(manager.getState()).resolves.toEqual({
      supported: true,
      currentVersion: "0.5.6",
      latestVersion: "0.5.7",
      pendingVersion: "0.5.7",
      lastCheckedAt: 321,
      status: "ready",
      errorSummary: null,
      unsupportedReason: null,
    });

    const restartedManager = new ProductRuntimeUpdateManager({
      store,
      manifestUrl: "https://updates.example.test/manifest.json",
      getCurrentRuntime: () => current,
      fetch: fetchMock,
    });
    await expect(restartedManager.getState()).resolves.toMatchObject({
      latestVersion: "0.5.7",
      pendingVersion: "0.5.7",
      status: "ready",
    });
  });

  it("requires an explicit retry for a quarantined Runtime and reports monotonic progress", async () => {
    const root = await temporaryRoot();
    const factoryRoot = resolve(root, "factory");
    const updateRoot = resolve(root, "update");
    await writeRuntime(factoryRoot, "0.5.6", undefined);
    const keys = generateKeyPairSync("ed25519");
    const manifest = await writeRuntime(updateRoot, "0.6.0", "runtime.tgz", keys.privateKey);
    if (manifest.schemaVersion !== 2) throw new Error("Expected schema 2 test manifest");
    const archivePath = resolve(root, "runtime.tgz");
    await create({ cwd: updateRoot, file: archivePath, gzip: true }, [
      "server.mjs",
      "web",
      "manifest.json",
    ]);
    const archive = await readFile(archivePath);
    const store = new RuntimeStore({
      root: resolve(root, "store"),
      factoryRuntimeRoot: factoryRoot,
      shellVersion: "0.5.6",
      nodeVersion: "24.19.0",
      publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    const manager = new ProductRuntimeUpdateManager({
      store,
      manifestUrl: "https://updates.example.test/channel.json",
      getCurrentRuntime: () => null as never,
      fetch: vi.fn(async (input) =>
        String(input).endsWith(".tgz")
          ? new Response(archive, {
              headers: { "content-length": String(archive.byteLength) },
            })
          : Response.json(manifest)
      ),
    });
    const metadata = await manager.checkMetadata(
      {
        version: "0.6.0",
        publishedAt: manifest.publishedAt,
        manifest: "runtime.manifest.json",
      },
      "0.6.0"
    );
    const progress: number[] = [];
    const staged = await manager.downloadAndStage(metadata, {
      signal: new AbortController().signal,
      onProgress: (percent) => progress.push(percent),
      explicitRetry: false,
    });
    await store.fallbackAfterFailure(staged, new Error("health check failed"));

    await expect(
      manager.downloadAndStage(metadata, {
        signal: new AbortController().signal,
        onProgress: () => {},
        explicitRetry: false,
      })
    ).rejects.toThrow("explicit retry");
    progress.length = 0;
    await expect(
      manager.downloadAndStage(metadata, {
        signal: new AbortController().signal,
        onProgress: (percent) => progress.push(percent),
        explicitRetry: true,
      })
    ).resolves.toMatchObject({ manifest: { runtimeVersion: "0.6.0" } });
    expect(progress).toEqual([...progress].sort((left, right) => left - right));
    await expect(store.readFailedVersion()).resolves.toBeNull();
  });

  it("cleans download work files and leaves no pending pointer when cancelled", async () => {
    const root = await temporaryRoot();
    const factoryRoot = resolve(root, "factory");
    const updateRoot = resolve(root, "update");
    await writeRuntime(factoryRoot, "0.5.6", undefined);
    const keys = generateKeyPairSync("ed25519");
    const manifest = await writeRuntime(updateRoot, "0.6.0", "runtime.tgz", keys.privateKey);
    if (manifest.schemaVersion !== 2) throw new Error("Expected schema 2 test manifest");
    const archivePath = resolve(root, "runtime.tgz");
    await create({ cwd: updateRoot, file: archivePath, gzip: true }, [
      "server.mjs",
      "web",
      "manifest.json",
    ]);
    const archive = await readFile(archivePath);
    const store = new RuntimeStore({
      root: resolve(root, "store"),
      factoryRuntimeRoot: factoryRoot,
      shellVersion: "0.5.6",
      nodeVersion: "24.19.0",
      publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    const manager = new ProductRuntimeUpdateManager({
      store,
      manifestUrl: "https://updates.example.test/channel.json",
      getCurrentRuntime: () => null as never,
      fetch: vi.fn(async (input) =>
        String(input).endsWith(".tgz")
          ? new Response(archive, {
              headers: { "content-length": String(archive.byteLength) },
            })
          : Response.json(manifest)
      ),
    });
    const metadata = await manager.checkMetadata(
      {
        version: "0.6.0",
        publishedAt: manifest.publishedAt,
        manifest: "runtime.manifest.json",
      },
      "0.6.0"
    );
    const controller = new AbortController();

    await expect(
      manager.downloadAndStage(metadata, {
        signal: controller.signal,
        onProgress: (percent) => {
          if (percent > 0) controller.abort();
        },
        explicitRetry: false,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(store.readPendingVersion()).resolves.toBeNull();
    await expect(readdir(store.downloadsRoot)).resolves.toEqual([]);
  });

  it("records a serializable error state when a Runtime check fails", async () => {
    const root = await temporaryRoot();
    const factoryRoot = resolve(root, "factory");
    await writeRuntime(factoryRoot, "0.5.6", undefined);
    const store = new RuntimeStore({
      root: resolve(root, "store"),
      factoryRuntimeRoot: factoryRoot,
      shellVersion: "0.5.6",
      nodeVersion: "24.19.0",
    });
    const current = await store.getLaunchCandidate();
    const onError = vi.fn();
    const manager = new ProductRuntimeUpdateManager({
      store,
      manifestUrl: "https://updates.example.test/manifest.json",
      getCurrentRuntime: () => current,
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
      now: () => 456,
      onError,
    });

    await expect(manager.check()).rejects.toThrow("Product Runtime update check failed with 503");
    await expect(manager.getState()).resolves.toMatchObject({
      currentVersion: "0.5.6",
      lastCheckedAt: 456,
      status: "error",
      errorSummary: "Product Runtime update check failed with 503",
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
