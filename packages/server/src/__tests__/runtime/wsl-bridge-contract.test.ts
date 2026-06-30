import { describe, expect, it } from "vitest";
import type { RuntimeSummary } from "../../runtime/contract.js";
import { isWslBridgeInfo, isWslBridgeReady } from "../../runtime/wsl-bridge-contract.js";

const sharedSummary: RuntimeSummary = { scope: "shared", targetRuntime: "native" };
const workspaceSummary: RuntimeSummary = {
  scope: "workspace",
  targetRuntime: "wsl",
  workspaceId: "ws-1",
  wslDistro: "Ubuntu-24.04",
};
const bridgeSummary: RuntimeSummary = {
  scope: "distro-bridge",
  targetRuntime: "wsl",
  wslDistro: "Ubuntu-24.04",
  runtimeVersion: "0.5.6",
  nodeVersion: "20.11.1",
  pid: 123,
  uptimeMs: 10,
  activeWorkspaceIds: ["ws-1"],
};
void sharedSummary;
void workspaceSummary;
void bridgeSummary;

// @ts-expect-error bridge summaries must stay WSL-scoped and fully described
const invalidBridgeSummary: RuntimeSummary = { scope: "distro-bridge", targetRuntime: "native" };
void invalidBridgeSummary;

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

  it("rejects runtime.info payloads with invalid bridge metadata", () => {
    expect(
      isWslBridgeInfo({
        runtimeVersion: "0.5.6",
        nodeVersion: "20.11.1",
        distro: "Ubuntu-24.04",
        pid: -1,
        uptimeMs: 10,
        activeWorkspaceIds: ["ws-1"],
      })
    ).toBe(false);

    expect(
      isWslBridgeInfo({
        runtimeVersion: "0.5.6",
        nodeVersion: "20.11.1",
        distro: "Ubuntu-24.04",
        pid: 123.5,
        uptimeMs: -1,
        activeWorkspaceIds: ["ws-1", 2],
      })
    ).toBe(false);
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

  it("rejects invalid wslBridge.ready signals", () => {
    expect(
      isWslBridgeReady({
        type: "wslBridge.ready",
        host: "",
        port: 4174,
      })
    ).toBe(false);

    expect(
      isWslBridgeReady({
        type: "wslBridge.ready",
        host: "127.0.0.1",
        port: 0,
      })
    ).toBe(false);

    expect(
      isWslBridgeReady({
        type: "wslBridge.ready",
        host: "127.0.0.1",
        port: 65536,
      })
    ).toBe(false);
  });
});
