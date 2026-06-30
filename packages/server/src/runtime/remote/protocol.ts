import type {
  WslBridgeDrainPayload,
  WslBridgeExecutePayload,
  WslBridgeHealthPayload,
  WslBridgeInfoRequestPayload,
  WslBridgeReadySignal,
  WslBridgeStopPayload,
  WslBridgeWorkspaceAttachPayload,
  WslBridgeWorkspaceDisposePayload,
} from "../wsl-bridge-contract.js";

export interface RemoteRpcRequestEnvelope<TType extends string = string, TPayload = unknown> {
  id: string;
  type: TType;
  payload: TPayload;
}

export interface RemoteRpcSuccessEnvelope<TResult = unknown> {
  id: string;
  ok: true;
  result: TResult;
}

export interface RemoteRpcErrorEnvelope {
  id: string;
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type RemoteRpcResponseEnvelope<TResult = unknown> =
  | RemoteRpcSuccessEnvelope<TResult>
  | RemoteRpcErrorEnvelope;

export interface WslRuntimeReadySignal {
  type: "wslRuntime.ready";
  workspaceId: string;
  host: string;
  port: number;
}

export type RemoteRuntimeScope = "workspace" | "bridge";

export interface WorkspaceScopedRuntimeReadySignal {
  scope: "workspace";
  signal: WslRuntimeReadySignal;
}

export interface BridgeScopedRuntimeReadySignal {
  scope: "bridge";
  signal: WslBridgeReadySignal;
}

export type RemoteRuntimeReadySignal =
  | WorkspaceScopedRuntimeReadySignal
  | BridgeScopedRuntimeReadySignal;

export type WslBridgeRpcRequest =
  | RemoteRpcRequestEnvelope<"health", WslBridgeHealthPayload>
  | RemoteRpcRequestEnvelope<"runtime.info", WslBridgeInfoRequestPayload>
  | RemoteRpcRequestEnvelope<"workspace.attach", WslBridgeWorkspaceAttachPayload>
  | RemoteRpcRequestEnvelope<"workspace.dispose", WslBridgeWorkspaceDisposePayload>
  | RemoteRpcRequestEnvelope<"execute", WslBridgeExecutePayload>
  | RemoteRpcRequestEnvelope<"drain", WslBridgeDrainPayload>
  | RemoteRpcRequestEnvelope<"stop", WslBridgeStopPayload>;
