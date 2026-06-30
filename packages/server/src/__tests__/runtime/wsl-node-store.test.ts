import { describe, expect, it } from "vitest";
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

  it("accepts a node version that satisfies the required semver range", () => {
    expect(isCompatibleManagedNodeVersion("20.11.1", ">=20 <21")).toBe(true);
  });

  it("accepts standard caret semver syntax", () => {
    expect(isCompatibleManagedNodeVersion("20.11.1", "^20.11.0")).toBe(true);
  });
});
