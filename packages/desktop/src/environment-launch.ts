import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DesktopEnvironmentTarget } from "./protocol.js";

export const DEFAULT_ENVIRONMENT_LAUNCH_TIMEOUT_MS = 45_000;

export type EnvironmentLaunchStatusKind = "pending" | "ready" | "failed" | "timed-out";

export interface EnvironmentLaunchStatus {
  schemaVersion: 1;
  requestId: string;
  environmentId: string;
  status: EnvironmentLaunchStatusKind;
  pid?: number;
  message?: string;
  updatedAt: number;
}

export interface EnvironmentLaunchWaitOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface EnvironmentLaunchStoreOptions {
  link?: (source: string, destination: string) => Promise<void>;
  readFile?: (path: string) => Promise<string>;
  remove?: (path: string, options?: { force?: boolean; recursive?: boolean }) => Promise<void>;
}

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSITION_FINALIZE_TIMEOUT_MS = 2_000;
const TRANSITION_FINALIZE_POLL_INTERVAL_MS = 10;

export function isEnvironmentLaunchRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

function isEnvironmentLaunchTarget(value: unknown): value is DesktopEnvironmentTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<DesktopEnvironmentTarget>;
  return (
    typeof target.id === "string" &&
    target.id.length > 0 &&
    typeof target.label === "string" &&
    target.label.length > 0
  );
}

function parseStatus(value: unknown, requestId: string): EnvironmentLaunchStatus | null {
  if (!value || typeof value !== "object") return null;
  const status = value as Partial<EnvironmentLaunchStatus>;
  if (
    status.schemaVersion !== 1 ||
    status.requestId !== requestId ||
    typeof status.environmentId !== "string" ||
    status.environmentId.length === 0 ||
    (status.status !== "pending" &&
      status.status !== "ready" &&
      status.status !== "failed" &&
      status.status !== "timed-out") ||
    typeof status.updatedAt !== "number" ||
    !Number.isFinite(status.updatedAt) ||
    (status.pid !== undefined &&
      (typeof status.pid !== "number" || !Number.isInteger(status.pid) || status.pid < 0)) ||
    (status.message !== undefined && typeof status.message !== "string")
  ) {
    return null;
  }
  return status as EnvironmentLaunchStatus;
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !["EPERM", "EACCES", "EBUSY"].includes(code) || attempt === 5) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20 * 2 ** attempt));
    }
  }
}

async function wait(delayMs: number): Promise<void> {
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delayMs));
}

async function linkWithRetry(
  source: string,
  destination: string,
  linkOperation: (source: string, destination: string) => Promise<void>
): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await linkOperation(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !["EPERM", "EACCES", "EBUSY"].includes(code) || attempt === 5) throw error;
      await wait(20 * 2 ** attempt);
    }
  }
}

async function readFileWithRetry(
  path: string,
  readOperation: (path: string) => Promise<string>
): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await readOperation(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !["EPERM", "EACCES", "EBUSY"].includes(code) || attempt === 5) throw error;
      await wait(20 * 2 ** attempt);
    }
  }
  throw new Error("Unreachable read retry state");
}

async function removeTemporaryBestEffort(
  path: string,
  removeOperation: (
    path: string,
    options?: { force?: boolean; recursive?: boolean }
  ) => Promise<void>
): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await removeOperation(path, { force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code && ["EPERM", "EACCES", "EBUSY"].includes(code) && attempt < 5) {
        await wait(20 * 2 ** attempt);
      } else {
        return;
      }
    }
  }
}

const TEMP_ENTRY_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\.terminal)?\.json\.[a-z0-9_-]+\.tmp$/i;

export class EnvironmentLaunchStore {
  private readonly launchesRoot: string;
  private readonly linkOperation: (source: string, destination: string) => Promise<void>;
  private readonly readFileOperation: (path: string) => Promise<string>;
  private readonly removeOperation: (
    path: string,
    options?: { force?: boolean; recursive?: boolean }
  ) => Promise<void>;

