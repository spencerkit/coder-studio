import { access } from "node:fs/promises";
import type { Result } from "@coder-studio/core";
import { providerRegistry as builtinProviderRegistry } from "@coder-studio/providers";
import "../commands/index.js";
import { checkCommandAvailable } from "../provider-runtime/command-check.js";
import { runCommandAsString } from "../provider-runtime/command-runner.js";
import { buildCustomProviderDefinition } from "../provider-runtime/custom-provider.js";
import type { RuntimeStatusDeps } from "../provider-runtime/runtime-status.js";
import type { SettingsRepo } from "../storage/repositories/settings-repo.js";
import { getRegisteredRuntimeCommands } from "./command-registry.js";
import type { RuntimeHostBridge } from "./contract.js";
import { createNativeRuntime } from "./native-runtime.js";
import {
  type HostNotificationMessage,
  type HostRequestMessage,
  type RemoteProviderSnapshot,
  type RemoteStateSnapshot,
  type WslRuntimeBootstrapPayload,
  type WslRuntimeReadySignal,
} from "./remote/protocol.js";
import { createSocketJsonRpcServer } from "./remote/socket-json-rpc.js";
import { buildRemoteStateSnapshot } from "./remote/state-snapshot.js";
import { resolveWslSessionHostApiUrl, WSL_LOCAL_HOST_API_PORT } from "./wsl-bootstrap.js";
import { startWslHostApiProxy } from "./wsl-host-api-proxy.js";
import {
  createWslLinuxNativeProcessEnv,
  isWslLinuxNativeCommandAvailable,
  normalizeWslRuntimeProcessPath,
} from "./wsl-runtime-path.js";

function createWslProviderRuntimeDeps(): RuntimeStatusDeps {
  const linuxNativeEnv = () => createWslLinuxNativeProcessEnv();

  const commandExists = async (command: string): Promise<boolean> => {
    const env = linuxNativeEnv();
    if (isWslLinuxNativeCommandAvailable(command, env)) {
      return true;
    }

    return checkCommandAvailable(command, {
      platform: "linux",
      env,
      runCommand: (file, args, options) =>
        runCommandAsString(file, args, {
          ...options,
          env: options?.env ?? env,
        }),
    });
  };

  return {
    platform: "linux",
    runCommand: (file, args, options) =>
      runCommandAsString(file, args, {
        ...options,
        env: options?.env ?? linuxNativeEnv(),
      }),
    commandExists,
  };
}

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

async function sendHostBridgeNotification(
  notify: (method: string, params: unknown) => Promise<void>,
  method: HostNotificationMessage["method"],
  params: HostNotificationMessage["params"]
): Promise<void> {
  await notify(method, params);
}

function createRemoteHostBridge(
  transport: {
    request(method: string, params: unknown): Promise<unknown>;
    notify(method: string, params: unknown): Promise<void>;
  },
  hostApiUrl?: string
): RuntimeHostBridge {
  const requestHost = async (
    method: HostRequestMessage["method"],
    params: HostRequestMessage["params"]
  ): Promise<unknown> => transport.request(method, params);

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
      void sendHostBridgeNotification(transport.notify, "domainEvent", { event });
    },
    broadcast(topic, payload) {
      void sendHostBridgeNotification(transport.notify, "broadcast", { topic, payload });
    },
    recordWorkspaceFetch(workspaceId) {
      void sendHostBridgeNotification(transport.notify, "recordWorkspaceFetch", { workspaceId });
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
  };
}

export async function runWslRuntimeEntrypoint(): Promise<void> {
  assertRemoteRuntimeLoaded();
  normalizeWslRuntimeProcessPath();
  const bootstrap = parseBootstrapPayload();
  await validateBootstrapWorkspace(bootstrap);
  const socketServer = await createSocketJsonRpcServer({
    host: "0.0.0.0",
  });

  const workspaceLookup = createMutableWorkspaceLookup(bootstrap.workspaces);
  const settingsStore = createMutableSettingsStore(bootstrap.settings);
  let customProviders = bootstrap.customProviders.map((config) => ({
    ...config,
    args: [...config.args],
    env: { ...config.env },
    capabilities: config.capabilities.map((capability) => ({ ...capability })),
  }));
  let providerRegistry = createProviderRegistrySnapshot(customProviders);
  type RuntimeServices = {
    runtime: Awaited<ReturnType<typeof createNativeRuntime>>;
    applySnapshot(snapshot: RemoteStateSnapshot): Promise<void>;
    applyProviderSnapshot(snapshot: RemoteProviderSnapshot): Promise<void>;
    stop(): Promise<void>;
  };
  let resolveRuntimeServices: ((services: RuntimeServices) => void) | undefined;
  let rejectRuntimeServices: ((error: unknown) => void) | undefined;
  const runtimeServices = new Promise<RuntimeServices>((resolve, reject) => {
    resolveRuntimeServices = resolve;
    rejectRuntimeServices = reject;
  });
  const rpcHandlers: {
    onNotification?(method: string, params: unknown): Promise<void> | void;
    onRequest?(method: string, params: unknown): Promise<unknown> | unknown;
  } = {
    onNotification: async (method, params) => {
      const services = await runtimeServices;
      if (method === "updateSnapshot") {
        await services.applySnapshot(params as RemoteStateSnapshot);
        return;
      }
      if (method === "updateProviders") {
        await services.applyProviderSnapshot(params as RemoteProviderSnapshot);
      }
    },
    onRequest: async (method, params) => {
      const services = await runtimeServices;
      if (method === "execute") {
        const request = params as {
          op: string;
          args: unknown;
          meta?: unknown;
        };
        return services.runtime.execute(request.op, request.args, request.meta as never);
      }

      if (method === "disposeWorkspace") {
        const request = params as { workspaceId: string };
        await services.runtime.disposeWorkspace(request.workspaceId);
        return { disposed: true };
      }

      if (method === "health") {
        return services.runtime.health();
      }

      if (method === "stop") {
        setImmediate(() => {
          void services.stop();
        });
        return { stopped: true };
      }

      throw {
        code: "unknown_method",
        message: `Unknown WSL runtime RPC method: ${method}`,
      };
    },
  };

  const ready: WslRuntimeReadySignal = {
    type: "wslRuntime.ready",
    host: "127.0.0.1",
    port: socketServer.port,
  };
  await writeMessage(process.stdout, ready as unknown as Record<string, unknown>);

  const peer = await socketServer.acceptOnce(rpcHandlers);
  const hostApiProxy = await startWslHostApiProxy({
    port: WSL_LOCAL_HOST_API_PORT,
    relay: async (command) => (await peer.request("relayHostCommand", command)) as Result,
  });
  const hostBridge = createRemoteHostBridge(
    peer,
    hostApiProxy.url || resolveWslSessionHostApiUrl()
  );
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
    providerRuntimeDeps: createWslProviderRuntimeDeps(),
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

  try {
    await applySnapshot(
      buildRemoteStateSnapshot({
        settings: bootstrap.settings,
        workspaces: bootstrap.workspaces,
        customProviders,
      })
    );
    resolveRuntimeServices?.({
      runtime,
      applySnapshot,
      applyProviderSnapshot,
      async stop() {
        await hostApiProxy.close();
        await runtime.stop?.();
        await peer.dispose();
        await socketServer.close();
        process.exit(0);
      },
    });
  } catch (error) {
    rejectRuntimeServices?.(error);
    throw error;
  }
}
