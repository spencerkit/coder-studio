import { describe, expect, it } from "vitest";
import { DesktopEnvironmentManager } from "./environment-manager.js";
import { DESKTOP_ENGINE_VERSION, type RuntimeManifest } from "./runtime-manifest.js";

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
});
