import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CustomProviderConfig,
  SCOPED_SESSION_AUTOMATION_PERMISSIONS,
  type Workspace,
} from "@coder-studio/core";
import type { SessionTokenRepo } from "../auth/session-token-repo.js";
import { type CommandRunner, runCommandAsString } from "../provider-runtime/command-runner.js";
import { generateSessionId } from "../session/manager.js";
import { toWslPath } from "../terminal-profiles/wsl.js";
import type { RuntimeWorkspaceSnapshot, WslRuntimeBootstrapPayload } from "./remote/protocol.js";

const WSL_HOST_IP_PROBE = "ip route show default 2>/dev/null | awk '/default/ {print $3; exit}'";
export const WSL_RUNTIME_NODE_LAUNCH_SCRIPT = [
  'ENTRY="${1-}"',
  'NODE="$(command -v node 2>/dev/null || command -v nodejs 2>/dev/null)"',
  'if [ -z "$NODE" ] && [ -x "$HOME/.local/share/fnm/aliases/default/bin/node" ]; then NODE="$HOME/.local/share/fnm/aliases/default/bin/node"; fi',
  'if [ -z "$NODE" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; NODE="$(command -v node 2>/dev/null)"; fi',
  'if [ -z "$NODE" ] && [ -x "$HOME/.local/share/fnm/fnm" ]; then eval "$("$HOME/.local/share/fnm/fnm" env)"; NODE="$(command -v node 2>/dev/null)"; fi',
  'if [ -z "$NODE" ]; then exit 127; fi',
  'exec "$NODE" "$ENTRY"',
].join("; ");
export const REMOTE_RUNTIME_SESSION_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_WSL_STATE_ROOT_BASE = "~/.coder-studio/runtimes";

export interface ResolveWslHostApiUrlInput {
  configuredUrl?: string;
  boundHost: string;
  port: number;
  wslDistro?: string;
  runCommand?: CommandRunner;
}

export interface IssueRemoteSessionBootstrapInput {
  sessionTokenRepo: SessionTokenRepo;
  workspaceId: string;
  providerId: string;
  runtimeId: string;
  callbackApiUrl: string;
  ttlMs?: number;
  sessionIdFactory?: () => string;
}

export interface ResolveWslRuntimeLaunchSpecInput {
  runtimeId: string;
  stateRoot: string;
  workspace: Pick<
    Workspace,
    "id" | "path" | "targetRuntime" | "wslDistro" | "openedAt" | "lastActiveAt" | "uiState"
  >;
  settingsSnapshot: Record<string, unknown>;
  workspaceSnapshot: RuntimeWorkspaceSnapshot[];
  customProviderConfigs: CustomProviderConfig[];
  hostApiUrl?: string;
  runtimeEntryPathResolver?: () => string;
}

export interface WslRuntimeLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  bootstrap: WslRuntimeBootstrapPayload;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function formatHostForUrl(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host;
}

function canReuseBoundHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    normalized !== "localhost" &&
    normalized !== "127.0.0.1" &&
    normalized !== "::1" &&
    normalized !== "0.0.0.0" &&
    normalized !== "::"
  );
}

function isPackagedDistRuntime(modulePath: string): boolean {
  return modulePath.includes(`${sep}dist${sep}esm${sep}`);
}

function sanitizeRuntimeRootName(runtimeId: string): string {
  return runtimeId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isExecutableEntryPath(entryPath: string): boolean {
  return entryPath.endsWith(".mjs") || entryPath.endsWith(".js") || entryPath.endsWith(".cjs");
}

function toExecutableWslPath(hostPath: string): string {
  if (hostPath.startsWith("/")) {
    return hostPath;
  }

  return toWslPath(hostPath) ?? hostPath.replace(/\\/g, "/");
}

function resolveSafeWslHostCwd(): string {
  return process.cwd();
}

export async function probeWslHostIp(
  wslDistro: string,
  runCommand: CommandRunner = runCommandAsString
): Promise<string | undefined> {
  const { stdout } = await runCommand(
    "wsl.exe",
    ["-d", wslDistro, "--cd", "/", "-e", "sh", "-c", WSL_HOST_IP_PROBE],
    { windowsHide: true }
  );

  const ip = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return ip || undefined;
}

export async function resolveWslHostApiUrl(
  input: ResolveWslHostApiUrlInput
): Promise<string | undefined> {
  const configuredUrl = input.configuredUrl?.trim();
  if (configuredUrl) {
    return trimTrailingSlash(configuredUrl);
  }

  if (canReuseBoundHost(input.boundHost)) {
    return `http://${formatHostForUrl(input.boundHost)}:${input.port}`;
  }

  const distro = input.wslDistro?.trim();
  if (!distro) {
    return undefined;
  }

  const probedHostIp = await probeWslHostIp(distro, input.runCommand);
  return probedHostIp ? `http://${formatHostForUrl(probedHostIp)}:${input.port}` : undefined;
}

export function resolveWslRuntimeStateRoot(runtimeId: string): string {
  return `${DEFAULT_WSL_STATE_ROOT_BASE}/${sanitizeRuntimeRootName(runtimeId)}`;
}

function appendWslEnvPassThrough(existing: string | undefined, varName: string): string {
  const entry = `${varName}/u`;
  if (!existing?.trim()) {
    return entry;
  }

  const parts = existing.split(":").filter(Boolean);
  if (parts.some((part) => part === entry || part.startsWith(`${varName}/`))) {
    return existing;
  }

  return `${existing}:${entry}`;
}

export function serializeWslRuntimeBootstrap(bootstrap: WslRuntimeBootstrapPayload): string {
  return JSON.stringify(bootstrap);
}

export function resolveWslRuntimeEntryPath(runtimeModuleUrl: string = import.meta.url): string {
  const modulePath = fileURLToPath(runtimeModuleUrl);
  const moduleDir = dirname(modulePath);
  const repoDistEntryPath = resolve(moduleDir, "../../../cli/dist/esm/wsl-runtime-entry.mjs");
  const packagedDistEntryPath = resolve(moduleDir, "wsl-runtime-entry.mjs");
  const candidates = isPackagedDistRuntime(modulePath)
    ? [packagedDistEntryPath, repoDistEntryPath]
    : [repoDistEntryPath, packagedDistEntryPath];

  for (const candidate of candidates) {
    if (existsSync(candidate) && isExecutableEntryPath(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to resolve Coder Studio WSL runtime entry. Tried ${candidates.join(", ")}.`
  );
}

function resolveRepoRootFromRuntimeModule(runtimeModuleUrl: string): string {
  return resolve(dirname(fileURLToPath(runtimeModuleUrl)), "../../../..");
}

function runDevWslRuntimeEntryBuild(repoRoot: string): Promise<void> {
  const ensureScript = resolve(repoRoot, "scripts/ensure-wsl-runtime-entry.ts");
  if (!existsSync(ensureScript)) {
    return Promise.reject(
      new Error(
        `Missing ${ensureScript}. Run "pnpm build:cli" or restart the dev server to build wsl-runtime-entry.mjs.`
      )
    );
  }

  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  return new Promise((resolve, reject) => {
    const child = spawn(command, ["exec", "tsx", ensureScript], {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Unable to build WSL runtime entry (exit code ${code ?? "unknown"}). Run "pnpm build:cli" and retry.`
        )
      );
    });
  });
}

