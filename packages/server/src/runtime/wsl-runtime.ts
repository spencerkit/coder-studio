import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ProviderDefinition, Session, Terminal, Workspace } from "@coder-studio/core";
import { toProviderListItem } from "@coder-studio/providers";
import type { WorkspaceRuntimeBindingStore } from "../host/workspace-runtime-binding.js";
import type { RuntimeCommandContext } from "./context.js";
import type { RuntimeExecuteMeta, RuntimeHandle, RuntimeHostBridge } from "./contract.js";
import {
  type HostNotificationMessage,
  type HostRequestMessage,
  type RemoteDisposeWorkspaceRequest,
  type RemoteExecuteRequest,
  type RemoteProviderSnapshot,
  type WslRuntimeReadySignal,
} from "./remote/protocol.js";
import { createSocketJsonRpcClient } from "./remote/socket-json-rpc.js";
import {
  cloneCustomProviderConfigs,
  cloneSettingsSnapshot,
  cloneWorkspaceSnapshots,
} from "./remote/state-snapshot.js";
import { resolveWslRuntimeLaunchSpec } from "./wsl-bootstrap.js";

function serializeProviderSnapshot(providers: ProviderDefinition[]): RemoteProviderSnapshot {
  return {
    providers: providers.map((provider) => toProviderListItem(provider)),
  };
}

function isSerializedBuffer(value: unknown): value is { type: "Buffer"; data: number[] } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "Buffer" &&
    Array.isArray((value as { data?: unknown }).data)
  );
}

function normalizeDomainEventPayload(event: unknown): unknown {
  if (
    !event ||
    typeof event !== "object" ||
    (event as { type?: unknown }).type !== "terminal.output"
  ) {
    return event;
  }

  const chunk = (event as { chunk?: unknown }).chunk;
  if (Buffer.isBuffer(chunk)) {
    return event;
  }

  if (chunk instanceof Uint8Array) {
    return {
      ...event,
      chunk: Buffer.from(chunk),
    };
  }

  if (isSerializedBuffer(chunk)) {
    return {
      ...event,
      chunk: Buffer.from(chunk.data),
    };
  }

  return event;
}

async function routeHostNotification(
  hostBridge: RuntimeHostBridge,
  method: HostNotificationMessage["method"],
  params: unknown
): Promise<void> {
  if (method === "domainEvent") {
    const message = params as Extract<HostNotificationMessage, { method: "domainEvent" }>["params"];
    hostBridge.emitDomainEvent(normalizeDomainEventPayload(message.event) as typeof message.event);
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
  runtimeBindings?: WorkspaceRuntimeBindingStore;
};

const WSL_RUNTIME_HOST_ENV_BLOCKLIST = new Set([
  "FNM_MULTISHELL_PATH",
  "NPM_CONFIG_PREFIX",
  "npm_config_prefix",
  "NPM_CONFIG_USERCONFIG",
  "npm_config_userconfig",
  "NPM_CONFIG_GLOBALCONFIG",
  "npm_config_globalconfig",
  "NPM_CONFIG_CACHE",
  "npm_config_cache",
  "NPM_CONFIG_NODEDIR",
  "npm_config_nodedir",
  "npm_config_build_from_source",
  "npm_config_verify_deps_before_run",
  "npm_config__jsr_registry",
  "_jsr_registry",
  "npm_globalconfig",
  "npm_config_npm_globalconfig",
  "verify_deps_before_run",
]);

function isWindowsPathEntry(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("/mnt/") ||
    normalized.startsWith("\\\\") ||
    /^[a-z]:[\\/]/.test(normalized)
  );
}

function sanitizeWslLaunchPath(pathValue: string | undefined): string | undefined {
  if (!pathValue) {
    return undefined;
  }

  // The host PATH comes from Windows, so it is semicolon-delimited even though the
  // WSL-side PATH we want to hand to Linux must use ':'.
  const sanitized = pathValue
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !isWindowsPathEntry(entry))
    .join(":");

  return sanitized.length > 0 ? sanitized : undefined;
}

