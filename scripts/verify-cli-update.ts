import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type {
  ReadableUpdateStateSnapshot,
  UpdatePrepareInstallResponse,
  UpdateStateSnapshot,
} from "@coder-studio/core";
import type { CoderStudioWsCommandInput } from "../packages/cli/src/automation-ws-client.js";
import {
  lookupNpmReleaseMetadata,
  type NpmReleaseMetadata,
} from "../packages/server/src/update/npm-release-metadata.js";
import { error, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

const execFileAsync = promisify(execFile);
const PREFIX_BASENAME = "coder-studio-cli-acceptance-";

export interface VerifyCliUpdateOptions {
  packageName: string;
  previousVersion: string;
  candidateVersion: string;
  registryUrl: string;
  distTag: string;
  commitSha?: string;
  prefix?: string;
  reportPath?: string;
}

export interface CliUpdateAcceptanceReport {
  schemaVersion: 1;
  commitSha: string | null;
  packageName: string;
  previousVersion: string;
  candidateVersion: string;
  candidatePublishedAt: string;
  prefix: string;
  exactInstallObserved: boolean;
  restartObserved: boolean;
  reconciledStatus: "succeeded";
  scenarios: CliFailureScenarioReport[];
}

export type CliFailureScenarioName = "permission" | "install" | "restart";

export interface CliFailureScenarioReport {
  name: CliFailureScenarioName;
  updateStatus: "manual_required" | "failed";
  manualCommand: string | null;
  logVerified: boolean;
}

export interface CliFailureScenarioEvidence extends CliFailureScenarioReport {
  workerLog: string;
  paths: string[];
}

interface ManagedServer {
  apiUrl: string;
  stop(): Promise<void>;
}

interface ManagedRegistryProxy {
  registryUrl: string;
  stop(): Promise<void>;
}

interface CommandOptions {
  env: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface AcceptanceWebSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

interface AcceptanceCommandResult {
  kind: "result";
  id: string;
  ok: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

export interface VerifyCliUpdateDeps {
  command(
    executable: string,
    args: string[],
    options: CommandOptions
  ): Promise<{ stdout: string; stderr: string }>;
  startServer(input: {
    executable: string;
    env: NodeJS.ProcessEnv;
    port: number;
  }): Promise<ManagedServer>;
  callWs<T = unknown>(input: CoderStudioWsCommandInput): Promise<T>;
  lookupReleaseMetadata(input: {
    packageName: string;
    currentVersion: string;
    distTag: string;
    registryUrl: string;
  }): Promise<NpmReleaseMetadata>;
  wait(ms: number): Promise<void>;
  startRegistryProxy(input: {
    registryUrl: string;
    packageName: string;
    candidateVersion: string;
  }): Promise<ManagedRegistryProxy>;
  waitForReconcile(input: {
    apiUrl: string;
    candidateVersion: string;
    callWs: VerifyCliUpdateDeps["callWs"];
  }): Promise<Partial<UpdateStateSnapshot>>;
  runFailureScenario(input: {
    scenario: CliFailureScenarioName;
    packageName: string;
    previousVersion: string;
    candidateVersion: string;
    registryUrl: string;
    distTag: string;
    prefix: string;
  }): Promise<CliFailureScenarioEvidence>;
  removePrefix(prefix: string): Promise<void>;
  writeReport(path: string, report: CliUpdateAcceptanceReport): Promise<void>;
}

function assertAcceptancePrefix(prefix: string): string {
  const normalized = resolve(prefix);
  if (!isAbsolute(prefix) || !basename(normalized).startsWith(PREFIX_BASENAME)) {
    throw new Error(`CLI acceptance prefix basename must start with ${PREFIX_BASENAME}`);
  }
  return normalized;
}

async function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((closeError) => {
        if (closeError) reject(closeError);
        else resolvePort(port);
      });
    });
  });
}

