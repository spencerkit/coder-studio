import { access } from "node:fs/promises";
import { providerRegistry as builtinProviderRegistry } from "@coder-studio/providers";
import "../commands/index.js";
import { buildCustomProviderDefinition } from "../provider-runtime/custom-provider.js";
import type { SettingsRepo } from "../storage/repositories/settings-repo.js";
import { getRegisteredRuntimeCommands } from "./command-registry.js";
import type { RuntimeHostBridge } from "./contract.js";
import { createNativeRuntime } from "./native-runtime.js";
import {
  type HostNotificationMessage,
  type HostRequestMessage,
  type JsonRpcInboundMessage,
  type JsonRpcNotificationMessage,
  type JsonRpcRequestMessage,
  type JsonRpcSuccessMessage,
  normalizeRemoteError,
  type RemoteProviderSnapshot,
  type RemoteStateSnapshot,
  type WslRuntimeBootstrapPayload,
} from "./remote/protocol.js";
import { buildRemoteStateSnapshot } from "./remote/state-snapshot.js";

function assertRemoteRuntimeLoaded(): void {
  if (getRegisteredRuntimeCommands({ includeInternal: true }).length > 0) {
    return;
  }

  throw new Error(
    "No runtime commands are registered in the WSL runtime entrypoint. Ensure registerAllCommands() has been imported."
  );
}

function parseBootstrapPayload(): WslRuntimeBootstrapPayload {
  const raw = process.env.CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP;
  if (!raw) {
    throw new Error("Missing CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP");
  }

  return JSON.parse(raw) as WslRuntimeBootstrapPayload;
}

async function validateBootstrapWorkspace(bootstrap: WslRuntimeBootstrapPayload): Promise<void> {
  if (!bootstrap.workspace.path.startsWith("/")) {
    throw new Error("WSL runtime bootstrap requires a Linux workspace path");
  }

  await access(bootstrap.workspace.path);
}

function createMutableWorkspaceLookup(initialWorkspaces: WslRuntimeBootstrapPayload["workspaces"]) {
  const byId = new Map(
    initialWorkspaces.map((workspace) => [
      workspace.id,
      {
        ...workspace,
      },
    ])
  );

  return {
    get(workspaceId: string) {
      return byId.get(workspaceId);
    },
    list() {
      return Array.from(byId.values(), (workspace) => ({ ...workspace }));
    },
    replace(workspaces: WslRuntimeBootstrapPayload["workspaces"]) {
      byId.clear();
      for (const workspace of workspaces) {
        byId.set(workspace.id, {
          ...workspace,
        });
      }
    },
  };
}

function createMutableSettingsStore(initialSettings: Record<string, unknown>) {
  let settings = { ...initialSettings };
  return {
    getAll() {
      return { ...settings };
    },
    replace(nextSettings: Record<string, unknown>) {
      settings = { ...nextSettings };
    },
  };
}

function createProviderRegistrySnapshot(
  customProviders: WslRuntimeBootstrapPayload["customProviders"]
) {
  return [
    ...builtinProviderRegistry,
    ...customProviders.map((config) => buildCustomProviderDefinition(config)),
  ];
}

function writeMessage(
  stream: NodeJS.WritableStream,
  message: Record<string, unknown>
): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function isRequestMessage(message: JsonRpcInboundMessage): message is JsonRpcRequestMessage {
  return "id" in message && "method" in message;
}

function isNotificationMessage(
  message: JsonRpcInboundMessage
): message is JsonRpcNotificationMessage {
  return !("id" in message) && "method" in message;
}

function isSuccessMessage(message: JsonRpcInboundMessage): message is JsonRpcSuccessMessage {
  return "id" in message && "result" in message;
}

async function sendHostBridgeNotification(
  method: HostNotificationMessage["method"],
  params: HostNotificationMessage["params"]
): Promise<void> {
  await writeMessage(process.stdout, {
    jsonrpc: "2.0",
    method,
    params,
  });
}

