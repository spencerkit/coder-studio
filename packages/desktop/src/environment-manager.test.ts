import { describe, expect, it, vi } from "vitest";
import { DesktopEnvironmentManager } from "./environment-manager.js";
import { DESKTOP_ENGINE_VERSION, type RuntimeManifest } from "./runtime-manifest.js";
import { WslRuntimeUpdateAdapter } from "./wsl-runtime-update-adapter.js";

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
});
