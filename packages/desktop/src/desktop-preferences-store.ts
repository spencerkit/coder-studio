import { watch } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  createDefaultDesktopPreferences,
  DESKTOP_PREFERENCES_SCHEMA_VERSION,
  type DesktopPreferencesPatch,
  type DesktopPreferencesSnapshot,
} from "@coder-studio/core";
import { lock } from "proper-lockfile";
import { writeJsonFileAtomic } from "./atomic-json-file.js";

const DEFAULT_WATCH_DEBOUNCE_MS = 75;
const PREFERENCES_LOCK_STALE_MS = 10_000;

interface DirectoryWatcher {
  close(): void;
  on(event: "error", listener: (error: Error) => void): DirectoryWatcher;
}
type WatchDirectory = (
  path: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => DirectoryWatcher;

export interface DesktopPreferencesStoreOptions {
  filePath: string;
  lockFile?: typeof lock;
  now?: () => Date;
  onChanged?: (snapshot: DesktopPreferencesSnapshot) => void;
  onWarning?: (message: string) => void;
  watchDirectory?: WatchDirectory;
  watchDebounceMs?: number;
}

type DiskSnapshotResult =
  | { kind: "missing" }
  | { kind: "invalid"; message: string }
  | { kind: "valid"; snapshot: DesktopPreferencesSnapshot };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidThemeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/[\0\r\n]/.test(value)
  );
}

function parseSnapshot(value: unknown): DesktopPreferencesSnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== DESKTOP_PREFERENCES_SCHEMA_VERSION) return null;
  if (!Number.isInteger(value.revision) || (value.revision as number) < 0) return null;
  if (value.updatedAt !== null && typeof value.updatedAt !== "string") return null;
  if (!isRecord(value.appearance)) return null;
  const themeId = value.appearance.themeId;
  if (themeId !== null && !isValidThemeId(themeId)) return null;
  return {
    schemaVersion: DESKTOP_PREFERENCES_SCHEMA_VERSION,
    revision: value.revision as number,
    updatedAt: value.updatedAt as string | null,
    appearance: { themeId },
  };
}

function cloneSnapshot(snapshot: DesktopPreferencesSnapshot): DesktopPreferencesSnapshot {
  return {
    ...snapshot,
    appearance: { ...snapshot.appearance },
  };
}

function snapshotsEqual(
  left: DesktopPreferencesSnapshot,
  right: DesktopPreferencesSnapshot
): boolean {
  return (
    left.revision === right.revision &&
    left.updatedAt === right.updatedAt &&
    left.appearance.themeId === right.appearance.themeId
  );
}

export class DesktopPreferencesStore {
  private snapshot = createDefaultDesktopPreferences();
  private watcher: DirectoryWatcher | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private started = false;
  private closed = false;
  private lastWarning: string | null = null;

  constructor(private readonly options: DesktopPreferencesStoreOptions) {}

  async start(): Promise<DesktopPreferencesSnapshot> {
    if (this.started) return this.getSnapshot();
    if (this.closed) throw new Error("Desktop preferences store is closed");
    this.started = true;
    await mkdir(dirname(this.options.filePath), { recursive: true });
    const initial = await this.readDiskSnapshot();
    if (initial.kind === "valid") this.snapshot = initial.snapshot;
    if (initial.kind === "invalid") this.warnOnce(initial.message);

    const watchDirectory =
      this.options.watchDirectory ??
      ((path, listener) => watch(path, { persistent: false }, listener));
    this.watcher = watchDirectory(dirname(this.options.filePath), (_eventType, filename) => {
      if (filename !== null && basename(filename.toString()) !== basename(this.options.filePath)) {
        return;
      }
      this.scheduleReload();
    });
    this.watcher.on("error", (error) => {
      this.options.onWarning?.(
        `Desktop preferences watcher failed: ${error instanceof Error ? error.message : String(error)}`
      );
    });

    // Close the read-to-watch race: a sibling process may write after the first read but before
    // the directory watcher is attached.
    await this.refresh();
    return this.getSnapshot();
  }

  getSnapshot(): DesktopPreferencesSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  async initializeTheme(themeId: string): Promise<DesktopPreferencesSnapshot> {
    this.assertThemeId(themeId);
    return this.mutate((current) =>
      current.appearance.themeId === null
        ? {
            ...current,
            appearance: { ...current.appearance, themeId },
          }
        : current
    );
  }