function createRemoteHostBridge(hostApiUrl?: string): RuntimeHostBridge {
  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: unknown): void;
    }
  >();

  const requestHost = async (
    method: HostRequestMessage["method"],
    params: HostRequestMessage["params"]
  ): Promise<unknown> => {
    const id = nextId++;
    return new Promise(async (resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        await writeMessage(process.stdout, {
          jsonrpc: "2.0",
          id,
          method,
          params,
        });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  };

  return {
    issueSessionToken() {
      throw new Error("WSL runtime must receive pre-issued session bootstrap tokens from host");
    },
    revokeSessionTokensBySessionId(sessionId) {
      void requestHost("revokeSessionTokensBySessionId", { sessionId });
    },
    getHostApiUrl() {
      return hostApiUrl;
    },
    emitDomainEvent(event) {
      void sendHostBridgeNotification("domainEvent", { event });
    },
    broadcast(topic, payload) {
      void sendHostBridgeNotification("broadcast", { topic, payload });
    },
    recordWorkspaceFetch(workspaceId) {
      void sendHostBridgeNotification("recordWorkspaceFetch", { workspaceId });
    },
    resolveClientOwnerId(clientId) {
      return clientId;
    },
    sendToClient(clientId, payload) {
      void requestHost("sendToClient", { clientId, payload });
      return true;
    },
    sendBinaryToClient(clientId, payload) {
      void requestHost("sendBinaryToClient", {
        clientId,
        payloadBase64: payload.toString("base64"),
      });
      return true;
    },
    __pending: pending,
  } as RuntimeHostBridge & {
    __pending: Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>;
  };
}

export async function runWslRuntimeEntrypoint(): Promise<void> {
  assertRemoteRuntimeLoaded();
  const bootstrap = parseBootstrapPayload();
  await validateBootstrapWorkspace(bootstrap);

  const workspaceLookup = createMutableWorkspaceLookup(bootstrap.workspaces);
  const settingsStore = createMutableSettingsStore(bootstrap.settings);
  let customProviders = bootstrap.customProviders.map((config) => ({
    ...config,
    args: [...config.args],
    env: { ...config.env },
    capabilities: config.capabilities.map((capability) => ({ ...capability })),
  }));
  let providerRegistry = createProviderRegistrySnapshot(customProviders);
  const hostBridge = createRemoteHostBridge(bootstrap.hostApiUrl);
  const readonlySettingsRepo = {
    get: <T = unknown>(key: string) => settingsStore.getAll()[key] as T | undefined,
    set: () => {
      throw new Error("WSL runtime settings mirror is read-only");
    },
    delete: () => {
      throw new Error("WSL runtime settings mirror is read-only");
    },
    listKeys: () => Object.keys(settingsStore.getAll()),
    getAll: () => settingsStore.getAll(),
  } satisfies Pick<SettingsRepo, "get" | "set" | "delete" | "listKeys" | "getAll">;

  const runtime = await createNativeRuntime({
    runtimeId: bootstrap.runtimeId,
    stateRoot: bootstrap.stateRoot,
    runtimeStateRoot: bootstrap.stateRoot,
    hostBridge,
    providerRegistry,
    workspaceLookup,
    settingsRepo: readonlySettingsRepo as unknown as Parameters<
      typeof createNativeRuntime
    >[0]["settingsRepo"],
  });

  const context = runtime.getContext?.();
  const resources = runtime.getResources?.();
  if (!context) {
    throw new Error("WSL runtime entry did not expose runtime context");
  }

  const applySnapshot = async (snapshot: RemoteStateSnapshot): Promise<void> => {
    settingsStore.replace(snapshot.settings);
    workspaceLookup.replace(snapshot.workspaces);
    customProviders = snapshot.customProviders.map((config) => ({
      ...config,
      args: [...config.args],
      env: { ...config.env },
      capabilities: config.capabilities.map((capability) => ({ ...capability })),
    }));
    providerRegistry.splice(
      0,
      providerRegistry.length,
      ...createProviderRegistrySnapshot(customProviders)
    );
    context.sessionMgr.setProviderRegistry(providerRegistry);
    context.supervisorMgr.setProviderRegistry(providerRegistry);
    resources?.providerInstallMgr.setProviders(providerRegistry);
  };

  const applyProviderSnapshot = async (snapshot: RemoteProviderSnapshot): Promise<void> => {
    const nextById = new Map(snapshot.providers.map((provider) => [provider.id, provider]));
    const nextProviders = providerRegistry.filter((provider) => nextById.has(provider.id));
    providerRegistry.splice(0, providerRegistry.length, ...nextProviders);
    context.sessionMgr.setProviderRegistry(providerRegistry);
    context.supervisorMgr.setProviderRegistry(providerRegistry);
    resources?.providerInstallMgr.setProviders(providerRegistry);
  };

  const readline = (await import("node:readline")).createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  const pendingHost = (
    hostBridge as RuntimeHostBridge & {
      __pending: Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>;
    }
  ).__pending;

  const replySuccess = async (id: number, result: unknown): Promise<void> => {
    await writeMessage(process.stdout, {
      jsonrpc: "2.0",
      id,
      result,
    });
  };

  const replyError = async (id: number, error: unknown): Promise<void> => {
    await writeMessage(process.stdout, {
      jsonrpc: "2.0",
      id,
      error: normalizeRemoteError(error),
    });
  };

  readline.on("line", (line) => {
    void (async () => {
      if (!line.trim()) {
        return;
      }

      const parsed = JSON.parse(line) as JsonRpcInboundMessage;
      if (isSuccessMessage(parsed)) {
        pendingHost.get(parsed.id)?.resolve(parsed.result);
        pendingHost.delete(parsed.id);
        return;
      }

      if ("id" in parsed && "error" in parsed) {
        pendingHost.get(parsed.id)?.reject(parsed.error);
        pendingHost.delete(parsed.id);
        return;
      }

      if (isNotificationMessage(parsed)) {
        if (parsed.method === "updateSnapshot") {
          await applySnapshot(parsed.params as RemoteStateSnapshot);
          return;
        }
        if (parsed.method === "updateProviders") {
          await applyProviderSnapshot(parsed.params as RemoteProviderSnapshot);
        }
        return;
      }

      if (!isRequestMessage(parsed)) {
        return;
      }

      const request: JsonRpcRequestMessage = parsed;

      try {
        if (request.method === "execute") {
          const params = request.params as {
            op: string;
            args: unknown;
            meta?: unknown;
          };
          await replySuccess(
            request.id,
            await runtime.execute(params.op, params.args, params.meta as never)
          );
          return;
        }

        if (request.method === "disposeWorkspace") {
          const params = request.params as { workspaceId: string };
          await runtime.disposeWorkspace(params.workspaceId);
          await replySuccess(request.id, { disposed: true });
          return;
        }

        if (request.method === "health") {
          await replySuccess(request.id, await runtime.health());
          return;
        }

        if (request.method === "stop") {
          await replySuccess(request.id, { stopped: true });
          await runtime.stop?.();
          readline.close();
          process.exit(0);
        }

        await replyError(request.id, {
          code: "unknown_method",
          message: `Unknown WSL runtime RPC method: ${request.method}`,
        });
      } catch (error) {
        await replyError(request.id, error);
      }
    })();
  });

  await applySnapshot(
    buildRemoteStateSnapshot({
      settings: bootstrap.settings,
      workspaces: bootstrap.workspaces,
      customProviders,
    })
  );
}
