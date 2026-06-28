import type {
  CustomProviderConfig,
  DomainEvent,
  ProviderListItem,
  Workspace,
} from "@coder-studio/core";
import type { RuntimeExecuteMeta } from "../contract.js";

export interface RuntimeWorkspaceSnapshot
  extends Pick<Workspace, "id" | "path" | "targetRuntime" | "wslDistro" | "uiState"> {}

export interface WslRuntimeBootstrapPayload {
  runtimeId: string;
  workspace: RuntimeWorkspaceSnapshot;
  stateRoot: string;
  hostApiUrl?: string;
  settings: Record<string, unknown>;
  workspaces: RuntimeWorkspaceSnapshot[];
  customProviders: CustomProviderConfig[];
}

export interface WslRuntimeReadySignal {
  type: "wslRuntime.ready";
  host: string;
  port: number;
}

export interface RemoteProviderSnapshot {
  providers: ProviderListItem[];
}

export interface RemoteStateSnapshot {
  settings: Record<string, unknown>;
  workspaces: RuntimeWorkspaceSnapshot[];
  customProviders: CustomProviderConfig[];
}

export interface RemoteExecuteRequest {
  op: string;
  args: unknown;
  meta?: RuntimeExecuteMeta;
}

export interface RemoteDisposeWorkspaceRequest {
  workspaceId: string;
}

export interface HostSendToClientRequest {
  clientId: string;
  payload: unknown;
}

export interface HostSendBinaryToClientRequest {
  clientId: string;
  payloadBase64: string;
}

export interface HostRevokeSessionTokensRequest {
  sessionId: string;
}

export interface HostRelayCommandRequest {
  id: string;
  op: string;
  args: unknown;
  sessionToken?: string;
}

export type HostNotificationMessage =
  | {
      method: "domainEvent";
      params: {
        event: DomainEvent;
      };
    }
  | {
      method: "broadcast";
      params: {
        topic: string;
        payload: unknown;
      };
    }
  | {
      method: "recordWorkspaceFetch";
      params: {
        workspaceId: string;
      };
    };

export type HostRequestMessage =
  | {
      method: "sendToClient";
      params: HostSendToClientRequest;
    }
  | {
      method: "sendBinaryToClient";
      params: HostSendBinaryToClientRequest;
    }
  | {
      method: "revokeSessionTokensBySessionId";
      params: HostRevokeSessionTokensRequest;
    }
  | {
      method: "relayHostCommand";
      params: HostRelayCommandRequest;
    };

export interface JsonRpcRequestMessage {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotificationMessage {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessMessage {
  jsonrpc: "2.0";
  id: number;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: string;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorMessage {
  jsonrpc: "2.0";
  id: number;
  error: JsonRpcErrorObject;
}

export type JsonRpcInboundMessage =
  | JsonRpcRequestMessage
  | JsonRpcNotificationMessage
  | JsonRpcSuccessMessage
  | JsonRpcErrorMessage;

export function normalizeRemoteError(error: unknown): JsonRpcErrorObject {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return {
      code: (error as { code: string }).code,
      message: (error as { message: string }).message,
      data: "data" in error ? (error as { data?: unknown }).data : undefined,
    };
  }

  if (error instanceof Error) {
    return {
      code: "internal_error",
      message: error.message,
    };
  }

  return {
    code: "internal_error",
    message: typeof error === "string" ? error : "Unknown remote runtime error",
  };
}

export function toThrowableRemoteError(error: JsonRpcErrorObject): {
  code: string;
  message: string;
  data?: unknown;
} {
  return {
    code: error.code,
    message: error.message,
    ...(error.data !== undefined ? { data: error.data } : {}),
  };
}
