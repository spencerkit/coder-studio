import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { Session } from "electron";
import {
  DESKTOP_READY_PREFIX,
  DESKTOP_SHUTDOWN_MESSAGE,
  type DesktopBackendStatus,
  type DesktopReadyMessage,
} from "./protocol.js";

interface RuntimeConfig {
  host?: unknown;
  port?: unknown;
  pid?: unknown;
}

interface BackendConnection extends DesktopBackendStatus {
  secret: string | null;
}

export interface ManagedBackendLaunchContext {
  secret: string;
  appVersion: string;
}

export interface ManagedBackendLaunch {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

interface BackendManagerOptions {
  appVersion: string;
  isPackaged: boolean;
  logsDir: string;
  resourcesPath: string;
  productRuntimeDir?: string;
  runtimeDir: string;
  stateDir: string;
  toolsDir: string;
  uploadsDir: string;
  createLaunch?: (
    context: ManagedBackendLaunchContext
  ) => ManagedBackendLaunch | Promise<ManagedBackendLaunch>;
  onUnexpectedExit?: (details: { code: number | null; signal: NodeJS.Signals | null }) => void;
}

const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 8_000;
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC";
const execFileAsync = promisify(execFile);

export interface SidecarToolchainOptions {
  /** Directory holding the bundled Engine `node` and `npm`. */
  engineDir: string;
  userPath: string;
  /** npm global prefix to fall back to when the user has no npm of their own. */
  managedNpmPrefix: string;
  platform?: NodeJS.Platform;
  pathExt?: string;
  fileExists?: (candidate: string) => boolean;
}

export interface SidecarToolchain {
  path: string;
  /** Set only when the sidecar has to fall back to the bundled Engine npm. */
  managedNpmPrefix: string | null;
}

function pathDelimiterFor(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

function splitPathValue(value: string | undefined, platform: NodeJS.Platform): string[] {
  return (value ?? "")
    .split(pathDelimiterFor(platform))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function joinPathValues(values: string[], platform: NodeJS.Platform): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const value of values) {
    for (const entry of splitPathValue(value, platform)) {
      const key = platform === "win32" ? entry.toLowerCase() : entry;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  return entries.join(pathDelimiterFor(platform));
}

/** npm writes Windows command shims into the prefix root and POSIX ones into `prefix/bin`. */
function resolveNpmPrefixBinDir(prefix: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? prefix : posix.join(prefix, "bin");
}

function hasCommandOnPath(
  command: string,
  pathValue: string,
  options: { platform: NodeJS.Platform; pathExt: string; fileExists: (path: string) => boolean }
): boolean {
  const { platform, fileExists } = options;
  const pathApi = platform === "win32" ? win32 : posix;
  const candidateNames =
    platform === "win32"
      ? options.pathExt
          .split(";")
          .map((extension) => extension.trim().toLowerCase())
          .filter((extension) => extension.length > 0)
          .map((extension) => `${command}${extension}`)
      : [command];

  for (const directory of splitPathValue(pathValue, platform)) {
    for (const name of candidateNames) {
      if (fileExists(pathApi.join(directory, name))) return true;
    }
  }
  return false;
}

/**
 * Decide which Node toolchain the sidecar and everything it spawns should see.
 *
 * The bundled Engine lives inside the read-only application directory, and npm derives its
 * default global prefix from the directory holding `node`. Putting the Engine first on PATH
 * therefore makes every `npm install -g` — including the self-update that agent CLIs such as
 * Codex trigger on their own — try to write into the install directory and fail with EPERM.
 */
export function resolveSidecarToolchain(options: SidecarToolchainOptions): SidecarToolchain {
  const platform = options.platform ?? process.platform;
  const pathExt = options.pathExt ?? process.env.PATHEXT ?? DEFAULT_PATHEXT;
  const fileExists = options.fileExists ?? existsSync;
  const managedBinDir = resolveNpmPrefixBinDir(options.managedNpmPrefix, platform);

  if (hasCommandOnPath("npm", options.userPath, { platform, pathExt, fileExists })) {
    // The user already has a Node toolchain whose npm has a writable global prefix, so let it
    // win: provider CLIs then install exactly where the user's own terminal would put them,
    // including version-manager prefixes that a hardcoded prefix would miss. The Engine stays
    // last as a fallback, and the managed prefix stays reachable for earlier installs.
    return {
      path: joinPathValues([options.userPath, managedBinDir, options.engineDir], platform),
      managedNpmPrefix: null,
    };
  }

  // Without a user toolchain the Engine npm is the only one available. Redirect its global
  // prefix to a per-user directory and keep that directory on PATH so freshly installed CLIs
  // resolve without restarting the app.
  return {
    path: joinPathValues([options.engineDir, managedBinDir, options.userPath], platform),
    managedNpmPrefix: options.managedNpmPrefix,
  };
}

interface UserPathResolutionOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  runShell?: (
    command: string,
    args: string[],
    options: { encoding: "utf8"; timeout: number; windowsHide: true }
  ) => Promise<{ stdout: string }>;
}

function readMarkedPath(stdout: string, marker: string): string {
  const markerIndex = stdout.lastIndexOf(marker);
  return markerIndex >= 0 ? stdout.slice(markerIndex + marker.length).trim() : "";
}

export async function resolveUserPath(options: UserPathResolutionOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const override = env.CODER_STUDIO_DESKTOP_PATH?.trim();
  if (override) return override;

  const inherited = env.PATH ?? env.Path ?? "";
  const runShell =
    options.runShell ??
    (execFileAsync as unknown as NonNullable<UserPathResolutionOptions["runShell"]>);
  const marker = "__CODER_STUDIO_PATH__";

  if (platform === "win32") {
    // Explorer-launched apps only inherit the static Windows environment. Version managers such
    // as fnm/nvm/Volta commonly add active Node and npm shims from the PowerShell profile, so
    // terminals can find `codex`/`claude` while the Desktop sidecar cannot. Capture that profile
    // PATH without opening a console. Expand %VAR% entries such as a literal `%APPDATA%\npm` too.
    for (const shell of ["powershell.exe", "pwsh.exe"]) {
      try {
        const script = `[Console]::Out.Write("\n${marker}" + [Environment]::ExpandEnvironmentVariables($env:PATH))`;
        const { stdout } = await runShell(
          shell,
          ["-NoLogo", "-NonInteractive", "-Command", script],
          {
            encoding: "utf8",
            timeout: 5_000,
            windowsHide: true,
          }
        );
        const shellPath = readMarkedPath(stdout, marker);
        if (shellPath && shellPath !== inherited) return shellPath;
      } catch {
        // Try the next PowerShell host, then fall back to the inherited environment.
      }
    }
    return inherited;
  }

  if (platform !== "darwin") return inherited;

  const shell = env.SHELL?.trim() || "/bin/zsh";
  try {
    const { stdout } = await runShell(shell, ["-ilc", `printf '\n${marker}%s' \"$PATH\"`], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    const loginPath = readMarkedPath(stdout, marker);
    return loginPath || inherited;
  } catch {
    return inherited;
  }
}

function normalizeRuntimeHost(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (value === "0.0.0.0" || value === "::" || value === "localhost") return "127.0.0.1";
  return value;
}

export async function isReusableExternalBackend(url: string, timeoutMs = 1_500): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const [healthResponse, uiResponse] = await Promise.all([
      fetch(`${url}/healthz`, { signal: controller.signal }),
      fetch(`${url}/`, {
        headers: { accept: "text/html" },
        signal: controller.signal,
      }),
    ]);
    const contentType = uiResponse.headers.get("content-type")?.toLowerCase() ?? "";
    return healthResponse.ok && uiResponse.ok && contentType.includes("text/html");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function isExternalBackendReuseEnabled(
  value = process.env.CODER_STUDIO_DESKTOP_REUSE_SERVER
) {
  return value?.trim().toLowerCase() === "true";
}

async function discoverExternalBackend(): Promise<BackendConnection | null> {
  const runtimePath = join(homedir(), ".coder-studio", "runtime.json");
  try {
    const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as RuntimeConfig;
    const host = normalizeRuntimeHost(runtime.host);
    if (!host || typeof runtime.port !== "number" || runtime.port <= 0) return null;
    const url = `http://${host}:${runtime.port}`;
    if (!(await isReusableExternalBackend(url))) return null;
    return {
      source: "external",
      url,
      pid: typeof runtime.pid === "number" ? runtime.pid : null,
      secret: null,
    };
  } catch {
    return null;
  }
}

function resolvePackagedNodePath(resourcesPath: string): string {
  return process.platform === "win32"
    ? join(resourcesPath, "engine", "node.exe")
    : join(resourcesPath, "engine", "bin", "node");
}

function resolveLaunch(options: BackendManagerOptions): {
  command: string;
  args: string[];
  cwd: string;
} {
  if (options.isPackaged) {
    const productRuntimeDir =
      options.productRuntimeDir ?? join(options.resourcesPath, "factory-runtime");
    return {
      command: resolvePackagedNodePath(options.resourcesPath),
      args: [join(productRuntimeDir, "server.mjs")],
      cwd: productRuntimeDir,
    };
  }

  const repoRoot = process.env.CODER_STUDIO_DESKTOP_REPO_ROOT?.trim();
  const nodePath = process.env.CODER_STUDIO_DESKTOP_NODE_PATH?.trim();
  if (!repoRoot || !nodePath) {
    throw new Error("Desktop development requires CODER_STUDIO_DESKTOP_REPO_ROOT and NODE_PATH");
  }
  return {
    command: nodePath,
    args: [
      resolve(repoRoot, "node_modules/tsx/dist/cli.mjs"),
      resolve(repoRoot, "packages/desktop/src/sidecar.ts"),
    ],
    cwd: repoRoot,
  };
}

async function authenticateSession(
  electronSession: Session,
  connection: BackendConnection
): Promise<void> {
  if (!connection.secret) return;
  const response = await electronSession.fetch(`${connection.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: connection.secret }),
  });
  if (!response.ok) {
    throw new Error(`Desktop backend authentication failed with status ${response.status}`);
  }
}

export class BackendManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: BackendConnection | null = null;
  private stopping = false;

  constructor(private readonly options: BackendManagerOptions) {}

  getStatus(): DesktopBackendStatus | null {
    if (!this.connection) return null;
    const { source, url, pid } = this.connection;
    return { source, url, pid };
  }

  async start(electronSession: Session): Promise<DesktopBackendStatus> {
    try {
      const external =
        this.options.isPackaged && !this.options.createLaunch && isExternalBackendReuseEnabled()
          ? await discoverExternalBackend()
          : null;
      this.connection = external ?? (await this.spawnManagedBackend());
      await authenticateSession(electronSession, this.connection);
      return this.getStatus() as DesktopBackendStatus;
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
  }

  async authenticatePublicSession(electronSession: Session, publicUrl: string): Promise<void> {
    if (!this.connection) throw new Error("Desktop backend is not running");
    await authenticateSession(electronSession, { ...this.connection, url: publicUrl });
  }

  private async spawnManagedBackend(): Promise<BackendConnection> {
    const secret = randomBytes(32).toString("base64url");
    const launch: ManagedBackendLaunch = this.options.createLaunch
      ? await this.options.createLaunch({ secret, appVersion: this.options.appVersion })
      : resolveLaunch(this.options);
    const executablePath = dirname(launch.command);
    const userPath = await resolveUserPath();
    const toolchain = resolveSidecarToolchain({
      engineDir: executablePath,
      userPath,
      managedNpmPrefix: join(this.options.toolsDir, "npm"),
    });
    const sidecarPath = toolchain.path;
    const logPath = join(this.options.logsDir, "backend.log");
    const logStream = createWriteStream(logPath, { flags: "a" });

    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(this.options.createLaunch
          ? launch.env
          : {
              PATH: sidecarPath,
              ...(process.platform === "win32" ? { Path: sidecarPath } : {}),
              ...(toolchain.managedNpmPrefix
                ? { NPM_CONFIG_PREFIX: toolchain.managedNpmPrefix }
                : {}),
              NODE_ENV: "production",
              CODER_STUDIO_LOG_FORMAT: "json",
              CODER_STUDIO_RUNTIME_DIR: this.options.runtimeDir,
              CODER_STUDIO_DESKTOP_SECRET: secret,
              CODER_STUDIO_DESKTOP_PORT:
                process.env.CODER_STUDIO_DESKTOP_PORT?.trim() ||
                (this.options.isPackaged ? "0" : "4173"),
              CODER_STUDIO_DESKTOP_STATE_DIR: this.options.stateDir,
              CODER_STUDIO_DESKTOP_UPLOADS_DIR: this.options.uploadsDir,
              CODER_STUDIO_DESKTOP_APP_VERSION: this.options.appVersion,
              ...(this.options.isPackaged
                ? {
                    CODER_STUDIO_ENGINE_ROOT: join(this.options.resourcesPath, "engine"),
                    CODER_STUDIO_MERMAID_RUNTIME_PATH: join(
                      this.options.productRuntimeDir ??
                        join(this.options.resourcesPath, "factory-runtime"),
                      "assets",
                      "mermaid.min.js"
                    ),
                    NODE_PATH: join(this.options.resourcesPath, "engine", "node_modules"),
                  }
                : {}),
            }),
      },
    });
    this.child = child;
    this.stopping = false;

    const lines = createInterface({ input: child.stdout });
    child.stderr.pipe(logStream, { end: false });
    child.once("exit", (code, signal) => {
      lines.close();
      logStream.end();
      this.child = null;
      if (!this.stopping) {
        this.connection = null;
        this.options.onUnexpectedExit?.({ code, signal });
      }
    });

    return await new Promise<BackendConnection>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => {
        rejectReady(
          new Error(`Desktop backend did not become ready within ${STARTUP_TIMEOUT_MS}ms`)
        );
      }, STARTUP_TIMEOUT_MS);

      const reject = (error: Error) => {
        clearTimeout(timeout);
        rejectReady(error);
      };

      child.once("error", reject);
      child.once("exit", (code, signal) => {
        reject(
          new Error(
            `Desktop backend exited before startup (${code !== null ? `code ${code}` : `signal ${signal}`})`
          )
        );
      });

      lines.on("line", (line) => {
        logStream.write(`${line}\n`);
        if (!line.startsWith(DESKTOP_READY_PREFIX)) return;
        try {
          const ready = JSON.parse(line.slice(DESKTOP_READY_PREFIX.length)) as DesktopReadyMessage;
          if (ready.type !== "ready" || !Number.isInteger(ready.port) || ready.port <= 0) {
            throw new Error("Malformed desktop backend ready message");
          }
          clearTimeout(timeout);
          resolveReady({
            source: "managed",
            url: `http://${ready.host}:${ready.port}`,
            pid: ready.pid,
            secret,
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.connection = null;
    if (!child) return;
    this.stopping = true;

    const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
    child.stdin.write(`${DESKTOP_SHUTDOWN_MESSAGE}\n`);

    const timedOut = await Promise.race([
      exited.then(() => false),
      new Promise<boolean>((resolveTimeout) =>
        setTimeout(() => resolveTimeout(true), SHUTDOWN_TIMEOUT_MS)
      ),
    ]);
    if (timedOut && child.exitCode === null) child.kill("SIGTERM");
  }
}
