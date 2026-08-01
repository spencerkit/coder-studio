import type { AutomationPermission, DomainEvent, ProviderDefinition } from "@coder-studio/core";
import type { RequestAuthContext } from "../auth/index.js";

export type RuntimeRouteTarget =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "session"; sessionId: string }
  | { kind: "terminal"; terminalId: string }
  | { kind: "default" };

export interface RuntimeExecuteMeta {
  clientId?: string;
  authContext?: RequestAuthContext;
}

export type RuntimeSummaryScope = "runtime" | "workspace" | "bridge";

export interface NativeRuntimeSummary {
  id: string;
  kind: "native";
  scope: "runtime";
}

export interface WorkspaceScopedWslRuntimeSummary {
  id: string;
  kind: "wsl";
  scope: "workspace";
  workspaceId: string;
  distro: string;
}

export interface BridgeScopedWslRuntimeSummary {
  id: string;
  kind: "wsl";
  scope: "bridge";
  distro: string;
  runtimeVersion?: string;
  nodeVersion?: string;
  pid?: number;
  uptimeMs?: number;
  activeWorkspaceIds: string[];
}

export type RuntimeSummary =
  | NativeRuntimeSummary
  | WorkspaceScopedWslRuntimeSummary
  | BridgeScopedWslRuntimeSummary;

export interface RuntimeHostBridge {
  issueSessionToken(input: {
    sessionId: string;
    workspaceId: string;
    providerId: string;
    permissions: readonly AutomationPermission[];
  }): { token: string };
  revokeSessionTokensBySessionId(sessionId: string): void;
  getHostApiUrl(): string | undefined;
  emitDomainEvent(event: DomainEvent): void;
  broadcast(topic: string, payload: unknown): void;
  recordWorkspaceFetch?(workspaceId: string): void;
  sendToClient(clientId: string, payload: unknown): boolean;
  sendBinaryToClient(clientId: string, payload: Buffer): boolean;
}

export interface RuntimeHandle {
  id: string;
  kind: "native" | "wsl";
  execute(op: string, args: unknown, meta?: RuntimeExecuteMeta): Promise<unknown>;
  disposeWorkspace(workspaceId: string): Promise<void>;
  setProviderRegistry?(providers: ProviderDefinition[]): void;
  getSummary?(): RuntimeSummary;
  health(): Promise<{ ok: true }>;
}
