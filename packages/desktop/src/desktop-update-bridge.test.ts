import { describe, expect, it, vi } from "vitest";
import { DesktopUpdateBridge } from "./desktop-update-bridge.js";

describe("desktop-update-bridge", () => {
  it("installs a requested runtime and reports restart/success patches", async () => {
    const send = vi.fn();
    const resolveVersion = vi.fn(async () => ({
      version: "0.5.5",
      platform: "win32" as const,
      arch: "x64" as const,
      artifactUrl: "https://example.com/runtime-0.5.5.zip",
      checksumSha256: "sha-055",
      artifactSize: 4096,
      publishedAt: "2026-06-29T00:00:00.000Z",
    }));
    const resolveLatestCompatible = vi.fn(async () => null);
    const installRelease = vi.fn(async () => ({
      version: "0.5.5",
      installedAt: 1,
      path: "/tmp/runtime-store/versions/0.5.5",
      entry: "dist/esm/runtime-launch-entry.mjs",
      webRoot: "dist/web",
      checksumSha256: "sha-055",
      source: "github-release",
    }));
    const restartSidecar = vi.fn(async () => {});

    const bridge = new DesktopUpdateBridge({
      getSidecar: () => ({
        send,
        stop: async () => {},
      }),
      restartSidecar,
      runtimeReleaseProvider: {
        resolveVersion,
        resolveLatestCompatible,
      } as const,
      runtimeInstaller: {
        installRelease,
      },
      releaseTarget: {
        appVersion: "1.2.3",
        platform: "win32",
        arch: "x64",
      },
    });

    await bridge.handleSidecarMessage({
      kind: "desktop-update",
      action: "start-install",
      payload: {
        targetVersion: "0.5.5",
      },
    });

    expect(resolveVersion).toHaveBeenCalledWith("0.5.5", {
      appVersion: "1.2.3",
      platform: "win32",
      arch: "x64",
    });
    expect(installRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "0.5.5",
      })
    );
    expect(restartSidecar).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "desktop-update",
        action: "apply-state-patch",
      })
    );
    expect(send).toHaveBeenLastCalledWith({
      kind: "desktop-update",
      action: "apply-state-patch",
      payload: expect.objectContaining({
        currentVersion: "0.5.5",
        latestVersion: "0.5.5",
        availability: "up_to_date",
        updateStatus: "succeeded",
        targetVersion: "0.5.5",
      }),
    });
  });

  it("resolves desktop-managed update checks through the runtime release provider", async () => {
    const send = vi.fn();
    const resolveVersion = vi.fn(async () => null);
    const resolveLatestCompatible = vi.fn(async () => ({
      version: "0.5.6",
      platform: "win32" as const,
      arch: "x64" as const,
      artifactUrl: "https://example.com/runtime-0.5.6.zip",
      checksumSha256: "sha-056",
      artifactSize: 4096,
      publishedAt: "2026-06-30T00:00:00.000Z",
    }));
    const runtimeReleaseProvider = {
      resolveVersion,
      resolveLatestCompatible,
    };

    const bridge = new DesktopUpdateBridge({
      getSidecar: () => ({
        send,
        stop: async () => {},
      }),
      restartSidecar: vi.fn(async () => {}),
      runtimeReleaseProvider,
      runtimeInstaller: {
        installRelease: vi.fn(async () => {
          throw new Error("should not run");
        }),
      },
      releaseTarget: {
        appVersion: "1.2.3",
        platform: "win32",
        arch: "x64",
      },
    });

    await bridge.handleSidecarMessage({
      kind: "desktop-update",
      action: "check-for-updates",
      payload: {
        requestId: "req-1",
        currentVersion: "0.5.4",
      },
    });

    expect(resolveLatestCompatible).toHaveBeenCalledWith({
      appVersion: "1.2.3",
      platform: "win32",
      arch: "x64",
    });
    expect(send).toHaveBeenLastCalledWith({
      kind: "desktop-update",
      action: "check-for-updates-result",
      payload: {
        requestId: "req-1",
        latestVersion: "0.5.6",
      },
    });
  });

  it("reports failures back to the sidecar", async () => {
    const send = vi.fn();
    const runtimeReleaseProvider = {
      resolveVersion: vi.fn(async () => null),
      resolveLatestCompatible: vi.fn(async () => null),
    };
    const bridge = new DesktopUpdateBridge({
      getSidecar: () => ({
        send,
        stop: async () => {},
      }),
      restartSidecar: vi.fn(async () => {}),
      runtimeReleaseProvider,
      runtimeInstaller: {
        installRelease: vi.fn(async () => {
          throw new Error("should not run");
        }),
      },
      releaseTarget: {
        appVersion: "1.2.3",
        platform: "win32",
        arch: "x64",
      },
    });

    await bridge.handleSidecarMessage({
      kind: "desktop-update",
      action: "start-install",
      payload: {
        targetVersion: "0.5.6",
      },
    });

    expect(send).toHaveBeenLastCalledWith({
      kind: "desktop-update",
      action: "apply-state-patch",
      payload: expect.objectContaining({
        updateStatus: "failed",
        errorSummary: expect.stringMatching(/no compatible desktop runtime release/i),
      }),
    });
  });
});
