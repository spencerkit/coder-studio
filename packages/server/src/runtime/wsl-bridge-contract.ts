import type { RuntimeExecuteMeta } from "./contract.js";

export const WSL_BRIDGE_RPC_TYPES = [
  "health",
  "runtime.info",
  "workspace.attach",
  "workspace.dispose",
  "execute",
  "drain",
  "stop",
] as const;

export type WslBridgeRpcType = (typeof WSL_BRIDGE_RPC_TYPES)[number];

export interface WslBridgeHealthPayload {}

export interface WslBridgeInfoRequestPayload {}

export interface WslBridgeHealth {
  ok: true;
}

export interface WslBridgeInfo {
  runtimeVersion: string;
  nodeVersion: string;
  distro: string;
  pid: number;
  uptimeMs: number;
  activeWorkspaceIds: string[];
}

export interface WslBridgeWorkspaceAttachPayload {
  workspaceId: string;
}

export interface WslBridgeWorkspaceDisposePayload {
  workspaceId: string;
}

export interface WslBridgeExecutePayload {
  workspaceId: string;
  op: string;
  args: unknown;
  meta?: RuntimeExecuteMeta;
}

export interface WslBridgeDrainPayload {
  timeoutMs?: number;
}

export interface WslBridgeStopPayload {
  reason?: string;
}

export interface WslBridgeReadySignal {
  type: "wslBridge.ready";
  host: string;
  port: number;
}

export interface WslBridgeRequestPayloadByType {
  health: WslBridgeHealthPayload;
  "runtime.info": WslBridgeInfoRequestPayload;
  "workspace.attach": WslBridgeWorkspaceAttachPayload;
  "workspace.dispose": WslBridgeWorkspaceDisposePayload;
  execute: WslBridgeExecutePayload;
  drain: WslBridgeDrainPayload;
  stop: WslBridgeStopPayload;
}

export interface WslBridgeResponseByType {
  health: WslBridgeHealth;
  "runtime.info": WslBridgeInfo;
  "workspace.attach": { ok: true };
  "workspace.dispose": { ok: true };
  execute: unknown;
  drain: { ok: true };
  stop: { ok: true };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isWslBridgeInfo(value: unknown): value is WslBridgeInfo {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.runtimeVersion === "string" &&
    typeof value.nodeVersion === "string" &&
    typeof value.distro === "string" &&
    typeof value.pid === "number" &&
    Number.isFinite(value.pid) &&
    typeof value.uptimeMs === "number" &&
    Number.isFinite(value.uptimeMs) &&
    isStringArray(value.activeWorkspaceIds)
  );
}

export function isWslBridgeReady(value: unknown): value is WslBridgeReadySignal {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    value.type === "wslBridge.ready" &&
    typeof value.host === "string" &&
    typeof value.port === "number" &&
    Number.isInteger(value.port)
  );
}
