import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DesktopEnvironmentTarget } from "./protocol.js";

interface PersistedEnvironmentState {
  schemaVersion: 1;
  selected: DesktopEnvironmentTarget;
  pending?: DesktopEnvironmentTarget;
  lastKnownGood: DesktopEnvironmentTarget;
}

export const NATIVE_ENVIRONMENT: DesktopEnvironmentTarget = Object.freeze({
  id: "native",
  kind: "native",
  label: "Local: Windows",
});

export function createWslEnvironmentTarget(distro: string): DesktopEnvironmentTarget {
  const normalized = distro.trim();
  if (!normalized) throw new Error("WSL distribution name must not be empty");
  return {
    id: `wsl:${Buffer.from(normalized, "utf8").toString("base64url")}`,
    kind: "wsl",
    label: `WSL: ${normalized}`,
    distro: normalized,
  };
}

function isEnvironmentTarget(value: unknown): value is DesktopEnvironmentTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<DesktopEnvironmentTarget>;
  if (typeof target.id !== "string" || typeof target.label !== "string") return false;
  if (target.kind === "native") return target.id === NATIVE_ENVIRONMENT.id;
  return target.kind === "wsl" && typeof target.distro === "string" && target.distro.length > 0;
}

function parseState(value: unknown): PersistedEnvironmentState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<PersistedEnvironmentState>;
  if (
    state.schemaVersion !== 1 ||
    !isEnvironmentTarget(state.selected) ||
    !isEnvironmentTarget(state.lastKnownGood) ||
    (state.pending !== undefined && !isEnvironmentTarget(state.pending))
  ) {
    return null;
  }
  return state as PersistedEnvironmentState;
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

export class EnvironmentStateStore {
  private readonly statePath: string;

  constructor(root: string) {
    this.statePath = resolve(root, "environment-state.json");
  }

  async read(): Promise<PersistedEnvironmentState> {
    try {
      const state = parseState(JSON.parse(await readFile(this.statePath, "utf8")));
      if (state) return state;
    } catch {
      // Missing or invalid state falls back to the native environment.
    }
    return {
      schemaVersion: 1,
      selected: NATIVE_ENVIRONMENT,
      lastKnownGood: NATIVE_ENVIRONMENT,
    };
  }

  async getStartupTarget(): Promise<DesktopEnvironmentTarget> {
    const state = await this.read();
    return state.pending ?? state.selected;
  }

  async beginSwitch(target: DesktopEnvironmentTarget): Promise<void> {
    const current = await this.read();
    await this.write({ ...current, pending: target });
  }

  async markLaunchSuccessful(target: DesktopEnvironmentTarget): Promise<void> {
    await this.write({
      schemaVersion: 1,
      selected: target,
      lastKnownGood: target,
    });
  }

  async clearPending(): Promise<void> {
    const current = await this.read();
    await this.write({
      schemaVersion: 1,
      selected: current.selected,
      lastKnownGood: current.lastKnownGood,
    });
  }

  private async write(state: PersistedEnvironmentState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    try {
      await renameWithRetry(temporaryPath, this.statePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