  async update(patch: DesktopPreferencesPatch): Promise<DesktopPreferencesSnapshot> {
    const themeId = patch.appearance?.themeId;
    if (themeId === undefined) throw new Error("Desktop preferences patch has no supported values");
    this.assertThemeId(themeId);
    return this.mutate((current) => ({
      ...current,
      appearance: { ...current.appearance, themeId },
    }));
  }

  async refresh(): Promise<DesktopPreferencesSnapshot> {
    if (this.closed) return this.getSnapshot();
    const result = await this.readDiskSnapshot();
    if (result.kind === "invalid") {
      this.warnOnce(result.message);
      return this.getSnapshot();
    }
    if (result.kind === "missing") return this.getSnapshot();
    this.lastWarning = null;
    if (result.snapshot.revision > this.snapshot.revision) {
      this.accept(result.snapshot, true);
    }
    return this.getSnapshot();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    this.watcher?.close();
    this.watcher = null;
  }

  private async mutate(
    apply: (current: DesktopPreferencesSnapshot) => DesktopPreferencesSnapshot
  ): Promise<DesktopPreferencesSnapshot> {
    if (this.closed) throw new Error("Desktop preferences store is closed");
    await mkdir(dirname(this.options.filePath), { recursive: true });
    let compromisedError: Error | null = null;
    const release = await (this.options.lockFile ?? lock)(this.options.filePath, {
      realpath: false,
      stale: PREFERENCES_LOCK_STALE_MS,
      retries: {
        retries: 8,
        factor: 1.5,
        minTimeout: 10,
        maxTimeout: 100,
        randomize: true,
      },
      onCompromised: (error) => {
        compromisedError = error;
        this.options.onWarning?.(`Desktop preferences lock was compromised: ${error.message}`);
      },
    });
    try {
      this.assertLockHealthy(compromisedError);
      const disk = await this.readDiskSnapshot();
      this.assertLockHealthy(compromisedError);
      if (disk.kind === "invalid") throw new Error(disk.message);
      const current = disk.kind === "valid" ? disk.snapshot : createDefaultDesktopPreferences();
      const candidate = apply(current);
      if (snapshotsEqual(candidate, current)) {
        this.assertLockHealthy(compromisedError);
        this.accept(current, current.revision > this.snapshot.revision);
        return this.getSnapshot();
      }
      const next: DesktopPreferencesSnapshot = {
        ...candidate,
        schemaVersion: DESKTOP_PREFERENCES_SCHEMA_VERSION,
        revision: current.revision + 1,
        updatedAt: (this.options.now ?? (() => new Date()))().toISOString(),
        appearance: { ...candidate.appearance },
      };
      this.assertLockHealthy(compromisedError);
      await writeJsonFileAtomic(this.options.filePath, next);
      this.lastWarning = null;
      this.accept(next, true);
      return this.getSnapshot();
    } finally {
      await release().catch((error) => {
        this.options.onWarning?.(
          `Unable to release Desktop preferences lock: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }
  }

  private assertLockHealthy(error: Error | null): void {
    if (!error) return;
    throw new Error(`Desktop preferences lock was compromised: ${error.message}`);
  }

  private accept(snapshot: DesktopPreferencesSnapshot, notify: boolean): void {
    if (snapshotsEqual(snapshot, this.snapshot)) return;
    this.snapshot = cloneSnapshot(snapshot);
    if (!notify) return;
    try {
      this.options.onChanged?.(this.getSnapshot());
    } catch (error) {
      this.options.onWarning?.(
        `Desktop preferences listener failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private scheduleReload(): void {
    if (this.closed) return;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.refresh().catch((error) => {
        this.options.onWarning?.(
          `Unable to reload Desktop preferences: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }, this.options.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS);
    this.reloadTimer.unref?.();
  }

  private async readDiskSnapshot(): Promise<DiskSnapshotResult> {
    let serialized: string;
    try {
      serialized = await readFile(this.options.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch (error) {
      return {
        kind: "invalid",
        message: `Unable to parse desktop-preferences.json: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const snapshot = parseSnapshot(value);
    return snapshot
      ? { kind: "valid", snapshot }
      : { kind: "invalid", message: "desktop-preferences.json has an unsupported format" };
  }

  private assertThemeId(themeId: string): void {
    if (!isValidThemeId(themeId)) throw new Error("Invalid Desktop theme id");
  }

  private warnOnce(message: string): void {
    if (this.lastWarning === message) return;
    this.lastWarning = message;
    this.options.onWarning?.(message);
  }
}