function buildSanitizedWslLaunchEnv(
  hostEnv: NodeJS.ProcessEnv,
  runtimeEnv: Record<string, string>
): Record<string, string> {
  const nextEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(hostEnv)) {
    if (value == null || WSL_RUNTIME_HOST_ENV_BLOCKLIST.has(key)) {
      continue;
    }

    if (key === "PATH") {
      const sanitizedPath = sanitizeWslLaunchPath(value);
      if (sanitizedPath) {
        nextEnv.PATH = sanitizedPath;
      }
      continue;
    }

    if (key.startsWith("npm_config_") || key.startsWith("NPM_CONFIG_")) {
      continue;
    }

    nextEnv[key] = value;
  }

  return {
    ...nextEnv,
    ...runtimeEnv,
  };
}

function isReadySignal(value: unknown): value is WslRuntimeReadySignal {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "wslRuntime.ready" &&
    typeof (value as { host?: unknown }).host === "string" &&
    typeof (value as { port?: unknown }).port === "number"
  );
}

async function waitForWslRuntimeReady(
  child: ReturnType<typeof spawn>,
  runtimeId: string
): Promise<WslRuntimeReadySignal> {
  if (!child.stdout) {
    throw new Error(`WSL runtime ${runtimeId} launched without stdout pipe`);
  }
  if (!child.stderr) {
    throw new Error(`WSL runtime ${runtimeId} launched without stderr pipe`);
  }

  const stdout = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  const stderrChunks: string[] = [];
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    if (stderrChunks.length > 32) {
      stderrChunks.shift();
    }
  });

  return new Promise<WslRuntimeReadySignal>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      stdout.close();
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
    };

    const finishResolve = (value: WslRuntimeReadySignal) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const buildStartupError = (reason: string) => {
      const stderr = stderrChunks.join("").trim();
      return new Error(
        stderr.length > 0
          ? `WSL runtime ${runtimeId} exited before announcing its socket (${reason}). ${stderr}`
          : `WSL runtime ${runtimeId} exited before announcing its socket (${reason}).`
      );
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finishReject(buildStartupError(`code=${code ?? "null"}, signal=${signal ?? "null"}`));
    };

    const onError = (error: Error) => {
      finishReject(error);
    };

    stdout.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }

      if (isReadySignal(parsed)) {
        finishResolve(parsed);
      }
    });

    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function isTerminalShape(value: unknown): value is Terminal {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { workspaceId?: unknown }).workspaceId === "string" &&
    typeof (value as { kind?: unknown }).kind === "string" &&
    typeof (value as { cwd?: unknown }).cwd === "string" &&
    typeof (value as { title?: unknown }).title === "string"
  );
}

function isSessionShape(value: unknown): value is Session {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { workspaceId?: unknown }).workspaceId === "string" &&
    typeof (value as { terminalId?: unknown }).terminalId === "string" &&
    typeof (value as { providerId?: unknown }).providerId === "string" &&
    typeof (value as { state?: unknown }).state === "string"
  );
}

function bindRuntimeResourceResult(
  bindings: WorkspaceRuntimeBindingStore | undefined,
  workspaceId: string,
  op: string,
  result: unknown
): void {
  if (!bindings) {
    return;
  }

  if (op === "terminal.create" && isTerminalShape(result)) {
    bindings.bindTerminal(result);
    return;
  }

  if (op === "session.create" && isSessionShape(result)) {
    bindings.bindSession(result);
    bindings.bindTerminal({
      id: result.terminalId,
      workspaceId,
      kind: "agent",
      title: result.title ?? "",
      cwd: "",
      argv: [],
      cols: 120,
      rows: 30,
      alive: result.state !== "ended",
      createdAt: result.startedAt,
      ...(result.state === "ended" ? { endedAt: result.endedAt, exitCode: 0 } : {}),
    });
  }
}

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
    env: buildSanitizedWslLaunchEnv(process.env, launchSpec.env),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const ready = await waitForWslRuntimeReady(child, input.runtimeId);
  const rpc = await createSocketJsonRpcClient({
    host: ready.host,
    port: ready.port,
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
      const result = await rpc.request("execute", {
        op,
        args,
        ...(nextMeta ? { meta: nextMeta } : {}),
      } satisfies RemoteExecuteRequest);
      bindRuntimeResourceResult(input.runtimeBindings, input.workspace.id, op, result);
      return result;
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
