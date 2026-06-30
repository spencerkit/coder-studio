import type { AutomationPermission, DomainEvent, ProviderDefinition } from "@coder-studio/core";
import type { RequestAuthContext } from "../auth/index.js";
import type { RuntimeAssemblyResources } from "./assembly.js";
import type { RuntimeCommandContext } from "./context.js";
import type { RemoteStateSnapshot } from "./remote/protocol.js";

export type RuntimeRouteTarget =
  | { kind: "runtime"; runtimeId: string }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "session"; sessionId: string }
  | { kind: "terminal"; terminalId: string }
  | { kind: "default" };

export interface RuntimeExecuteMeta {
  clientId?: string;
  clientOwnerId?: string;
  authContext?: RequestAuthContext;
  sessionBootstrap?: RuntimeSessionBootstrap;
}

export interface RuntimeSessionBootstrap {
  sessionId: string;
  sessionToken: string;
  apiUrl?: string;
}

export type RuntimeSummaryScope = "shared" | "workspace" | "distro-bridge";

export interface RuntimeSummary {
  scope: RuntimeSummaryScope;
  targetRuntime: "native" | "wsl";
  workspaceId?: string;
  wslDistro?: string;
  runtimeVersion?: string;
  nodeVersion?: string;
  pid?: number;
  uptimeMs?: number;
  activeWorkspaceIds?: string[];
}

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
  resolveClientOwnerId?(clientId: string): string | undefined;
  sendToClient(clientId: string, payload: unknown): boolean;
  sendBinaryToClient(clientId: string, payload: Buffer): boolean;
}

export interface RuntimeHandle {
  id: string;
  kind: "native" | "wsl";
  summary?: RuntimeSummary;
  execute(op: string, args: unknown, meta?: RuntimeExecuteMeta): Promise<unknown>;
  disposeWorkspace(workspaceId: string): Promise<void>;
  setProviderRegistry?(providers: ProviderDefinition[]): void | Promise<void>;
  syncSnapshot?(snapshot: RemoteStateSnapshot): void | Promise<void>;
  health(): Promise<{ ok: true }>;
  stop?(): Promise<void>;
  getContext?(): RuntimeCommandContext;
  getResources?(): RuntimeAssemblyResources;
}
