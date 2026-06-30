import { describe, expect, it } from "vitest";
import { resolveWslDistroRuntimeStoreLayout } from "../../runtime/wsl-distro-store.js";

describe("wsl distro store", () => {
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
});
