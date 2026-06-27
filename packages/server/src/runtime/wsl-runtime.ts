import { spawn } from "node:child_process";
import type { ProviderDefinition, Workspace } from "@coder-studio/core";
import { toProviderListItem } from "@coder-studio/providers";
import type { RuntimeCommandContext } from "./context.js";
import type { RuntimeExecuteMeta, RuntimeHandle, RuntimeHostBridge } from "./contract.js";
import {
  type HostNotificationMessage,
  type HostRequestMessage,
  type RemoteDisposeWorkspaceRequest,
  type RemoteExecuteRequest,
  type RemoteProviderSnapshot,
} from "./remote/protocol.js";
import {
  cloneCustomProviderConfigs,
  cloneSettingsSnapshot,
  cloneWorkspaceSnapshots,
} from "./remote/state-snapshot.js";
import { createStdioJsonRpcClient } from "./remote/stdio-json-rpc.js";
import { resolveWslRuntimeLaunchSpec } from "./wsl-bootstrap.js";

function serializeProviderSnapshot(providers: ProviderDefinition[]): RemoteProviderSnapshot {
  return {
    providers: providers.map((provider) => toProviderListItem(provider)),
  };
}

async function routeHostNotification(
  hostBridge: RuntimeHostBridge,
  method: HostNotificationMessage["method"],
  params: unknown
): Promise<void> {
  if (method === "domainEvent") {
    const message = params as Extract<HostNotificationMessage, { method: "domainEvent" }>["params"];
    hostBridge.emitDomainEvent(message.event);
    return;
  }

  if (method === "broadcast") {
    const message = params as Extract<HostNotificationMessage, { method: "broadcast" }>["params"];
    hostBridge.broadcast(message.topic, message.payload);
    return;
  }

  if (method === "recordWorkspaceFetch") {
    const message = params as Extract<
      HostNotificationMessage,
      { method: "recordWorkspaceFetch" }
    >["params"];
    hostBridge.recordWorkspaceFetch?.(message.workspaceId);
    return;
  }
}

async function routeHostRequest(
  hostBridge: RuntimeHostBridge,
  method: HostRequestMessage["method"],
  params: unknown
): Promise<unknown> {
  if (method === "sendToClient") {
    const message = params as Extract<HostRequestMessage, { method: "sendToClient" }>["params"];
    return hostBridge.sendToClient(message.clientId, message.payload);
  }

  if (method === "sendBinaryToClient") {
    const message = params as Extract<
      HostRequestMessage,
      { method: "sendBinaryToClient" }
    >["params"];
    return hostBridge.sendBinaryToClient(
      message.clientId,
      Buffer.from(message.payloadBase64, "base64")
    );
  }

  if (method === "revokeSessionTokensBySessionId") {
    const message = params as Extract<
      HostRequestMessage,
      { method: "revokeSessionTokensBySessionId" }
    >["params"];
    hostBridge.revokeSessionTokensBySessionId(message.sessionId);
    return { revoked: true };
  }

  throw {
    code: "unknown_host_bridge_method",
    message: `Unknown host bridge request: ${method}`,
  };
}

type WorkspaceWslRuntimeInput = {
  runtimeId: string;
  workspace: Pick<
    Workspace,
    "id" | "path" | "targetRuntime" | "wslDistro" | "openedAt" | "lastActiveAt" | "uiState"
  >;
  stateRoot: string;
  hostBridge: RuntimeHostBridge;
  providerRegistry: RuntimeCommandContext["providerRegistry"];
  workspaceLookup: RuntimeCommandContext["workspaceLookup"];
  settingsSnapshot: Record<string, unknown>;
  customProviderConfigs: import("@coder-studio/core").CustomProviderConfig[];
  providerRuntimeDeps?: RuntimeCommandContext["providerRuntimeDeps"];
  createSessionBootstrap?(request: {
    workspaceId: string;
    providerId: string;
    runtimeId: string;
  }): Promise<NonNullable<RuntimeExecuteMeta["sessionBootstrap"]>>;
  resolveClientOwnerId?(clientId: string): string | undefined;
  revokeRuntimeTokens?(runtimeId: string): void;
};

