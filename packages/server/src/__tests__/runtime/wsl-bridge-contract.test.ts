import { describe, expect, it } from "vitest";
import { isWslBridgeInfo, isWslBridgeReady } from "../../runtime/wsl-bridge-contract.js";

describe("wsl-bridge-contract", () => {
  it("accepts valid runtime.info payloads", () => {
    expect(
      isWslBridgeInfo({
        runtimeVersion: "0.5.6",
        nodeVersion: "20.11.1",
        distro: "Ubuntu-24.04",
        pid: 123,
        uptimeMs: 10,
        activeWorkspaceIds: ["ws-1"],
      })
    ).toBe(true);
  });

  it("accepts valid wslBridge.ready signals", () => {
    expect(
      isWslBridgeReady({
        type: "wslBridge.ready",
        host: "127.0.0.1",
        port: 4174,
      })
    ).toBe(true);
  });
});
