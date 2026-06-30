import { describe, expect, it, vi } from "vitest";
import type { InstalledWslRuntimePointer } from "../../runtime/wsl-distro-store.js";
import { createWslRuntimeInstallManager } from "../../runtime/wsl-runtime-install-manager.js";

function createPointer(runtimeVersion: string): InstalledWslRuntimePointer {
  return {
    runtimeVersion,
    installDir: `/home/me/.coder-studio/runtime-store/versions/${runtimeVersion}`,
    entryPath: `/home/me/.coder-studio/runtime-store/versions/${runtimeVersion}/dist/wsl-runtime-entry.mjs`,
    installedAt: 1_719_760_000_000,
    nodePath: "/home/me/.coder-studio/node/20.11.1/bin/node",
  };
}

describe("wsl runtime install manager", () => {
  it("reuses the stored pointer when it already matches the host runtime version", async () => {
    const storedPointer = createPointer("0.5.6");
    const store = {
      readActiveRuntime: vi.fn(async () => storedPointer),
      writeActiveRuntime: vi.fn(async () => {}),
      clearActiveRuntime: vi.fn(async () => {}),
    };
    const installRuntime = vi.fn(async () => createPointer("0.5.6"));
    const manager = createWslRuntimeInstallManager({
      hostRuntimeVersion: "0.5.6",
      store,
      installRuntime,
    });

    await expect(manager.ensureInstalled("Ubuntu-24.04")).resolves.toEqual(storedPointer);
    expect(store.readActiveRuntime).toHaveBeenCalledWith("Ubuntu-24.04");
    expect(installRuntime).not.toHaveBeenCalled();
    expect(store.writeActiveRuntime).not.toHaveBeenCalled();
  });

  it("installs and persists a pointer when no active runtime is stored", async () => {
    const installedPointer = createPointer("0.5.6");
    const store = {
      readActiveRuntime: vi.fn(async () => null),
      writeActiveRuntime: vi.fn(async () => {}),
      clearActiveRuntime: vi.fn(async () => {}),
    };
    const installRuntime = vi.fn(async () => installedPointer);
    const manager = createWslRuntimeInstallManager({
      hostRuntimeVersion: "0.5.6",
      store,
      installRuntime,
    });

    await expect(manager.ensureInstalled("Ubuntu-24.04")).resolves.toEqual(installedPointer);
    expect(installRuntime).toHaveBeenCalledWith({
      distro: "Ubuntu-24.04",
      runtimeVersion: "0.5.6",
    });
    expect(store.writeActiveRuntime).toHaveBeenCalledWith("Ubuntu-24.04", installedPointer);
  });

  it("reinstalls and persists a pointer when the stored runtime version differs", async () => {
    const stalePointer = createPointer("0.5.5");
    const installedPointer = createPointer("0.5.6");
    const store = {
      readActiveRuntime: vi.fn(async () => stalePointer),
      writeActiveRuntime: vi.fn(async () => {}),
      clearActiveRuntime: vi.fn(async () => {}),
    };
    const installRuntime = vi.fn(async () => installedPointer);
    const manager = createWslRuntimeInstallManager({
      hostRuntimeVersion: "0.5.6",
      store,
      installRuntime,
    });

    await expect(manager.ensureInstalled("Ubuntu-24.04")).resolves.toEqual(installedPointer);
    expect(installRuntime).toHaveBeenCalledWith({
      distro: "Ubuntu-24.04",
      runtimeVersion: "0.5.6",
    });
    expect(store.writeActiveRuntime).toHaveBeenCalledWith("Ubuntu-24.04", installedPointer);
  });

  it("reinstalls when a same-version pointer is no longer reusable", async () => {
    const storedPointer = createPointer("0.5.6");
    const installedPointer = {
      ...createPointer("0.5.6"),
      entryPath: "/updated/runtime/wsl-runtime-entry.mjs",
    };
    const store = {
      readActiveRuntime: vi.fn(async () => storedPointer),
      writeActiveRuntime: vi.fn(async () => {}),
      clearActiveRuntime: vi.fn(async () => {}),
    };
    const installRuntime = vi.fn(async () => installedPointer);
    const isStoredRuntimeReusable = vi.fn(async () => false);
    const manager = createWslRuntimeInstallManager({
      hostRuntimeVersion: "0.5.6",
      store,
      installRuntime,
      isStoredRuntimeReusable,
    });

    await expect(manager.ensureInstalled("Ubuntu-24.04")).resolves.toEqual(installedPointer);
    expect(isStoredRuntimeReusable).toHaveBeenCalledWith(storedPointer, {
      distro: "Ubuntu-24.04",
      hostRuntimeVersion: "0.5.6",
    });
    expect(installRuntime).toHaveBeenCalledWith({
      distro: "Ubuntu-24.04",
      runtimeVersion: "0.5.6",
    });
    expect(store.writeActiveRuntime).toHaveBeenCalledWith("Ubuntu-24.04", installedPointer);
  });
});
