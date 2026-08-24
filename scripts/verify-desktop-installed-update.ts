import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { ProductUpdateState, UpdatePrepareInstallResponse } from "@coder-studio/core";
import { callCoderStudioWsCommand } from "../packages/cli/src/automation-ws-client.js";
import { error, ROOT_DIR, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

const execFileAsync = promisify(execFile);

export type InstalledDesktopScenarioName =
  | "fresh-native"
  | "fresh-wsl"
  | "legacy-current"
  | "legacy-wsl-current"
  | "runtime-only"
  | "combined"
  | "wsl"
  | "wsl-combined"
  | "runtime-health-rollback"
  | "interrupted-download"
  | "restart-journal-recovery"
  | "external-sidecar-browser";

export interface InstalledDesktopScenario {
  name: InstalledDesktopScenarioName;
  expectedComponentIds: string[];
  previousShellVersion: string;
  previousRuntimeVersion: string;
  targetShellVersion: string;
  targetRuntimeVersion: string;
  expectedRuntimeAfterRestart?: string;
}

type DesktopBridgeMethod =
  | "getAppVersion"
  | "getUpdateState"
  | "checkForUpdates"
  | "downloadUpdate"
  | "prepareUpdateRestart"
  | "restartAndInstallUpdate";

interface InstalledEvidence {
  actualShellVersion: string;
  actualRuntimeVersion: string;
  wslRuntimeVersion: string | null;
  wslNpmMarkerExists: boolean;
  journalRecovered: boolean;
  rollbackRuntimeVersion?: string | null;
  externalSidecarReadOnly?: boolean;
  logPaths?: string[];
}

export interface VerifyInstalledDesktopDeps {
  invoke(method: DesktopBridgeMethod): Promise<unknown>;
  waitForState(status: ProductUpdateState["status"]): Promise<unknown>;
  prepareActivity(): Promise<Pick<UpdatePrepareInstallResponse, "hasActiveWork">>;
  interruptAtPhase(phase: "downloading" | "restart-journal" | "wsl-follow"): Promise<void>;
  verifyExternalSidecar(): Promise<{
    preloadAvailable: boolean;
    updateOperations: string[];
  }>;
  reconnectAfterRestart(): Promise<void>;
  readEvidence(): Promise<InstalledEvidence>;
}

export interface VerifyInstalledDesktopOptions {
  downloadTimeoutMs?: number;
}

export interface InstalledDesktopScenarioReport extends InstalledEvidence {
  schemaVersion: 1;
  scenario: InstalledDesktopScenarioName;
  confirmationCount: number;
  restartCount: number;
  expectedComponentIds: string[];
  journalRecovered: boolean;
  rollbackRuntimeVersion: string | null;
  externalSidecarReadOnly: boolean;
  logPaths: string[];
}

export function formatCookieHeader(
  cookies: ReadonlyArray<{ name?: string; value?: string }>
): string | undefined {
  const parts = cookies.flatMap((cookie) => {
    const name = cookie.name?.trim();
    if (!name) return [];
    return [`${name}=${cookie.value ?? ""}`];
  });
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function asState(value: unknown, phase: string): ProductUpdateState {
  if (!value || typeof value !== "object") throw new Error(`${phase} did not return update state`);
  return value as ProductUpdateState;
}

function assertPlanComponents(state: ProductUpdateState, expected: string[]): void {
  const actual = state.components.map((component) => component.id).sort();
  const normalizedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(normalizedExpected)) {
    throw new Error(
      `Installed Desktop plan component mismatch: expected ${normalizedExpected.join(", ")}; received ${actual.join(", ")}`
    );
  }
}

function isWslScenario(name: InstalledDesktopScenarioName): boolean {
  return (
    name === "fresh-wsl" ||
    name === "legacy-wsl-current" ||
    name === "wsl" ||
    name === "wsl-combined"
  );
}

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1_000;

async function downloadUpdateWithTimeout(
  deps: VerifyInstalledDesktopDeps,
  timeoutMs: number
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      deps.invoke("downloadUpdate"),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            reject(
              new Error(
                `Installed Desktop downloadUpdate timed out after ${Math.ceil(timeoutMs / 1_000)} seconds`
              )
            );
          },
          Math.max(0, timeoutMs)
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function verifyInstalledDesktopScenario(
  scenario: InstalledDesktopScenario,
  deps: VerifyInstalledDesktopDeps,
  options: VerifyInstalledDesktopOptions = {}
): Promise<InstalledDesktopScenarioReport> {
  if (scenario.name === "fresh-native" || scenario.name === "fresh-wsl") {
    const evidence = await deps.readEvidence();
    if (
      evidence.actualShellVersion !== scenario.targetShellVersion ||
      evidence.actualRuntimeVersion !== scenario.targetRuntimeVersion
    ) {
      throw new Error("Freshly installed component versions do not match the candidate");
    }
    if (scenario.name === "fresh-wsl") {
      if (evidence.wslRuntimeVersion !== scenario.targetRuntimeVersion) {
        throw new Error("Fresh WSL Runtime did not activate the candidate");
      }
      if (evidence.wslNpmMarkerExists) {
        throw new Error("WSL npm marker was invoked during fresh host-managed installation");
      }
    }
    return {
      schemaVersion: 1,
      scenario: scenario.name,
      confirmationCount: 0,
      restartCount: 0,
      expectedComponentIds: [],
      ...evidence,
      rollbackRuntimeVersion: evidence.rollbackRuntimeVersion ?? null,
      externalSidecarReadOnly: evidence.externalSidecarReadOnly ?? false,
      logPaths: evidence.logPaths ?? [],
    };
  }

  if (scenario.name === "external-sidecar-browser") {
    const evidence = await deps.verifyExternalSidecar();
    const forbidden = evidence.updateOperations.filter(
      (operation) => operation === "updates.check" || operation === "updates.startInstall"
    );
    if (evidence.preloadAvailable || forbidden.length > 0) {
      throw new Error(
        `External sidecar browser acquired update authority: ${forbidden.join(", ") || "preload"}`
      );
    }
    return {
      schemaVersion: 1,
      scenario: scenario.name,
      confirmationCount: 0,
      restartCount: 0,
      expectedComponentIds: [],
      actualShellVersion: scenario.previousShellVersion,
      actualRuntimeVersion: scenario.previousRuntimeVersion,
      wslRuntimeVersion: null,
      wslNpmMarkerExists: false,
      journalRecovered: false,
      rollbackRuntimeVersion: null,
      externalSidecarReadOnly: true,
      logPaths: [],
    };
  }

  if (scenario.name === "legacy-current" || scenario.name === "legacy-wsl-current") {
    const checked = asState(await deps.invoke("checkForUpdates"), "checkForUpdates");
    assertPlanComponents(checked, []);
    if (checked.status !== "idle" && checked.status !== "succeeded") {
      throw new Error(`Frozen legacy Desktop channel produced update state ${checked.status}`);
    }
    const evidence = await deps.readEvidence();
    if (
      evidence.actualShellVersion !== scenario.targetShellVersion ||
      evidence.actualRuntimeVersion !== scenario.targetRuntimeVersion
    ) {
      throw new Error("Frozen legacy Desktop changed an installed component version");
    }
    if (scenario.name === "legacy-wsl-current") {
      if (evidence.wslRuntimeVersion !== scenario.targetRuntimeVersion) {
        throw new Error("Frozen legacy WSL Runtime did not remain current");
      }
      if (evidence.wslNpmMarkerExists) {
        throw new Error("WSL npm marker was invoked by the frozen legacy channel");
      }
    }
    return {
      schemaVersion: 1,
      scenario: scenario.name,
      confirmationCount: 0,
      restartCount: 0,
      expectedComponentIds: [],
      ...evidence,
      rollbackRuntimeVersion: evidence.rollbackRuntimeVersion ?? null,
      externalSidecarReadOnly: evidence.externalSidecarReadOnly ?? false,
      logPaths: evidence.logPaths ?? [],
    };
  }

  const stagedWslFollow =
    isWslScenario(scenario.name) && scenario.expectedComponentIds.includes("runtime:win32-x64");
  let checked = asState(await deps.invoke("checkForUpdates"), "checkForUpdates");
  assertPlanComponents(checked, scenario.expectedComponentIds);
  const downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  if (scenario.name === "interrupted-download") {
    const interruptedDownload = downloadUpdateWithTimeout(deps, downloadTimeoutMs).catch(
      () => undefined
    );
    await deps.waitForState("downloading");
    await deps.interruptAtPhase("downloading");
    await interruptedDownload;
    await deps.reconnectAfterRestart();
    checked = asState(await deps.invoke("checkForUpdates"), "checkForUpdates after interruption");
    assertPlanComponents(checked, scenario.expectedComponentIds);
    await downloadUpdateWithTimeout(deps, downloadTimeoutMs);
  } else {
    await downloadUpdateWithTimeout(deps, downloadTimeoutMs);
  }
  await deps.waitForState("ready");
  await deps.prepareActivity();
  const confirmationCount = 1;
  await deps.invoke("prepareUpdateRestart");
  if (scenario.name === "restart-journal-recovery") {
    await deps.interruptAtPhase("restart-journal");
    await deps.reconnectAfterRestart();
    const recovered = asState(
      await deps.invoke("getUpdateState"),
      "getUpdateState after journal interruption"
    );
    if (recovered.status !== "ready") {
      throw new Error(`Desktop did not recover a ready journal plan: ${recovered.status}`);
    }
  }
  const restartResult = await deps.invoke("restartAndInstallUpdate");
  if (restartResult !== true) throw new Error("Desktop rejected restart-and-install handoff");
  const restartCount = 1;
  await deps.reconnectAfterRestart();
  const finalState = asState(await deps.invoke("getUpdateState"), "getUpdateState");
  if (finalState.status !== "succeeded" && finalState.status !== "idle") {
    throw new Error(`Installed Desktop did not reconcile after restart: ${finalState.status}`);
  }
  if (stagedWslFollow) {
    await deps.interruptAtPhase("wsl-follow");
    await deps.reconnectAfterRestart();
  }
  const evidence = await deps.readEvidence();
  const expectedRuntime = scenario.expectedRuntimeAfterRestart ?? scenario.targetRuntimeVersion;
  if (
    evidence.actualShellVersion !== scenario.targetShellVersion ||
    evidence.actualRuntimeVersion !== expectedRuntime
  ) {
    throw new Error("Installed component versions do not match the accepted candidate");
  }
  if (isWslScenario(scenario.name)) {
    if (evidence.wslRuntimeVersion !== scenario.targetRuntimeVersion) {
      throw new Error("WSL Runtime did not activate the host-staged target");
    }
    if (evidence.wslNpmMarkerExists) {
      throw new Error("WSL npm marker was invoked during host-managed Runtime update");
    }
  }
  if (scenario.name === "restart-journal-recovery" && !evidence.journalRecovered) {
    throw new Error("Desktop update journal was not recovered after restart");
  }
  if (
    scenario.name === "runtime-health-rollback" &&
    evidence.rollbackRuntimeVersion !== expectedRuntime
  ) {
    throw new Error("Runtime health rollback did not select the previous trusted Runtime");
  }
  return {
    schemaVersion: 1,
    scenario: scenario.name,
    confirmationCount,
    restartCount,
    expectedComponentIds: [...scenario.expectedComponentIds],
    ...evidence,
    rollbackRuntimeVersion: evidence.rollbackRuntimeVersion ?? null,
    externalSidecarReadOnly: evidence.externalSidecarReadOnly ?? false,
    logPaths: evidence.logPaths ?? [],
  };
}

interface InstalledDriverOptions {
  cdpUrl: string;
  sidecarUrl?: string;
  scenario: InstalledDesktopScenario;
  evidencePath?: string;
  controlPath?: string;
  userDataDir?: string;
  wslDistro?: string;
  wslMarkerPath?: string;
  reportPath?: string;
  commitSha?: string;
  releaseTag?: string;
  channelSignatureDigest?: string;
}

interface BrowserSession {
  close(): Promise<void>;
  evaluate(method: DesktopBridgeMethod): Promise<unknown>;
  verifyExternalSidecar(url: string): Promise<{
    preloadAvailable: boolean;
    updateOperations: string[];
  }>;
  getCookieHeader(url: string): Promise<string | undefined>;
}

async function connectBrowser(cdpUrl: string): Promise<BrowserSession> {
  const playwrightUrl = pathToFileURL(
    resolve(ROOT_DIR, "e2e/node_modules/@playwright/test/index.mjs")
  ).toString();
  const playwright = (await import(playwrightUrl)) as {
    chromium: {
      launch(options: { channel: "msedge"; headless: true }): Promise<{
        newPage(): Promise<{
          addInitScript(callback: () => void): Promise<void>;
          goto(url: string, options: { waitUntil: "domcontentloaded" }): Promise<unknown>;
          waitForTimeout(timeout: number): Promise<void>;
          evaluate<T>(callback: () => T | Promise<T>): Promise<T>;
        }>;
        close(): Promise<void>;
      }>;
      connectOverCDP(url: string): Promise<{
        contexts(): Array<{
          cookies(urls?: string[]): Promise<
            Array<{
              name?: string;
              value?: string;
            }>
          >;
          pages(): Array<{
            evaluate<T, A>(callback: (argument: A) => T | Promise<T>, argument: A): Promise<T>;
          }>;
          newPage(): Promise<{
            addInitScript(callback: () => void): Promise<void>;
            goto(url: string, options: { waitUntil: "domcontentloaded" }): Promise<unknown>;
            waitForTimeout(timeout: number): Promise<void>;
            evaluate<T>(callback: () => T | Promise<T>): Promise<T>;
            close(): Promise<void>;
          }>;
        }>;
        close(): Promise<void>;
      }>;
    };
  };
  const browser = await playwright.chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = context?.pages()[0];
  if (!page) throw new Error("Installed Desktop CDP session has no renderer page");
  return {
    close: () => browser.close(),
    evaluate: (method) =>
      page.evaluate((bridgeMethod) => {
        const bridge = (
          window as Window & {
            coderStudioDesktop?: Record<string, () => Promise<unknown>>;
          }
        ).coderStudioDesktop;
        const operation = bridge?.[bridgeMethod];
        if (typeof operation !== "function") {
          throw new Error(`Desktop preload method is unavailable: ${bridgeMethod}`);
        }
        return operation.call(bridge);
      }, method),
    verifyExternalSidecar: async (url) => {
      const externalBrowser = await playwright.chromium.launch({
        channel: "msedge",
        headless: true,
      });
      const externalPage = await externalBrowser.newPage();
      try {
        await externalPage.addInitScript(() => {
          const sent: string[] = [];
          const originalSend = WebSocket.prototype.send;
          WebSocket.prototype.send = function patchedSend(
            data: string | ArrayBufferLike | Blob | ArrayBufferView
          ) {
            if (typeof data === "string") sent.push(data);
            return originalSend.call(this, data);
          };
          Object.defineProperty(window, "__coderStudioAcceptanceWsMessages", {
            value: sent,
            configurable: false,
            writable: false,
          });
        });
        await externalPage.goto(url, { waitUntil: "domcontentloaded" });
        await externalPage.waitForTimeout(1_000);
        return await externalPage.evaluate(() => {
          const candidate = window as Window & {
            coderStudioDesktop?: unknown;
            __coderStudioAcceptanceWsMessages?: string[];
          };
          const operations = (candidate.__coderStudioAcceptanceWsMessages ?? []).flatMap(
            (message) => {
              try {
                const parsed = JSON.parse(message) as { op?: unknown };
                return typeof parsed.op === "string" ? [parsed.op] : [];
              } catch {
                return [];
              }
            }
          );
          return {
            preloadAvailable: candidate.coderStudioDesktop !== undefined,
            updateOperations: operations,
          };
        });
      } finally {
        await externalBrowser.close();
      }
    },
    getCookieHeader: async (url) => formatCookieHeader(await context.cookies([url])),
  };
}

async function readEvidenceFile(path: string | undefined): Promise<Partial<InstalledEvidence>> {
  if (!path) return {};
  return JSON.parse(await readFile(resolve(path), "utf8")) as Partial<InstalledEvidence>;
}

async function requestInterruption(
  path: string | undefined,
  phase: "downloading" | "restart-journal" | "wsl-follow"
): Promise<boolean> {
  if (!path) throw new Error(`Installed Desktop interruption control is required for ${phase}`);
  const controlPath = resolve(path);
  await writeJsonAtomic(controlPath, { schemaVersion: 1, phase, status: "requested" });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(await readFile(controlPath, "utf8")) as {
        phase?: unknown;
        status?: unknown;
      };
      if (state.phase === phase && state.status === "relaunched") {
        return (state as { journalRecovered?: unknown }).journalRecovered === true;
      }
    } catch {
      // The PowerShell orchestrator may be replacing the control file atomically.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for installed Desktop interruption at ${phase}`);
}

async function readActiveRuntimeVersion(userDataDir: string | undefined): Promise<string | null> {
  if (!userDataDir) return null;
  try {
    const active = JSON.parse(
      await readFile(resolve(userDataDir, "runtime-store", "active.json"), "utf8")
    ) as { active?: { runtimeVersion?: unknown } };
    return typeof active.active?.runtimeVersion === "string" ? active.active.runtimeVersion : null;
  } catch {
    return null;
  }
}

async function readFactoryRuntimeVersion(userDataDir: string | undefined): Promise<string | null> {
  if (!userDataDir) return null;
  try {
    const manifest = JSON.parse(
      await readFile(resolve(userDataDir, "factory-runtime", "runtime.manifest.json"), "utf8")
    ) as { runtimeVersion?: unknown };
    return typeof manifest.runtimeVersion === "string" ? manifest.runtimeVersion : null;
  } catch {
    return null;
  }
}

async function readWslActiveRuntimeVersion(distro: string | undefined): Promise<string | null> {
  if (!distro) return null;
  try {
    const result = await execFileAsync(
      "wsl.exe",
      [
        "-d",
        distro,
        "--exec",
        "sh",
        "-lc",
        'cat "$HOME/.local/share/coder-studio-desktop/runtime-store/active.json"',
      ],
      { windowsHide: true, encoding: "utf8" }
    );
    const active = JSON.parse(result.stdout) as { active?: { runtimeVersion?: unknown } };
    return typeof active.active?.runtimeVersion === "string" ? active.active.runtimeVersion : null;
  } catch {
    return null;
  }
}

async function wslMarkerExists(
  distro: string | undefined,
  markerPath: string | undefined
): Promise<boolean | null> {
  if (!distro || !markerPath) return null;
  try {
    await execFileAsync(
      "wsl.exe",
      ["-d", distro, "--", "sh", "-lc", `test -e ${JSON.stringify(markerPath)}`],
      { windowsHide: true }
    );
    return true;
  } catch {
    return false;
  }
}

async function createDefaultDeps(options: InstalledDriverOptions): Promise<{
  deps: VerifyInstalledDesktopDeps;
  close(): Promise<void>;
}> {
  let session = await connectBrowser(options.cdpUrl);
  let journalRecovered = false;
  const invoke = (method: DesktopBridgeMethod) => session.evaluate(method);
  return {
    deps: {
      invoke,
      waitForState: async (status) => {
        const deadline = Date.now() + 120_000;
        let state: ProductUpdateState | null = null;
        while (Date.now() < deadline) {
          state = asState(await invoke("getUpdateState"), "getUpdateState");
          if (state.status === status) return state;
          await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        }
        throw new Error(`Timed out waiting for Desktop update state ${status}: ${state?.status}`);
      },
      prepareActivity: async () => {
        if (!options.sidecarUrl) {
          return { hasActiveWork: false } as UpdatePrepareInstallResponse;
        }
        const cookieHeader = await session.getCookieHeader(options.sidecarUrl);
        return callCoderStudioWsCommand<UpdatePrepareInstallResponse>({
          apiUrl: options.sidecarUrl,
          op: "updates.prepareInstall",
          args: {},
          ...(cookieHeader
            ? {
                headers: {
                  Cookie: cookieHeader,
                },
              }
            : {}),
        });
      },
      interruptAtPhase: async (phase) => {
        journalRecovered =
          (await requestInterruption(options.controlPath, phase)) || journalRecovered;
      },
      verifyExternalSidecar: async () => {
        if (!options.sidecarUrl) {
          throw new Error("External sidecar scenario requires --sidecar-url");
        }
        return session.verifyExternalSidecar(options.sidecarUrl);
      },
      reconnectAfterRestart: async () => {
        await session.close().catch(() => undefined);
        const deadline = Date.now() + 120_000;
        let lastError: unknown;
        while (Date.now() < deadline) {
          try {
            session = await connectBrowser(options.cdpUrl);
            await invoke("getUpdateState");
            return;
          } catch (connectError) {
            lastError = connectError;
            await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
          }
        }
        throw new Error(
          `Unable to reconnect to installed Desktop: ${
            lastError instanceof Error ? lastError.message : String(lastError)
          }`
        );
      },
      readEvidence: async () => {
        const state = asState(await invoke("getUpdateState"), "getUpdateState");
        const observedShellVersion = await invoke("getAppVersion").catch(() => null);
        const observedRuntimeVersion = await readActiveRuntimeVersion(options.userDataDir);
        const observedFactoryRuntimeVersion = await readFactoryRuntimeVersion(options.userDataDir);
        const observedWslRuntimeVersion = await readWslActiveRuntimeVersion(options.wslDistro);
        const external = await readEvidenceFile(options.evidencePath);
        const observedWslMarker = await wslMarkerExists(options.wslDistro, options.wslMarkerPath);
        if (
          isWslScenario(options.scenario.name) &&
          typeof external.wslNpmMarkerExists !== "boolean" &&
          observedWslMarker === null
        ) {
          throw new Error("WSL acceptance requires an explicit npm marker result");
        }
        if (
          options.scenario.name === "restart-journal-recovery" &&
          typeof external.journalRecovered !== "boolean" &&
          !journalRecovered
        ) {
          throw new Error("Journal recovery acceptance requires explicit persisted evidence");
        }
        return {
          actualShellVersion:
            (typeof observedShellVersion === "string" ? observedShellVersion : null) ??
            external.actualShellVersion ??
            state.diagnostics.shellVersion ??
            "",
          actualRuntimeVersion:
            observedRuntimeVersion ??
            external.actualRuntimeVersion ??
            observedFactoryRuntimeVersion ??
            state.productVersion,
          wslRuntimeVersion: observedWslRuntimeVersion ?? external.wslRuntimeVersion ?? null,
          wslNpmMarkerExists: external.wslNpmMarkerExists ?? observedWslMarker ?? false,
          journalRecovered: external.journalRecovered ?? journalRecovered,
          rollbackRuntimeVersion:
            external.rollbackRuntimeVersion ??
            (options.scenario.name === "runtime-health-rollback"
              ? await readActiveRuntimeVersion(options.userDataDir)
              : null),
          externalSidecarReadOnly: external.externalSidecarReadOnly ?? false,
          logPaths: external.logPaths ?? state.diagnostics.logLocations,
        };
      },
    },
    close: () => session.close(),
  };
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[++index];
    if (!option?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Invalid installed Desktop acceptance argument: ${option ?? ""}`);
    }
    values.set(option.slice(2), value);
  }
  const required = [
    "cdp-url",
    "scenario",
    "previous-shell-version",
    "previous-runtime-version",
    "target-shell-version",
    "target-runtime-version",
  ];
  for (const key of required) if (!values.get(key)) throw new Error(`--${key} is required`);
  const scenario: InstalledDesktopScenario = {
    name: values.get("scenario") as InstalledDesktopScenarioName,
    expectedComponentIds: parseList(values.get("components") ?? ""),
    previousShellVersion: values.get("previous-shell-version") as string,
    previousRuntimeVersion: values.get("previous-runtime-version") as string,
    targetShellVersion: values.get("target-shell-version") as string,
    targetRuntimeVersion: values.get("target-runtime-version") as string,
    expectedRuntimeAfterRestart: values.get("expected-runtime-after"),
  };
  const options: InstalledDriverOptions = {
    cdpUrl: values.get("cdp-url") as string,
    sidecarUrl: values.get("sidecar-url"),
    scenario,
    evidencePath: values.get("evidence"),
    controlPath: values.get("control"),
    userDataDir: values.get("user-data-dir"),
    wslDistro: values.get("wsl-distro"),
    wslMarkerPath: values.get("wsl-marker-path"),
    reportPath: values.get("report"),
    commitSha: values.get("commit-sha"),
    releaseTag: values.get("release-tag"),
    channelSignatureDigest: values.get("channel-signature-digest"),
  };
  const runtime = await createDefaultDeps(options);
  try {
    const scenarioReport = await verifyInstalledDesktopScenario(scenario, runtime.deps);
    const report = {
      ...scenarioReport,
      commitSha: options.commitSha ?? null,
      releaseTag: options.releaseTag ?? null,
      channelSignatureDigest: options.channelSignatureDigest ?? null,
    };
    if (options.reportPath) await writeJsonAtomic(options.reportPath, report);
    success(`Installed Desktop acceptance passed: ${scenario.name}`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await runtime.close().catch(() => undefined);
  }
}

if (isDirectExecution(import.meta.url)) {
  main().catch((installedError) => {
    error(installedError instanceof Error ? installedError.message : String(installedError));
    process.exit(1);
  });
}