export async function startCandidateRegistryProxy(input: {
  registryUrl: string;
  packageName: string;
  candidateVersion: string;
}): Promise<ManagedRegistryProxy> {
  const upstream = new URL(
    input.registryUrl.endsWith("/") ? input.registryUrl : `${input.registryUrl}/`
  );
  const server = createHttpServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }
      const target = new URL(request.url ?? "/", upstream);
      if (target.origin !== upstream.origin) {
        throw new Error("npm acceptance proxy target changed origin");
      }
      const upstreamResponse = await fetch(target, { cache: "no-store" });
      const contentType = upstreamResponse.headers.get("content-type") ?? "";
      let body = Buffer.from(await upstreamResponse.arrayBuffer());
      if (upstreamResponse.ok && contentType.includes("application/json")) {
        const metadata = JSON.parse(body.toString("utf8")) as {
          name?: unknown;
          "dist-tags"?: Record<string, unknown>;
          versions?: Record<string, unknown>;
        };
        if (
          metadata.name === input.packageName &&
          metadata.versions?.[input.candidateVersion] &&
          metadata["dist-tags"]
        ) {
          metadata["dist-tags"].latest = input.candidateVersion;
          body = Buffer.from(JSON.stringify(metadata));
        }
      }
      response.statusCode = upstreamResponse.status;
      response.setHeader("cache-control", "no-store");
      if (contentType) response.setHeader("content-type", contentType);
      response.setHeader("content-length", String(body.length));
      if (request.method === "HEAD") response.end();
      else response.end(body);
    } catch (proxyError) {
      response.statusCode = 502;
      response.end(proxyError instanceof Error ? proxyError.message : String(proxyError));
    }
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    throw new Error("npm acceptance proxy did not bind a TCP port");
  }
  return {
    registryUrl: `http://127.0.0.1:${address.port}/`,
    stop: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

async function waitForHealth(apiUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/healthz", apiUrl));
      if (response.ok) return;
      lastError = new Error(`healthz returned ${response.status}`);
    } catch (healthError) {
      lastError = healthError;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(
    `Timed out waiting for packaged CLI health: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      resolveStop();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

async function writeReportAtomic(path: string, report: CliUpdateAcceptanceReport): Promise<void> {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, resolve(candidate));
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

function acceptanceEnvironment(input: {
  prefix: string;
  binDirectory: string;
  registryUrl: string;
  distTag: string;
  shimDirectory?: string;
}): NodeJS.ProcessEnv {
  const pathEntries = [input.shimDirectory, input.binDirectory, process.env.PATH]
    .filter((entry): entry is string => Boolean(entry))
    .join(process.platform === "win32" ? ";" : ":");
  const isolatedHome = resolve(input.prefix, "home");
  const coderStudioHome = resolve(isolatedHome, ".coder-studio");
  return {
    ...process.env,
    HOME: isolatedHome,
    ...(process.platform === "win32" ? { USERPROFILE: isolatedHome } : {}),
    PATH: pathEntries,
    npm_config_prefix: input.prefix,
    npm_config_registry: input.registryUrl,
    PM2_HOME: resolve(input.prefix, "pm2"),
    CODER_STUDIO_HOME: coderStudioHome,
    CODER_STUDIO_RUNTIME_DIR: coderStudioHome,
    CODER_STUDIO_UPDATE_REGISTRY_URL: input.registryUrl,
    CODER_STUDIO_UPDATE_DIST_TAG: input.distTag,
  };
}

function toAcceptanceWebSocketUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function callActivatedCoderStudioWsCommand<T = unknown>(
  input: CoderStudioWsCommandInput,
  createSocket: (url: string) => AcceptanceWebSocket = (url) =>
    new WebSocket(url) as unknown as AcceptanceWebSocket
): Promise<T> {
  const socket = createSocket(toAcceptanceWebSocketUrl(input.apiUrl));
  const claimId = randomUUID();
  const commandId = randomUUID();
  const timeoutMs = input.timeoutMs ?? 30_000;

  return new Promise<T>((resolveCommand, rejectCommand) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(() => rejectCommand(new Error(`Timed out waiting for ${input.op} result`)));
    }, timeoutMs);

    function finish(callback: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      callback();
    }

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          kind: "command",
          id: claimId,
          op: "activation.claim",
          args: { clientInstanceId: `cli-update-acceptance-${randomUUID()}` },
        })
      );
    };
    socket.onmessage = (event) => {
      let result: AcceptanceCommandResult;
      try {
        result = JSON.parse(String(event.data)) as AcceptanceCommandResult;
      } catch (parseError) {
        finish(() => rejectCommand(parseError));
        return;
      }
      if (result.kind !== "result") return;
      if (result.id === claimId) {
        if (!result.ok) {
          finish(() =>
            rejectCommand(
              new Error(
                `${result.error?.code ? `${result.error.code}: ` : ""}${result.error?.message ?? "Activation claim failed"}`
              )
            )
          );
          return;
        }
        socket.send(
          JSON.stringify({
            kind: "command",
            id: commandId,
            op: input.op,
            args: input.args,
          })
        );
        return;
      }
      if (result.id !== commandId) return;
      if (result.ok) {
        finish(() => resolveCommand(result.data as T));
        return;
      }
      finish(() =>
        rejectCommand(
          new Error(
            `${result.error?.code ? `${result.error.code}: ` : ""}${result.error?.message ?? "Command failed"}`
          )
        )
      );
    };
    socket.onerror = (event) => {
      finish(() =>
        rejectCommand(event instanceof Error ? event : new Error("CLI acceptance WebSocket failed"))
      );
    };
    socket.onclose = () => {
      if (!settled) {
        finish(() =>
          rejectCommand(new Error("CLI acceptance WebSocket closed before command result"))
        );
      }
    };
  });
}

async function writePosixShim(path: string, source: string): Promise<void> {
  await writeFile(path, `#!/usr/bin/env sh\nset -eu\n${source}\n`, "utf8");
  await chmod(path, 0o755);
}

async function waitForFailureState(input: {
  apiUrl: string;
  statePath: string;
  callWs: VerifyCliUpdateDeps["callWs"];
}): Promise<UpdateStateSnapshot> {
  const deadline = Date.now() + 60_000;
  let lastState: Partial<UpdateStateSnapshot> = {};
  while (Date.now() < deadline) {
    try {
      lastState = await input.callWs<UpdateStateSnapshot>({
        apiUrl: input.apiUrl,
        op: "updates.getState",
        args: {},
        timeoutMs: 2_000,
      });
    } catch {
      try {
        lastState = JSON.parse(await readFile(input.statePath, "utf8")) as UpdateStateSnapshot;
      } catch {
        // The worker may not have written its terminal state yet.
      }
    }
    if (lastState.updateStatus === "failed" || lastState.updateStatus === "manual_required") {
      return lastState as UpdateStateSnapshot;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(
    `CLI fault scenario did not reach a terminal state: ${JSON.stringify(lastState)}`
  );
}

async function runDefaultFailureScenario(input: {
  scenario: CliFailureScenarioName;
  packageName: string;
  previousVersion: string;
  candidateVersion: string;
  registryUrl: string;
  distTag: string;
  prefix: string;
}): Promise<CliFailureScenarioEvidence> {
  if (process.platform === "win32") {
    throw new Error("CLI deterministic failure acceptance currently requires a POSIX runner");
  }
  const scenarioPrefix = resolve(input.prefix, `scenario-${input.scenario}`);
  const stateDirectory = resolve(scenarioPrefix, "state-root");
  const shimDirectory = resolve(scenarioPrefix, "shim-bin");
  const recordPath = resolve(scenarioPrefix, `${input.scenario}-commands.log`);
  const binDirectory = resolve(scenarioPrefix, "bin");
  const cliExecutable = resolve(binDirectory, "coder-studio");
  const statePath = resolve(stateDirectory, "state", "update-state.json");
  const workerLogPath = resolve(stateDirectory, "logs", "update-worker.log");
  const port = await reservePort();
  const env = acceptanceEnvironment({
    prefix: scenarioPrefix,
    binDirectory,
    registryUrl: input.registryUrl,
    distTag: input.distTag,
    shimDirectory,
  });
  let server: ManagedServer | null = null;
  try {
    await mkdir(stateDirectory, { recursive: true });
    await mkdir(shimDirectory, { recursive: true });
    await defaultDeps.command(
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        scenarioPrefix,
        `${input.packageName}@${input.candidateVersion}`,
      ],
      { env }
    );
    await defaultDeps.command(
      cliExecutable,
      ["config", "--host", "127.0.0.1", "--port", String(port), "--state-dir", stateDirectory],
      { env }
    );
    server = await defaultDeps.startServer({ executable: cliExecutable, env, port });
    const release = await defaultDeps.lookupReleaseMetadata({
      packageName: input.packageName,
      currentVersion: input.candidateVersion,
      distTag: input.distTag,
      registryUrl: input.registryUrl,
    });
    if (release.version !== input.candidateVersion) {
      throw new Error(`Fault scenario dist-tag did not resolve ${input.candidateVersion}`);
    }
    await defaultDeps.callWs({
      apiUrl: server.apiUrl,
      op: "updates.prepareInstall",
      args: {},
    });

    const record = JSON.stringify(recordPath);
    if (input.scenario === "restart") {
      await writePosixShim(
        resolve(shimDirectory, "npm"),
        `printf '%s\\n' "restart npm $*" >> ${record}\nprintf '%s\\n' 'restart simulated install' >&2\nexit 0`
      );
      await writePosixShim(
        resolve(shimDirectory, "coder-studio"),
        `printf '%s\\n' "restart coder-studio $*" >> ${record}\nprintf '%s\\n' 'restart deterministic failure' >&2\nexit 43`
      );
    } else {
      const exitCode = input.scenario === "permission" ? 77 : 42;
      const message =
        input.scenario === "permission"
          ? "permission deterministic EACCES failure"
          : "install deterministic failure";
      await writePosixShim(
        resolve(shimDirectory, "npm"),
        `printf '%s\\n' "${input.scenario} npm $*" >> ${record}\nprintf '%s\\n' '${message}' >&2\nexit ${exitCode}`
      );
    }

    const started = await startInstallAfterBackgroundCheck({
      deps: defaultDeps,
      apiUrl: server.apiUrl,
      candidateVersion: input.previousVersion,
    });
    if (started.targetVersion !== input.previousVersion) {
      throw new Error("CLI fault scenario did not retain the exact target version");
    }
    const terminal = await waitForFailureState({
      apiUrl: server.apiUrl,
      statePath,
      callWs: defaultDeps.callWs,
    });
    const workerLog = await readFile(workerLogPath, "utf8");
    const commandLog = await readFile(recordPath, "utf8");
    const expectedStatus = input.scenario === "permission" ? "manual_required" : "failed";
    const expectedManual =
      input.scenario === "permission"
        ? `npm install -g ${input.packageName}@${input.previousVersion}`
        : input.scenario === "restart"
          ? "coder-studio serve --restart"
          : null;
    if (terminal.updateStatus !== expectedStatus) {
      throw new Error(`${input.scenario} scenario produced ${terminal.updateStatus}`);
    }
    if (expectedManual && !terminal.manualCommand?.includes(expectedManual)) {
      throw new Error(`${input.scenario} scenario did not preserve its recovery command`);
    }
    const logVerified = workerLog.includes(input.scenario) && commandLog.includes(input.scenario);
    if (!logVerified) throw new Error(`${input.scenario} worker evidence is incomplete`);
    return {
      name: input.scenario,
      updateStatus: expectedStatus,
      manualCommand: terminal.manualCommand,
      logVerified,
      workerLog,
      paths: [scenarioPrefix, statePath, workerLogPath, recordPath],
    };
  } finally {
    await server?.stop().catch(() => undefined);
  }
}

const defaultDeps: VerifyCliUpdateDeps = {
  command: async (executable, args, options) => {
    const result = await execFileAsync(executable, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  },
  startServer: async ({ executable, env, port }) => {
    const child = spawn(executable, ["serve"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const apiUrl = `http://127.0.0.1:${port}`;
    child.stdout?.resume();
    child.stderr?.resume();
    await waitForHealth(apiUrl);
    return {
      apiUrl,
      stop: async () => {
        await execFileAsync(executable, ["stop"], { env, encoding: "utf8" }).catch(() => undefined);
        await stopChild(child);
      },
    };
  },
  callWs: callActivatedCoderStudioWsCommand,
  lookupReleaseMetadata: lookupNpmReleaseMetadata,
  wait: (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms)),
  startRegistryProxy: startCandidateRegistryProxy,
  waitForReconcile: async ({ apiUrl, candidateVersion, callWs }) => {
    const deadline = Date.now() + 120_000;
    let lastState: Partial<UpdateStateSnapshot> = {};
    while (Date.now() < deadline) {
      try {
        await waitForHealth(apiUrl, 5_000);
        lastState = await callWs<UpdateStateSnapshot>({
          apiUrl,
          op: "updates.getState",
          args: {},
          timeoutMs: 5_000,
        });
        if (
          lastState.version === 2 &&
          lastState.currentVersion === candidateVersion &&
          lastState.currentPublishedAt &&
          lastState.latestVersion === candidateVersion &&
          lastState.latestPublishedAt === lastState.currentPublishedAt &&
          lastState.availability === "up_to_date" &&
          (lastState.updateStatus === "succeeded" || lastState.updateStatus === "idle")
        ) {
          return lastState;
        }
      } catch {
        // The detached updater intentionally creates a short reconnect window.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    throw new Error(`Packaged CLI did not reconcile after restart: ${JSON.stringify(lastState)}`);
  },
  runFailureScenario: runDefaultFailureScenario,
  removePrefix: async (prefix) => rm(prefix, { recursive: true, force: true }),
  writeReport: writeReportAtomic,
};

function requireVersion(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`${label} must be an exact semantic version`);
  }
  return normalized;
}

async function waitForCandidateRelease(input: {
  deps: Pick<VerifyCliUpdateDeps, "lookupReleaseMetadata" | "wait">;
  packageName: string;
  previousVersion: string;
  candidateVersion: string;
  distTag: string;
  registryUrl: string;
  timeoutMs?: number;
}): Promise<NpmReleaseMetadata> {
  const deadline = Date.now() + (input.timeoutMs ?? 30_000);
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const release = await input.deps.lookupReleaseMetadata({
        packageName: input.packageName,
        currentVersion: input.previousVersion,
        distTag: input.distTag,
        registryUrl: input.registryUrl,
      });
      if (release.version !== input.candidateVersion) {
        throw new Error(
          `Selected dist-tag resolved ${release.version}, expected exact candidate ${input.candidateVersion}`
        );
      }
      return release;
    } catch (lookupError) {
      lastError = lookupError;
      const message = lookupError instanceof Error ? lookupError.message : String(lookupError);
      if (!message.includes(`did not return dist-tag ${input.distTag}`)) throw lookupError;
      await input.deps.wait(500);
    }
  }
  throw new Error(
    `Candidate dist-tag ${input.distTag} did not propagate before timeout: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

async function startInstallAfterBackgroundCheck(input: {
  deps: Pick<VerifyCliUpdateDeps, "callWs" | "wait">;
  apiUrl: string;
  candidateVersion: string;
  maxAttempts?: number;
}): Promise<UpdateStateSnapshot> {
  const maxAttempts = input.maxAttempts ?? 60;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await input.deps.callWs<UpdateStateSnapshot>({
        apiUrl: input.apiUrl,
        op: "updates.startInstall",
        args: { targetVersion: input.candidateVersion, force: false },
      });
    } catch (startError) {
      lastError = startError;
      const message = startError instanceof Error ? startError.message : String(startError);
      if (!message.startsWith("update_busy: Update check is already in progress")) {
        throw startError;
      }
      if (attempt < maxAttempts) await input.deps.wait(500);
    }
  }

  throw new Error(
    `CLI updater remained busy while waiting for its startup update check: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

export async function verifyCliUpdate(
  options: VerifyCliUpdateOptions,
  deps: VerifyCliUpdateDeps = defaultDeps
): Promise<CliUpdateAcceptanceReport> {
  const previousVersion = requireVersion(options.previousVersion, "previousVersion");
  const candidateVersion = requireVersion(options.candidateVersion, "candidateVersion");
  const packageName = options.packageName.trim();
  if (!packageName || !options.distTag.trim())
    throw new Error("Package name and dist-tag are required");
  const prefix = options.prefix
    ? assertAcceptancePrefix(options.prefix)
    : await mkdtemp(resolve(tmpdir(), PREFIX_BASENAME));
  const stateDirectory = resolve(prefix, "state");
  const binDirectory = process.platform === "win32" ? prefix : resolve(prefix, "bin");
  const cliExecutable =
    process.platform === "win32"
      ? resolve(prefix, "coder-studio.cmd")
      : resolve(binDirectory, "coder-studio");
  const port = await reservePort();
  const registryUrl = new URL(options.registryUrl).toString();
  let registryProxy: ManagedRegistryProxy | null = null;
  let server: ManagedServer | null = null;
  try {
    const release = await waitForCandidateRelease({
      deps,
      packageName,
      previousVersion,
      candidateVersion,
      distTag: options.distTag.trim(),
      registryUrl,
    });
    if (!release.latestPublishedAt || !Number.isFinite(Date.parse(release.latestPublishedAt))) {
      throw new Error("Candidate npm publication time is missing");
    }
    registryProxy = await deps.startRegistryProxy({
      registryUrl,
      packageName,
      candidateVersion,
    });
    const acceptanceEnv = acceptanceEnvironment({
      prefix,
      binDirectory,
      registryUrl: registryProxy.registryUrl,
      distTag: options.distTag.trim(),
    });
    await mkdir(stateDirectory, { recursive: true });
    await deps.command(
      "npm",
      ["install", "--global", "--prefix", prefix, `${packageName}@${previousVersion}`],
      { env: acceptanceEnv }
    );
    await deps.command(
      cliExecutable,
      ["config", "--host", "127.0.0.1", "--port", String(port), "--state-dir", stateDirectory],
      { env: acceptanceEnv }
    );
    server = await deps.startServer({ executable: cliExecutable, env: acceptanceEnv, port });
    const initial = await deps.callWs<ReadableUpdateStateSnapshot>({
      apiUrl: server.apiUrl,
      op: "updates.getState",
      args: {},
    });
    if (
      initial.currentVersion !== previousVersion ||
      (initial.version !== 1 && initial.version !== 2)
    ) {
      throw new Error(`Packaged CLI did not start at exact previous version ${previousVersion}`);
    }
    if (initial.version === 2) {
      const checked = await deps.callWs<UpdateStateSnapshot>({
        apiUrl: server.apiUrl,
        op: "updates.check",
        args: {},
      });
      if (
        checked.latestVersion !== candidateVersion ||
        checked.latestPublishedAt !== release.latestPublishedAt
      ) {
        throw new Error(`Selected dist-tag must resolve exact candidate ${candidateVersion}`);
      }
    }
    const prepared = await deps.callWs<UpdatePrepareInstallResponse>({
      apiUrl: server.apiUrl,
      op: "updates.prepareInstall",
      args: {},
    });
    if (prepared.activity.hasActiveWork)
      throw new Error("CLI acceptance prefix unexpectedly has active work");
    const started = await startInstallAfterBackgroundCheck({
      deps,
      apiUrl: server.apiUrl,
      candidateVersion,
    });
    if (
      started.targetVersion !== candidateVersion ||
      (started.updateStatus !== "installing" && started.updateStatus !== "restarting")
    ) {
      throw new Error("CLI updater did not enter the exact-version restart handoff");
    }
    const reconciled = await deps.waitForReconcile({
      apiUrl: server.apiUrl,
      candidateVersion,
      callWs: deps.callWs,
    });
    if (
      reconciled.version !== 2 ||
      reconciled.currentVersion !== candidateVersion ||
      reconciled.currentPublishedAt !== release.latestPublishedAt ||
      reconciled.latestVersion !== candidateVersion ||
      reconciled.latestPublishedAt !== release.latestPublishedAt ||
      reconciled.availability !== "up_to_date" ||
      (reconciled.updateStatus !== "succeeded" && reconciled.updateStatus !== "idle")
    ) {
      throw new Error("CLI restart did not preserve npm metadata or reconcile to succeeded");
    }
    const scenarioEvidence: CliFailureScenarioEvidence[] = [];
    for (const scenario of ["permission", "install", "restart"] as const) {
      const evidence = await deps.runFailureScenario({
        scenario,
        packageName,
        previousVersion,
        candidateVersion,
        registryUrl,
        distTag: options.distTag.trim(),
        prefix,
      });
      const escapedPath = evidence.paths.find((path) => !isPathInside(prefix, path));
      if (escapedPath) {
        throw new Error(
          `${scenario} failure evidence escaped outside acceptance prefix: ${escapedPath}`
        );
      }
      scenarioEvidence.push(evidence);
    }
    const report: CliUpdateAcceptanceReport = {
      schemaVersion: 1,
      commitSha: options.commitSha?.trim() || null,
      packageName,
      previousVersion,
      candidateVersion,
      candidatePublishedAt: release.latestPublishedAt,
      prefix,
      exactInstallObserved: true,
      restartObserved: true,
      reconciledStatus: "succeeded",
      scenarios: scenarioEvidence.map(({ name, updateStatus, manualCommand, logVerified }) => ({
        name,
        updateStatus,
        manualCommand,
        logVerified,
      })),
    };
    if (options.reportPath) await deps.writeReport(options.reportPath, report);
    return report;
  } finally {
    await server?.stop().catch(() => undefined);
    await registryProxy?.stop().catch(() => undefined);
    await deps.removePrefix(prefix);
  }
}

function readArg(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseVerifyCliUpdateArgs(argv: string[]): VerifyCliUpdateOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--") continue;
    if (!option?.startsWith("--")) throw new Error(`Unknown CLI acceptance argument: ${option}`);
    values.set(option.slice(2), readArg(argv, ++index, option));
  }
  const required = [
    "package-name",
    "previous-version",
    "candidate-version",
    "registry-url",
    "dist-tag",
  ];
  for (const name of required) if (!values.get(name)) throw new Error(`--${name} is required`);
  return {
    packageName: values.get("package-name") as string,
    previousVersion: values.get("previous-version") as string,
    candidateVersion: values.get("candidate-version") as string,
    registryUrl: values.get("registry-url") as string,
    distTag: values.get("dist-tag") as string,
    commitSha: values.get("commit-sha"),
    prefix: values.get("prefix"),
    reportPath: values.get("report"),
  };
}

async function main(): Promise<void> {
  const report = await verifyCliUpdate(parseVerifyCliUpdateArgs(process.argv.slice(2)));
  success("Packaged CLI update acceptance passed");
  console.log(JSON.stringify(report, null, 2));
}

if (isDirectExecution(import.meta.url)) {
  main().catch((acceptanceError) => {
    error(acceptanceError instanceof Error ? acceptanceError.message : String(acceptanceError));
    process.exit(1);
  });
}