function shouldInjectSessionBootstrap(
  op: string,
  args: unknown
): args is { workspaceId: string; providerId: string } {
  return (
    op === "session.create" &&
    !!args &&
    typeof args === "object" &&
    typeof (args as { workspaceId?: unknown }).workspaceId === "string" &&
    typeof (args as { providerId?: unknown }).providerId === "string"
  );
}

function shouldInjectClientOwnerId(
  meta: RuntimeExecuteMeta | undefined
): meta is RuntimeExecuteMeta & { clientId: string } {
  return typeof meta?.clientId === "string" && !meta.clientOwnerId;
}

async function augmentExecuteMeta(
  input: WorkspaceWslRuntimeInput,
  op: string,
  args: unknown,
  meta?: RuntimeExecuteMeta
): Promise<RuntimeExecuteMeta | undefined> {
  if (!meta && !input.createSessionBootstrap) {
    return meta;
  }

  const nextMeta: RuntimeExecuteMeta = { ...meta };

  if (shouldInjectClientOwnerId(meta)) {
    nextMeta.clientOwnerId = input.resolveClientOwnerId?.(meta.clientId) ?? meta.clientId;
  }

  if (
    shouldInjectSessionBootstrap(op, args) &&
    !nextMeta.sessionBootstrap &&
    input.createSessionBootstrap
  ) {
    nextMeta.sessionBootstrap = await input.createSessionBootstrap({
      workspaceId: args.workspaceId,
      providerId: args.providerId,
      runtimeId: input.runtimeId,
    });
  }

  return nextMeta;
}

export async function createWslRuntime(input: WorkspaceWslRuntimeInput): Promise<RuntimeHandle> {
  const launchSpec = await resolveWslRuntimeLaunchSpec({
    runtimeId: input.runtimeId,
    stateRoot: input.stateRoot,
    workspace: input.workspace,
    settingsSnapshot: cloneSettingsSnapshot(input.settingsSnapshot),
    workspaceSnapshot: cloneWorkspaceSnapshots(input.workspaceLookup.list()),
    customProviderConfigs: cloneCustomProviderConfigs(input.customProviderConfigs),
    hostApiUrl: input.hostBridge.getHostApiUrl(),
  });

  const child = spawn(launchSpec.command, launchSpec.args, {
    cwd: launchSpec.cwd,
    env: {
      ...process.env,
      ...launchSpec.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const rpc = await createStdioJsonRpcClient({
    child,
    runtimeId: input.runtimeId,
    onNotification: (method, params) =>
      routeHostNotification(input.hostBridge, method as HostNotificationMessage["method"], params),
    onRequest: (method, params) =>
      routeHostRequest(input.hostBridge, method as HostRequestMessage["method"], params),
  });
  await rpc.request("health", {});

  let stopped = false;

  const stopRuntime = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;
    input.revokeRuntimeTokens?.(input.runtimeId);
    try {
      await rpc.request("stop", {});
    } finally {
      await rpc.dispose();
      child.kill();
    }
  };

  return {
    id: input.runtimeId,
    kind: "wsl",
    summary: {
      scope: "workspace",
      workspaceId: input.workspace.id,
      targetRuntime: "wsl",
      wslDistro: input.workspace.wslDistro,
    },
    async execute(op, args, meta) {
      const nextMeta = await augmentExecuteMeta(input, op, args, meta);
      return rpc.request("execute", {
        op,
        args,
        ...(nextMeta ? { meta: nextMeta } : {}),
      } satisfies RemoteExecuteRequest);
    },
    async disposeWorkspace(workspaceId) {
      await rpc.request("disposeWorkspace", {
        workspaceId,
      } satisfies RemoteDisposeWorkspaceRequest);
      if (workspaceId === input.workspace.id) {
        input.revokeRuntimeTokens?.(input.runtimeId);
      }
    },
    async setProviderRegistry(providers) {
      await rpc.notify("updateProviders", serializeProviderSnapshot(providers));
    },
    async syncSnapshot(snapshot) {
      await rpc.notify("updateSnapshot", snapshot);
    },
    async health() {
      return (await rpc.request("health", {})) as { ok: true };
    },
    stop: stopRuntime,
  };
}
