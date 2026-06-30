import { describe, expect, it, vi } from "vitest";
import {
  isCompatibleManagedNodeVersion,
  resolveManagedWslNodePath,
  resolveManagedWslNodeRoot,
} from "../../runtime/wsl-node-store.js";

describe("wsl node store", () => {
  it("resolves the distro-local managed node root", () => {
    expect(resolveManagedWslNodeRoot("/home/me")).toBe("/home/me/.coder-studio/node");
  });

  it("places managed node under the distro-local node root", () => {
    expect(resolveManagedWslNodePath("/home/me", "20.11.1")).toBe(
      "/home/me/.coder-studio/node/20.11.1/bin/node"
    );
  });

  it("keeps managed node paths POSIX-stable even if host path joining is win32-like", async () => {
    vi.resetModules();
    vi.doMock("node:path", async () => {
      const actual = await vi.importActual<typeof import("node:path")>("node:path");
      return {
        ...actual,
        join: actual.win32.join,
      };
    });

    try {
      const { resolveManagedWslNodePath: resolvePath, resolveManagedWslNodeRoot: resolveRoot } =
        await import("../../runtime/wsl-node-store.js");

      expect(resolveRoot("/home/me")).toBe("/home/me/.coder-studio/node");
      expect(resolvePath("/home/me", "20.11.1")).toBe(
        "/home/me/.coder-studio/node/20.11.1/bin/node"
      );
    } finally {
      vi.doUnmock("node:path");
      vi.resetModules();
    }
  });

  it("accepts a node version that satisfies the required semver range", () => {
    expect(isCompatibleManagedNodeVersion("20.11.1", ">=20 <21")).toBe(true);
  });

  it("accepts standard caret semver syntax", () => {
    expect(isCompatibleManagedNodeVersion("20.11.1", "^20.11.0")).toBe(true);
  });

  it("rejects an incompatible major version", () => {
    expect(isCompatibleManagedNodeVersion("22.0.0", "^20.11.0")).toBe(false);
  });

  it("rejects an invalid current version", () => {
    expect(isCompatibleManagedNodeVersion("not-a-version", "^20.11.0")).toBe(false);
  });

  it("rejects an invalid required range", () => {
    expect(isCompatibleManagedNodeVersion("20.11.1", "this is not semver")).toBe(false);
  });

  it("accepts a current version with a leading v prefix", () => {
    expect(isCompatibleManagedNodeVersion("v20.11.1", "^20.11.0")).toBe(true);
  });
});
