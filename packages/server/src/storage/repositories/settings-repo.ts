import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface SettingsFileRecord {
  version: 1;
  settings: Record<string, unknown>;
}

export interface SettingsRepoOptions {
  filePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSettingsFile(value: unknown): Record<string, unknown> {
  if (isRecord(value) && value.version === 1 && isRecord(value.settings)) {
    return { ...value.settings };
  }

  if (isRecord(value)) {
    return { ...value };
  }

  return {};
}

/**
 * Settings repository for key-value storage
 * Stores JSON values for various settings
 *
 * Known keys:
 * - `git.autofetchPeriodSec`: polling interval for active-workspace background fetch.
 *   Defaults to 180 seconds; `0` disables periodic polling while preserving
 *   open-time fetch and manual fetch.
 */
export class SettingsRepo {
  private readonly filePath: string;

  constructor(input: SettingsRepoOptions) {
    this.filePath = input.filePath;
  }

  private loadFileSettings(): Record<string, unknown> {
    const parsed = readJsonFile<SettingsFileRecord | Record<string, unknown>>(this.filePath);
    if (parsed !== undefined) {
      return normalizeSettingsFile(parsed);
    }

    return {};
  }

  private saveFileSettings(settings: Record<string, unknown>): void {
    const payload: SettingsFileRecord = {
      version: 1,
      settings,
    };
    writeJsonFileAtomic(this.filePath, payload);
  }

  /**
   * Gets a setting value by key
   * @returns The parsed JSON value, or undefined if not found
   */
  get<T = unknown>(key: string): T | undefined {
    return this.loadFileSettings()[key] as T | undefined;
  }

  /**
   * Sets a setting value
   * Creates the setting if it doesn't exist, updates if it does
   */
  set<T>(key: string, value: T): void {
    const next = this.loadFileSettings();
    next[key] = value;
    this.saveFileSettings(next);
  }

  /**
   * Deletes a setting by key
   */
  delete(key: string): void {
    const next = this.loadFileSettings();
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      return;
    }
    delete next[key];
    this.saveFileSettings(next);
  }

  /**
   * Lists all settings keys
   */
  listKeys(): string[] {
    return Object.keys(this.loadFileSettings());
  }

  /**
   * Gets all settings as a key-value object
   */
  getAll(): Record<string, unknown> {
    return { ...this.loadFileSettings() };
  }
}
