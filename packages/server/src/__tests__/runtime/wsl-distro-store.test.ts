import { describe, expect, it, vi } from "vitest";
import { resolveWslDistroRuntimeStoreLayout } from "../../runtime/wsl-distro-store.js";

describe("wsl distro store", () => {
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
});
