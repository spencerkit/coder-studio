import { describe, expect, it, vi } from "vitest";
import { ensureRuntimeReady } from "./runtime-bootstrap.js";

describe("runtime-bootstrap", () => {
  it("skips bootstrap when an active runtime already exists", async () => {
    const resolveLatestCompatible = vi.fn();
    const installRelease = vi.fn();

    const result = await ensureRuntimeReady({
      target: {
        appVersion: "0.5.4",
        platform: "win32",
        arch: "x64",
      },
      readActiveRuntime: async () => ({
        version: "0.5.4",
        installedAt: 1,
        path: "/tmp/runtime-store/versions/0.5.4",
        entry: "dist/esm/runtime-launch-entry.mjs",
        webRoot: "dist/web",
        checksumSha256: "sha-123",
        source: "github-release",
      }),
      resolveLatestCompatible,
      installRelease,
    });

    expect(result.bootstrapApplied).toBe(false);
    expect(resolveLatestCompatible).not.toHaveBeenCalled();
    expect(installRelease).not.toHaveBeenCalled();
  });

  it("reinstalls when the active runtime fails validation", async () => {
    const resolveLatestCompatible = vi.fn(async () => ({
      version: "0.5.5",
      platform: "win32" as const,
      arch: "x64" as const,
      artifactUrl: "https://example.com/runtime.zip",
      checksumSha256: "sha-055",
      artifactSize: 5500,
      publishedAt: "2026-06-29T10:00:00.000Z",
    }));
    const installRelease = vi.fn(async () => ({
      version: "0.5.5",
      installedAt: 2,
      path: "/tmp/runtime-store/versions/0.5.5",
      entry: "dist/esm/runtime-launch-entry.mjs",
      webRoot: "dist/web",
      checksumSha256: "sha-055",
      source: "github-release",
    }));
    const validateActiveRuntime = vi.fn(async () => false);

    const result = await ensureRuntimeReady({
      target: {
        appVersion: "0.5.4",
        platform: "win32",
        arch: "x64",
      },
      readActiveRuntime: async () => ({
        version: "0.5.4",
        installedAt: 1,
        path: "/tmp/runtime-store/versions/0.5.4",
        entry: "dist/esm/runtime-launch-entry.mjs",
        webRoot: "dist/web",
        checksumSha256: "sha-123",
        source: "github-release",
      }),
      resolveLatestCompatible,
      installRelease,
      validateActiveRuntime,
    } as never);

    expect(validateActiveRuntime).toHaveBeenCalledTimes(1);
    expect(resolveLatestCompatible).toHaveBeenCalledTimes(1);
    expect(installRelease).toHaveBeenCalledTimes(1);
    expect(result.bootstrapApplied).toBe(true);
    expect(result.activeRuntime?.version).toBe("0.5.5");
  });

  it("bootstraps the latest compatible runtime on first launch", async () => {
    const resolveLatestCompatible = vi.fn(async () => ({
      version: "0.5.5",
      platform: "win32" as const,
      arch: "x64" as const,
      artifactUrl: "https://example.com/runtime.zip",
      checksumSha256: "sha-055",
      artifactSize: 5500,
      publishedAt: "2026-06-29T10:00:00.000Z",
    }));
    const installRelease = vi.fn(async () => ({
      version: "0.5.5",
      installedAt: 2,
      path: "/tmp/runtime-store/versions/0.5.5",
      entry: "dist/esm/runtime-launch-entry.mjs",
      webRoot: "dist/web",
      checksumSha256: "sha-055",
      source: "github-release",
    }));

    const result = await ensureRuntimeReady({
      target: {
        appVersion: "0.5.4",
        platform: "win32",
        arch: "x64",
      },
      readActiveRuntime: async () => null,
      resolveLatestCompatible,
      installRelease,
    });

    expect(resolveLatestCompatible).toHaveBeenCalledTimes(1);
    expect(installRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "0.5.5",
      })
    );
    expect(result.bootstrapApplied).toBe(true);
    expect(result.activeRuntime?.version).toBe("0.5.5");
  });

  it("surfaces bootstrap failures with phase-specific metadata", async () => {
    await expect(
      ensureRuntimeReady({
        target: {
          appVersion: "0.5.4",
          platform: "win32",
          arch: "x64",
        },
        readActiveRuntime: async () => null,
        resolveLatestCompatible: async () => {
          throw new Error("release index unavailable");
        },
        installRelease: async () => {
          throw new Error("should not run");
        },
      })
    ).rejects.toMatchObject({
      message: "release index unavailable",
      phase: "resolve_release",
    });
  });
});