async function resolveWslRuntimeEntryPathForLaunch(
  runtimeModuleUrl: string = import.meta.url
): Promise<string> {
  try {
    return resolveWslRuntimeEntryPath(runtimeModuleUrl);
  } catch (error) {
    if (process.env.NODE_ENV !== "development") {
      throw error;
    }
  }

  await runDevWslRuntimeEntryBuild(resolveRepoRootFromRuntimeModule(runtimeModuleUrl));
  return resolveWslRuntimeEntryPath(runtimeModuleUrl);
}

export async function resolveWslRuntimeLaunchSpec(
  input: ResolveWslRuntimeLaunchSpecInput
): Promise<WslRuntimeLaunchSpec> {
  const entryPath =
    input.runtimeEntryPathResolver?.() ?? (await resolveWslRuntimeEntryPathForLaunch());
  if (!existsSync(entryPath)) {
    throw new Error(`Unable to resolve Coder Studio WSL runtime entry. Missing ${entryPath}.`);
  }
  if (!isExecutableEntryPath(entryPath)) {
    throw new Error(
      `Unable to launch Coder Studio WSL runtime from ${entryPath}. Build the CLI bundle first so wsl-runtime-entry.mjs exists.`
    );
  }

  const distro = input.workspace.wslDistro?.trim();
  if (!distro) {
    throw new Error("WSL runtime launch requires workspace.wslDistro");
  }
  if (!input.workspace.path.startsWith("/")) {
    throw new Error("WSL runtime launch requires a Linux workspace path");
  }

  const bootstrap: WslRuntimeBootstrapPayload = {
    runtimeId: input.runtimeId,
    workspace: {
      id: input.workspace.id,
      path: input.workspace.path,
      targetRuntime: input.workspace.targetRuntime,
      wslDistro: input.workspace.wslDistro,
      uiState: { ...input.workspace.uiState },
    },
    stateRoot: resolveWslRuntimeStateRoot(input.runtimeId),
    ...(input.hostApiUrl ? { hostApiUrl: input.hostApiUrl } : {}),
    settings: { ...input.settingsSnapshot },
    workspaces: input.workspaceSnapshot.map((workspace) => ({ ...workspace })),
    customProviders: input.customProviderConfigs.map((config) => ({
      ...config,
      args: [...config.args],
      env: { ...config.env },
      capabilities: config.capabilities.map((capability) => ({ ...capability })),
    })),
  };

  return {
    command: "wsl.exe",
    args: [
      "-d",
      distro,
      "--cd",
      input.workspace.path,
      "-e",
      "sh",
      "-c",
      WSL_RUNTIME_NODE_LAUNCH_SCRIPT,
      "sh",
      toExecutableWslPath(entryPath),
    ],
    cwd: resolveSafeWslHostCwd(),
    env: {
      WSLENV: appendWslEnvPassThrough(process.env.WSLENV, "CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP"),
      CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP: serializeWslRuntimeBootstrap(bootstrap),
    },
    bootstrap,
  };
}

export function issueRemoteSessionBootstrap(input: IssueRemoteSessionBootstrapInput): {
  sessionId: string;
  sessionToken: string;
  apiUrl: string;
} {
  const sessionId = (input.sessionIdFactory ?? generateSessionId)();
  const tokenRecord = input.sessionTokenRepo.issue({
    sessionId,
    workspaceId: input.workspaceId,
    providerId: input.providerId,
    permissions: [...SCOPED_SESSION_AUTOMATION_PERMISSIONS],
    mode: "remote_runtime",
    runtimeId: input.runtimeId,
    ttlMs: input.ttlMs ?? REMOTE_RUNTIME_SESSION_TOKEN_TTL_MS,
  });

  return {
    sessionId,
    sessionToken: tokenRecord.token,
    apiUrl: input.callbackApiUrl,
  };
}
