import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RUNTIME_MANIFEST_FILE_NAME } from "./runtime-manifest.js";
import {
  RuntimeStore,
  readActiveRuntimePointer,
  resolveRuntimeStoreLayout,
} from "./runtime-store.js";

describe("runtime-store", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function createTempUserDataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "coder-studio-runtime-store-"));
    tempDirs.push(dir);
    return dir;
  }

  async function createStagedRuntimeBundle(rootDir: string, version: string): Promise<string> {
    const bundleDir = join(rootDir, "bundle");
    await mkdir(join(bundleDir, "dist", "esm"), { recursive: true });
    await mkdir(join(bundleDir, "dist", "web"), { recursive: true });
    await writeFile(
      join(bundleDir, RUNTIME_MANIFEST_FILE_NAME),
      JSON.stringify(
        {
          schemaVersion: 1,
          version,
          entry: "dist/esm/runtime-launch-entry.mjs",
          webRoot: "dist/web",
        },
        null,
        2
      )
    );
    await writeFile(
      join(bundleDir, "dist", "esm", "runtime-launch-entry.mjs"),
      "export const runtime = true;\n"
    );
    await writeFile(join(bundleDir, "dist", "web", "index.html"), "<html></html>\n");
    return bundleDir;
  }

  it("reads the active runtime pointer from current.json", async () => {
    const userDataDir = await createTempUserDataDir();
    const layout = resolveRuntimeStoreLayout(userDataDir);
    await mkdir(layout.rootDir, { recursive: true });
    await writeFile(
      layout.currentPointerPath,
      JSON.stringify(
        {
          version: "0.5.4",
          installedAt: 1700000000000,
          path: "/tmp/coder-studio/runtime-store/versions/0.5.4",
          entry: "dist/esm/runtime-launch-entry.mjs",
          webRoot: "dist/web",
          checksumSha256: "abc123",
          source: "github-release",
        },
        null,
        2
      )
    );

    await expect(readActiveRuntimePointer(layout.currentPointerPath)).resolves.toEqual({
      version: "0.5.4",
      installedAt: 1700000000000,
      path: "/tmp/coder-studio/runtime-store/versions/0.5.4",
      entry: "dist/esm/runtime-launch-entry.mjs",
      webRoot: "dist/web",
      checksumSha256: "abc123",
      source: "github-release",
    });
  });

  it("activates a staged runtime and records previousVersion rollback metadata", async () => {
    const userDataDir = await createTempUserDataDir();
    const store = new RuntimeStore({
      userDataDir,
      now: () => 1700000000123,
    });

    const firstBundleRoot = await createStagedRuntimeBundle(
      await mkdtemp(join(tmpdir(), "coder-studio-runtime-bundle-")),
      "0.5.4"
    );
    const first = await store.activateStagedRuntime({
      stagingDir: firstBundleRoot,
      checksumSha256: "sha-first",
      source: "github-release",
    });

    expect(first).toEqual({
      version: "0.5.4",
      installedAt: 1700000000123,
      path: join(resolveRuntimeStoreLayout(userDataDir).versionsDir, "0.5.4"),
      entry: "dist/esm/runtime-launch-entry.mjs",
      webRoot: "dist/web",
      checksumSha256: "sha-first",
      source: "github-release",
    });

    const secondBundleRoot = await createStagedRuntimeBundle(
      await mkdtemp(join(tmpdir(), "coder-studio-runtime-bundle-")),
      "0.5.5"
    );
    const second = await store.activateStagedRuntime({
      stagingDir: secondBundleRoot,
      checksumSha256: "sha-second",
      source: "github-release",
    });

    expect(second).toEqual({
      version: "0.5.5",
      installedAt: 1700000000123,
      path: join(resolveRuntimeStoreLayout(userDataDir).versionsDir, "0.5.5"),
      entry: "dist/esm/runtime-launch-entry.mjs",
      webRoot: "dist/web",
      checksumSha256: "sha-second",
      source: "github-release",
      previousVersion: "0.5.4",
    });

    await expect(store.readActiveRuntime()).resolves.toEqual(second);
  });

  it("rejects bundles with invalid runtime manifests", async () => {
    const userDataDir = await createTempUserDataDir();
    const store = new RuntimeStore({ userDataDir });
    const bundleRoot = await mkdtemp(join(tmpdir(), "coder-studio-runtime-bundle-invalid-"));
    await writeFile(
      join(bundleRoot, RUNTIME_MANIFEST_FILE_NAME),
      JSON.stringify(
        {
          schemaVersion: 1,
          version: "0.5.4",
          entry: "../outside.mjs",
          webRoot: "dist/web",
        },
        null,
        2
      )
    );

    await expect(
      store.activateStagedRuntime({
        stagingDir: bundleRoot,
        checksumSha256: "sha-invalid",
        source: "github-release",
      })
    ).rejects.toThrow(/entry/i);
  });
});
