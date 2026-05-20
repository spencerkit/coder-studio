import type { Database } from "../database.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface SettingsFileRecord {
  version: 1;
  settings: Record<string, unknown>;
}

export interface SettingsRepoOptions {
  filePath: string;
  legacyDb?: Database;
}

function isDatabase(value: Database | SettingsRepoOptions): value is Database {
  return typeof (value as Database).prepare === "function";
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
  private readonly db?: Database;
  private readonly filePath?: string;
  private readonly legacyDb?: Database;

  constructor(input: Database | SettingsRepoOptions) {
    if (isDatabase(input)) {
      this.db = input;
      return;
    }

    this.filePath = input.filePath;
    this.legacyDb = input.legacyDb;
  }

  private readDbValue<T = unknown>(key: string): T | undefined {
    const row = this.db?.prepare("SELECT value FROM user_settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;

    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  private writeDbValue<T>(key: string, value: T): void {
    const stmt = this.db?.prepare(`
      INSERT INTO user_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    stmt?.run(key, JSON.stringify(value));
  }

  private deleteDbValue(key: string): void {
    this.db?.prepare("DELETE FROM user_settings WHERE key = ?").run(key);
  }

  private listDbKeys(): string[] {
    const rows = this.db?.prepare("SELECT key FROM user_settings").all() as { key: string }[];
    return rows.map((row) => row.key);
  }

  private readAllDbValues(): Record<string, unknown> {
    const rows = this.db?.prepare("SELECT key, value FROM user_settings").all() as {
      key: string;
      value: string;
    }[];

    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value);
    }

    return result;
  }

  private loadFileSettings(): Record<string, unknown> {
    if (!this.filePath) {
      return {};
    }

    const parsed = readJsonFile<SettingsFileRecord | Record<string, unknown>>(this.filePath);
    if (parsed !== undefined) {
      return normalizeSettingsFile(parsed);
    }

    if (!this.legacyDb) {
      return {};
    }

    const migrated = this.readAllLegacyDbValues();
    if (Object.keys(migrated).length > 0) {
      this.saveFileSettings(migrated);
    }
    return migrated;
  }

  private saveFileSettings(settings: Record<string, unknown>): void {
    if (!this.filePath) {
      return;
    }

    const payload: SettingsFileRecord = {
      version: 1,
      settings,
    };
    writeJsonFileAtomic(this.filePath, payload);
  }

  private readAllLegacyDbValues(): Record<string, unknown> {
    const rows = this.legacyDb?.prepare("SELECT key, value FROM user_settings").all() as
      | {
          key: string;
          value: string;
        }[]
      | undefined;

    const result: Record<string, unknown> = {};
    for (const row of rows ?? []) {
      result[row.key] = JSON.parse(row.value);
    }

    return result;
  }

  /**
   * Gets a setting value by key
   * @returns The parsed JSON value, or undefined if not found
   */
  get<T = unknown>(key: string): T | undefined {
    if (this.db) {
      return this.readDbValue<T>(key);
    }

    return this.loadFileSettings()[key] as T | undefined;
  }

  /**
   * Sets a setting value
   * Creates the setting if it doesn't exist, updates if it does
   */
  set<T>(key: string, value: T): void {
    if (this.db) {
      this.writeDbValue(key, value);
      return;
    }

    const next = this.loadFileSettings();
    next[key] = value;
    this.saveFileSettings(next);
  }

  /**
   * Deletes a setting by key
   */
  delete(key: string): void {
    if (this.db) {
      this.deleteDbValue(key);
      return;
    }

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
    if (this.db) {
      return this.listDbKeys();
    }

    return Object.keys(this.loadFileSettings());
  }

  /**
   * Gets all settings as a key-value object
   */
  getAll(): Record<string, unknown> {
    if (this.db) {
      return this.readAllDbValues();
    }

    return { ...this.loadFileSettings() };
  }
}
