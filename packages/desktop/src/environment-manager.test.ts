import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopEnvironmentManager } from "./environment-manager.js";
import { DESKTOP_ENGINE_VERSION, type RuntimeManifest } from "./runtime-manifest.js";
import { WslInstaller } from "./wsl-installer.js";
import { WslRuntimeStoreClient } from "./wsl-runtime-store.js";
import { WslRuntimeUpdateAdapter } from "./wsl-runtime-update-adapter.js";

afterEach(() => vi.restoreAllMocks());

const compatibleManifest: RuntimeManifest = {
  schemaVersion: 1,
  runtimeVersion: "0.5.6",
  minShellVersion: "0.1.0",
  requiredEngineVersion: DESKTOP_ENGINE_VERSION,
  requiredNodeVersion: "24.19.0",
  runtimeHostApiVersion: 1,
  apiProtocolVersion: 1,
  dataSchemaVersion: 1,
  platform: "linux",
  arch: "x64",
  entrypoint: "server.mjs",
  files: [{ path: "server.mjs", sha256: "a".repeat(64), size: 1 }],
};

function createManager() {
  return new DesktopEnvironmentManager({
    stateStore: null as never,
    discovery: null as never,
    shellVersion: "0.1.0",
    nodeVersion: "24.19.0",
    runtimeVersion: "0.5.6",
    publicKeyPem: "test-key",
    releaseBaseUrl: "https://releases.example/",
  });
}

describe("DesktopEnvironmentManager Runtime compatibility", () => {
  it("accepts only Server-only Linux Runtimes matching every host boundary", () => {
    const manager = createManager();

    expect(manager.isRuntimeCompatible(compatibleManifest)).toBe(true);
    expect(manager.isRuntimeCompatible({ ...compatibleManifest, webRoot: "web" })).toBe(false);
    expect(
      manager.isRuntimeCompatible({ ...compatibleManifest, requiredEngineVersion: "999" })
    ).toBe(false);
    expect(manager.isRuntimeCompatible({ ...compatibleManifest, runtimeHostApiVersion: 2 })).toBe(
      false
    );
    expect(manager.isRuntimeCompatible({ ...compatibleManifest, minShellVersion: "0.2.0" })).toBe(
      false
    );
  });

  it("creates a host-managed adapter only for a supported matching WSL target", async () => {
    const summary = {
      id: "wsl:ubuntu",
      kind: "wsl" as const,
      label: "WSL: Ubuntu",
      distro: "Ubuntu",
      active: false,
      status: "ready" as const,
      platform: "linux" as const,
      arch: "x64" as const,
    };
    const probe = {
      target: summary,
      home: "/home/alice",
      dataRoot: "/home/alice/.local/share/coder-studio-desktop",
      arch: "x64" as const,
      kernel: "microsoft-standard-WSL2",
      libc: "glibc 2.39",
      engineInstalled: true,
      installed: true,
      supported: true,
    };
    const manager = new DesktopEnvironmentManager({
      stateStore: null as never,
      discovery: {
        listEnvironments: vi.fn(async () => [summary]),
        probe: vi.fn(async () => probe),
      } as never,
      shellVersion: "0.1.0",
      nodeVersion: "24.19.0",
      runtimeVersion: "0.5.6",
      publicKeyPem: "test-key",
      releaseBaseUrl: "https://releases.example/",
    });

    await expect(
      manager.createRuntimeUpdateAdapter("linux-x64", "wsl:ubuntu")
    ).resolves.toBeInstanceOf(WslRuntimeUpdateAdapter);
    await expect(manager.createRuntimeUpdateAdapter("win32-x64", "wsl:ubuntu")).rejects.toThrow(
      "does not match"
    );
  });

  it("downloads a matching signed channel Runtime when shared Web has advanced", async () => {
    const target = {
      id: "wsl:ubuntu",
      kind: "wsl" as const,
      label: "WSL: Ubuntu",
      distro: "Ubuntu",
    };
    const probe = {
      target,
      home: "/home/alice",
      dataRoot: "/home/alice/.local/share/coder-studio-desktop",
      arch: "x64" as const,
      kernel: "microsoft-standard-WSL2",
      libc: "glibc 2.39",
      engineInstalled: true,
      installed: true,
      supported: true,
    };
    const candidate = {
      root: `${probe.dataRoot}/runtime-store/versions/${"a".repeat(24)}`,
      source: "pending" as const,
      pointer: {
        id: "a".repeat(24),
        runtimeVersion: "0.5.6",
        installedAt: "2026-08-08T01:02:03.000Z",
      },
      manifest: compatibleManifest,
    };
    vi.spyOn(WslRuntimeStoreClient.prototype, "getLaunchCandidate")
      .mockRejectedValueOnce(new Error("missing"))
      .mockResolvedValueOnce(candidate);
    const metadata = { version: "0.5.6" } as never;
    const checkRuntime = vi
      .spyOn(WslInstaller.prototype, "checkRuntime")
      .mockResolvedValue(metadata);
    const download = vi
      .spyOn(WslInstaller.prototype, "downloadAndStageRuntime")
      .mockResolvedValue({} as never);
    const prepare = vi.spyOn(WslInstaller.prototype, "prepare").mockResolvedValue({} as never);
    const expected = {
      version: "0.5.6",
      publishedAt: "2026-08-08T01:02:03.000Z",
      manifest: "coder-studio-server-runtime-linux-x64.manifest.json",
    };
    const manager = new DesktopEnvironmentManager({
      stateStore: null as never,
      discovery: { probe: vi.fn(async () => probe) } as never,
      shellVersion: "0.1.0",
      nodeVersion: "24.19.0",
      runtimeVersion: "0.5.6",
      publicKeyPem: "test-key",
      releaseBaseUrl: "https://releases.example/",
      factoryReleaseBaseUrl: "https://factory.example/",
      loadChannel: vi.fn(async () => ({
        runtimes: { "linux-x64": expected },
      })) as never,
    });

    await expect(manager.prepareWsl(target)).resolves.toMatchObject({ runtime: candidate });
    expect(checkRuntime).toHaveBeenCalledWith(probe, expected, "0.1.0");
    expect(download).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
  });
});