  constructor(rootUserDataDir: string, options: EnvironmentLaunchStoreOptions = {}) {
    this.launchesRoot = resolve(rootUserDataDir, "environment-launches");
    this.linkOperation = options.link ?? ((source, destination) => link(source, destination));
    this.readFileOperation = options.readFile ?? ((path) => readFile(path, "utf8"));
    this.removeOperation = options.remove ?? ((path, removeOptions) => rm(path, removeOptions));
  }

  getRequestPath(requestId: string): string {
    if (!isEnvironmentLaunchRequestId(requestId)) {
      throw new Error("Invalid environment launch request id");
    }
    return resolve(this.launchesRoot, `${requestId}.json`);
  }

  async create(target: DesktopEnvironmentTarget): Promise<EnvironmentLaunchStatus> {
    this.assertTarget(target);
    const status: EnvironmentLaunchStatus = {
      schemaVersion: 1,
      requestId: randomUUID(),
      environmentId: target.id,
      status: "pending",
      updatedAt: Date.now(),
    };
    await this.write(status);
    return status;
  }

  async read(requestId: string): Promise<EnvironmentLaunchStatus | null> {
    if (!isEnvironmentLaunchRequestId(requestId)) return null;
    try {
      const terminal = parseStatus(
        JSON.parse(
          await readFileWithRetry(this.getTerminalClaimPath(requestId), this.readFileOperation)
        ),
        requestId
      );
      if (!terminal || terminal.status === "pending") return null;
      return terminal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        if (error instanceof SyntaxError) return null;
        throw error;
      }
    }
    try {
      return parseStatus(
        JSON.parse(await readFileWithRetry(this.getRequestPath(requestId), this.readFileOperation)),
        requestId
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        return null;
      }
      throw error;
    }
  }

  async markReady(requestId: string, environmentId: string, pid: number): Promise<boolean> {
    if (!isEnvironmentLaunchRequestId(requestId) || typeof environmentId !== "string") return false;
    if (!Number.isInteger(pid) || pid < 0) return false;
    return this.transition(requestId, environmentId, {
      status: "ready",
      pid,
      message: undefined,
    });
  }

  async markFailed(requestId: string, environmentId: string, message: string): Promise<boolean> {
    if (!isEnvironmentLaunchRequestId(requestId) || typeof environmentId !== "string") return false;
    return this.transition(requestId, environmentId, { status: "failed", message });
  }

  async waitForTerminal(
    requestId: string,
    target: DesktopEnvironmentTarget,
    options: EnvironmentLaunchWaitOptions = {}
  ): Promise<EnvironmentLaunchStatus> {
    this.getRequestPath(requestId);
    this.assertTarget(target);
    const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 100);
    const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_ENVIRONMENT_LAUNCH_TIMEOUT_MS);
    const startedAt = Date.now();

    while (true) {
      const status = await this.read(requestId);
      if (!status) throw new Error(`Environment launch request disappeared: ${requestId}`);
      if (status && status.environmentId !== target.id) {
        throw new Error(`Environment launch request does not match ${target.label}.`);
      }
      const result = this.terminalResult(status, target);
      if (result.kind === "terminal") return result.status;
      if (result.kind === "failure") throw new Error(result.message);

      if (Date.now() - startedAt >= timeoutMs) {
        // A ready notification may have landed at the timeout boundary. Reread before
        // attempting the timed-out transition so that it wins when it arrived first.
        const boundaryStatus = await this.read(requestId);
        if (!boundaryStatus)
          throw new Error(`Environment launch request disappeared: ${requestId}`);
        if (boundaryStatus && boundaryStatus.environmentId !== target.id) {
          throw new Error(`Environment launch request does not match ${target.label}.`);
        }
        const boundaryResult = this.terminalResult(boundaryStatus, target);
        if (boundaryResult.kind === "terminal") return boundaryResult.status;
        if (boundaryResult.kind === "failure") throw new Error(boundaryResult.message);

        const message = `Timed out waiting for ${target.label} to open. It may still be starting; try again to focus it.`;
        const finalizeDeadline = Date.now() + TRANSITION_FINALIZE_TIMEOUT_MS;
        while (true) {
          await this.transition(requestId, target.id, {
            status: "timed-out",
            message,
            pid: undefined,
          });
          const afterTransition = await this.read(requestId);
          if (!afterTransition)
            throw new Error(`Environment launch request disappeared: ${requestId}`);
          if (afterTransition.environmentId !== target.id) {
            throw new Error(`Environment launch request does not match ${target.label}.`);
          }
          const afterResult = this.terminalResult(afterTransition, target);
          if (afterResult.kind === "terminal") return afterResult.status;
          if (afterResult.kind === "failure") throw new Error(afterResult.message);
          if (Date.now() >= finalizeDeadline) {
            throw new Error(`Unable to finalize environment launch request: ${requestId}`);
          }
          await wait(TRANSITION_FINALIZE_POLL_INTERVAL_MS);
        }
      }

      await wait(Math.min(pollIntervalMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
    }
  }

  async cleanupStale(maxAgeMs: number, now = Date.now()): Promise<void> {
    let entries;
    try {
      entries = await readdir(this.launchesRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    const stalePaths = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".terminal.json")) {
        const requestId = entry.name.slice(0, -".terminal.json".length);
        if (isEnvironmentLaunchRequestId(requestId)) {
          stalePaths.add(this.getTerminalClaimPath(requestId));
        }
      } else if (entry.name.endsWith(".json")) {
        const requestId = entry.name.slice(0, -5);
        if (isEnvironmentLaunchRequestId(requestId)) stalePaths.add(this.getRequestPath(requestId));
      } else {
        const match = TEMP_ENTRY_PATTERN.exec(entry.name);
        if (match && isEnvironmentLaunchRequestId(match[1])) {
          stalePaths.add(resolve(this.launchesRoot, entry.name));
        }
      }
    }

    for (const path of stalePaths) {
      let details;
      try {
        details = await stat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (now - details.mtimeMs <= maxAgeMs) continue;
      try {
        await rm(path, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private async transition(
    requestId: string,
    environmentId: string,
    update: Pick<EnvironmentLaunchStatus, "status" | "pid" | "message">
  ): Promise<boolean> {
    const current = await this.read(requestId);
    if (!current || current.status !== "pending" || current.environmentId !== environmentId)
      return false;

    const status: EnvironmentLaunchStatus = {
      ...current,
      ...update,
      updatedAt: Date.now(),
    };
    const terminalPath = this.getTerminalClaimPath(requestId);
    const temporaryPath = `${terminalPath}.${randomUUID()}.tmp`;
    await mkdir(dirname(terminalPath), { recursive: true });
    try {
      await writeFile(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
      try {
        await linkWithRetry(temporaryPath, terminalPath, this.linkOperation);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw error;
      }
    } finally {
      await removeTemporaryBestEffort(temporaryPath, this.removeOperation);
    }
  }

  private async write(status: EnvironmentLaunchStatus): Promise<void> {
    await mkdir(dirname(this.getRequestPath(status.requestId)), { recursive: true });
    const requestPath = this.getRequestPath(status.requestId);
    const temporaryPath = `${requestPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
      await renameWithRetry(temporaryPath, requestPath);
    } finally {
      await removeTemporaryBestEffort(temporaryPath, this.removeOperation);
    }
  }

  private getTerminalClaimPath(requestId: string): string {
    if (!isEnvironmentLaunchRequestId(requestId)) {
      throw new Error("Invalid environment launch request id");
    }
    return resolve(this.launchesRoot, `${requestId}.terminal.json`);
  }

  private assertTarget(target: DesktopEnvironmentTarget): void {
    if (!isEnvironmentLaunchTarget(target)) throw new Error("Invalid environment launch target");
  }

  private terminalResult(
    status: EnvironmentLaunchStatus | null,
    target: DesktopEnvironmentTarget
  ):
    | { kind: "pending" }
    | { kind: "terminal"; status: EnvironmentLaunchStatus }
    | { kind: "failure"; message: string } {
    if (!status || status.status === "pending") return { kind: "pending" };
    if (status.status === "ready") return { kind: "terminal", status };
    if (status.status === "failed") {
      return { kind: "failure", message: status.message ?? `${target.label} failed to open.` };
    }
    return {
      kind: "failure",
      message: status.message ?? `Timed out waiting for ${target.label} to open.`,
    };
  }
}
