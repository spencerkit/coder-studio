import { describe, expect, it, vi } from "vitest";
import type { ProductChannelRuntime } from "./product-channel.js";
import type { WslDistroProbe } from "./wsl-discovery.js";
import type { WslRuntimeUpdateMetadata } from "./wsl-installer.js";
import { WslRuntimeUpdateAdapter } from "./wsl-runtime-update-adapter.js";

const probe: WslDistroProbe = {
  target: {
    id: "wsl:ubuntu",
    kind: "wsl",
    label: "WSL: Ubuntu",
    distro: "Ubuntu",
  },
  home: "/home/alice",
  dataRoot: "/home/alice/.local/share/coder-studio-desktop",
  arch: "x64",
  kernel: "microsoft-standard-WSL2",
  libc: "glibc 2.39",
  engineInstalled: true,
  installed: true,
  supported: true,
};

describe("WslRuntimeUpdateAdapter", () => {
  it("binds one discovered distribution and forwards explicit retry options", async () => {
    const expected: ProductChannelRuntime = {
      version: "0.6.0",
      publishedAt: "2026-08-08T01:02:03.000Z",
      manifest: "runtime.manifest.json",
      manifestSha256: "a".repeat(64),
    };
    const metadata = { version: "0.6.0", probe } as WslRuntimeUpdateMetadata;
    const installer = {
      checkRuntime: vi.fn(async () => metadata),
      downloadAndStageRuntime: vi.fn(async () => ({ manifest: metadata.manifest })),
    };
    const runtimeStore = {
      getLaunchCandidate: vi.fn(async () => ({ manifest: { runtimeVersion: "0.5.0" } })),
      readPendingVersion: vi.fn(async () => "0.6.0"),
    };
    const adapter = new WslRuntimeUpdateAdapter({
      probe,
      installer: installer as never,
      runtimeStore: runtimeStore as never,
    });
    const checked = await adapter.checkMetadata(expected, "0.7.0", "v0.6.0");
    const options = {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      explicitRetry: true,
    };

    await adapter.downloadAndStage(checked, options);

    expect(installer.checkRuntime).toHaveBeenCalledWith(probe, expected, "0.7.0", "v0.6.0");
    expect(installer.downloadAndStageRuntime).toHaveBeenCalledWith(metadata, options);
    await expect(adapter.getCurrentVersion()).resolves.toBe("0.5.0");
    await expect(adapter.getCurrentManifest()).resolves.toEqual({ runtimeVersion: "0.5.0" });
    await expect(adapter.getPendingVersion()).resolves.toBe("0.6.0");
  });
});
