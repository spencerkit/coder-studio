import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWslDistroRuntimeStore,
  resolveWslDistroRuntimeStoreLayout,
} from "../../runtime/wsl-distro-store.js";

const TEST_POINTER = {
  runtimeVersion: "0.5.6",
  installDir: "/home/me/.coder-studio/runtime-store/versions/0.5.6",
  entryPath: "/home/me/.coder-studio/runtime-store/versions/0.5.6/dist/wsl-runtime-entry.mjs",
  installedAt: 1_719_760_000_000,
  nodePath: "/home/me/.coder-studio/node/20.11.1/bin/node",
};

describe("wsl distro store", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("stores the distro-local runtime root under .coder-studio", () => {
    expect(resolveWslDistroRuntimeStoreLayout("/home/me").runtimeStoreDir).toBe(
      "/home/me/.coder-studio/runtime-store"
    );
  });

  it("stores runtime versions under the distro-local runtime root", () => {
    expect(resolveWslDistroRuntimeStoreLayout("/home/me").runtimeVersionsDir).toBe(
      "/home/me/.coder-studio/runtime-store/versions"
    );
  });

  it("uses one runtime store per distro home directory", () => {
    expect(resolveWslDistroRuntimeStoreLayout("/home/me").runtimeCurrentPointerPath).toBe(
      "/home/me/.coder-studio/runtime-store/current.json"
    );
  });

  it("stores distro-local bridge state under run", () => {
    expect(resolveWslDistroRuntimeStoreLayout("/home/me").bridgeRunDir).toBe(
      "/home/me/.coder-studio/run"
    );
  });

  it("keeps distro store paths POSIX-stable even if host path joining is win32-like", async () => {
    vi.resetModules();
    vi.doMock("node:path", async () => {
      const actual = await vi.importActual<typeof import("node:path")>("node:path");
      return {
        ...actual,
        join: actual.win32.join,
      };
    });

    try {
      const { resolveWslDistroRuntimeStoreLayout: resolveLayout } = await import(
        "../../runtime/wsl-distro-store.js"
      );

      expect(resolveLayout("/home/me").runtimeCurrentPointerPath).toBe(
        "/home/me/.coder-studio/runtime-store/current.json"
      );
      expect(resolveLayout("/home/me").bridgeRunDir).toBe("/home/me/.coder-studio/run");
    } finally {
      vi.doUnmock("node:path");
      vi.resetModules();
    }
  });

  it("persists the active runtime pointer per distro", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "wsl-distro-store-"));
    tempDirs.push(rootDir);
    const store = createWslDistroRuntimeStore({ rootDir });

    await expect(store.readActiveRuntime("Ubuntu-24.04")).resolves.toBeNull();

    await store.writeActiveRuntime("Ubuntu-24.04", TEST_POINTER);

    await expect(store.readActiveRuntime("Ubuntu-24.04")).resolves.toEqual(TEST_POINTER);

    await store.clearActiveRuntime("Ubuntu-24.04");

    await expect(store.readActiveRuntime("Ubuntu-24.04")).resolves.toBeNull();
  });

  it("isolates persisted runtime pointers across distros using safe distro keys", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "wsl-distro-store-"));
    tempDirs.push(rootDir);
    const store = createWslDistroRuntimeStore({ rootDir });

    const ubuntuPointer = {
      ...TEST_POINTER,
      runtimeVersion: "0.5.6",
    };
    const previewPointer = {
      ...TEST_POINTER,
      runtimeVersion: "0.5.7",
      installDir: "/home/me/.coder-studio/runtime-store/versions/0.5.7",
      entryPath: "/home/me/.coder-studio/runtime-store/versions/0.5.7/dist/wsl-runtime-entry.mjs",
      nodePath: undefined,
    };

    await store.writeActiveRuntime("Ubuntu-24.04", ubuntuPointer);
    await store.writeActiveRuntime("Ubuntu/Preview:24.04", previewPointer);

    await expect(store.readActiveRuntime("Ubuntu-24.04")).resolves.toEqual(ubuntuPointer);
    await expect(store.readActiveRuntime("Ubuntu/Preview:24.04")).resolves.toEqual(previewPointer);
  });
});
