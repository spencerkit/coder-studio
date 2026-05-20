import type { ProviderConfig } from "@coder-studio/core";
import type { Database } from "../database.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface ProviderConfigFileRecord {
  version: 1;
  providers: Record<string, ProviderConfig>;
}

export interface ProviderConfigRepoOptions {
  filePath: string;
}

function isDatabase(value: Database | ProviderConfigRepoOptions): value is Database {
  return typeof (value as Database).prepare === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeProviderConfigFile(value: unknown): Record<string, ProviderConfig> {
  if (isRecord(value) && value.version === 1 && isRecord(value.providers)) {
    return value.providers as Record<string, ProviderConfig>;
  }

  if (isRecord(value)) {
    return value as Record<string, ProviderConfig>;
  }

  return {};
}

/**
 * Provider configuration repository
 */
export class ProviderConfigRepo {
  private readonly db?: Database;
  private readonly filePath?: string;

  constructor(input: Database | ProviderConfigRepoOptions) {
    if (isDatabase(input)) {
      this.db = input;
      return;
    }

    this.filePath = input.filePath;
  }

  private readAllDbConfigs(db: Database | undefined = this.db): Record<string, ProviderConfig> {
    const rows = db?.prepare("SELECT provider_id, config FROM provider_configs").all() as
      | {
          provider_id: string;
          config: string;
        }[]
      | undefined;

    const result: Record<string, ProviderConfig> = {};
    for (const row of rows ?? []) {
      result[row.provider_id] = JSON.parse(row.config) as ProviderConfig;
    }

    return result;
  }

  private loadFileConfigs(): Record<string, ProviderConfig> {
    if (!this.filePath) {
      return {};
    }

    const parsed = readJsonFile<ProviderConfigFileRecord | Record<string, ProviderConfig>>(
      this.filePath
    );
    if (parsed !== undefined) {
      return { ...normalizeProviderConfigFile(parsed) };
    }

    return {};
  }

  private saveFileConfigs(configs: Record<string, ProviderConfig>): void {
    if (!this.filePath) {
      return;
    }

    const payload: ProviderConfigFileRecord = {
      version: 1,
      providers: configs,
    };
    writeJsonFileAtomic(this.filePath, payload);
  }

  /**
   * Gets a provider configuration by provider ID
   */
  get(providerId: string): ProviderConfig | undefined {
    if (this.db) {
      const row = this.db
        .prepare("SELECT config FROM provider_configs WHERE provider_id = ?")
        .get(providerId) as { config: string } | undefined;

      return row ? (JSON.parse(row.config) as ProviderConfig) : undefined;
    }

    return this.loadFileConfigs()[providerId];
  }

  /**
   * Sets a provider configuration
   * Creates the configuration if it doesn't exist, updates if it does
   */
  set(providerId: string, config: ProviderConfig): void {
    if (this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO provider_configs (provider_id, config)
        VALUES (?, ?)
        ON CONFLICT(provider_id) DO UPDATE SET config = excluded.config
      `);

      stmt.run(providerId, JSON.stringify(config));
      return;
    }

    const next = this.loadFileConfigs();
    next[providerId] = config;
    this.saveFileConfigs(next);
  }

  /**
   * Deletes a provider configuration by provider ID
   */
  delete(providerId: string): void {
    if (this.db) {
      const stmt = this.db.prepare("DELETE FROM provider_configs WHERE provider_id = ?");
      stmt.run(providerId);
      return;
    }

    const next = this.loadFileConfigs();
    if (!Object.prototype.hasOwnProperty.call(next, providerId)) {
      return;
    }
    delete next[providerId];
    this.saveFileConfigs(next);
  }

  /**
   * Lists all provider IDs that have configurations
   */
  listProviderIds(): string[] {
    if (this.db) {
      const rows = this.db.prepare("SELECT provider_id FROM provider_configs").all() as {
        provider_id: string;
      }[];
      return rows.map((row) => row.provider_id);
    }

    return Object.keys(this.loadFileConfigs());
  }

  /**
   * Gets all provider configurations as a key-value object
   */
  getAll(): Record<string, ProviderConfig> {
    if (this.db) {
      return this.readAllDbConfigs();
    }

    return { ...this.loadFileConfigs() };
  }
}
