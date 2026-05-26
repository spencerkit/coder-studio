import type { CustomProviderConfig } from "@coder-studio/core";
import type { Database } from "../database.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface CustomProviderRow {
  id: string;
  display_name: string;
  config: string;
  created_at: number;
  updated_at: number;
}

interface CustomProviderFileRecord {
  version: 1;
  providers: Record<string, CustomProviderConfig>;
}

export interface CustomProviderRepoOptions {
  filePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeConfig(config: CustomProviderConfig): CustomProviderConfig {
  return {
    ...config,
    args: [...config.args],
    env: { ...config.env },
    capabilities: config.capabilities.map((capability) => ({ ...capability })),
  };
}

function normalizeFileConfigs(value: unknown): Record<string, CustomProviderConfig> {
  if (isRecord(value) && value.version === 1 && isRecord(value.providers)) {
    return Object.fromEntries(
      Object.entries(value.providers).map(([id, config]) => [
        id,
        normalizeConfig(config as CustomProviderConfig),
      ])
    );
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([id, config]) => [
        id,
        normalizeConfig(config as CustomProviderConfig),
      ])
    );
  }

  return {};
}

function isDatabaseInput(input: Database | CustomProviderRepoOptions): input is Database {
  return typeof input === "object" && input !== null && "prepare" in input;
}

export class CustomProviderRepo {
  private readonly db?: Database;
  private readonly filePath?: string;

  constructor(input: Database | CustomProviderRepoOptions) {
    if (isDatabaseInput(input)) {
      this.db = input;
      return;
    }

    this.filePath = input.filePath;
  }

  list(): CustomProviderConfig[] {
    if (this.db) {
      const rows = this.db
        .prepare(
          `SELECT id, display_name, config, created_at, updated_at
           FROM custom_providers
           ORDER BY updated_at DESC, id ASC`
        )
        .all() as unknown as CustomProviderRow[];

      return rows.map((row) => this.rowToConfig(row));
    }

    return Object.values(this.loadFileConfigs()).sort(
      (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
    );
  }

  get(id: string): CustomProviderConfig | undefined {
    if (this.db) {
      const row = this.db
        .prepare(
          `SELECT id, display_name, config, created_at, updated_at
           FROM custom_providers
           WHERE id = ?`
        )
        .get(id) as CustomProviderRow | undefined;

      return row ? this.rowToConfig(row) : undefined;
    }

    return this.loadFileConfigs()[id];
  }

  set(config: CustomProviderConfig): CustomProviderConfig {
    const existing = this.get(config.id);
    const createdAt = existing?.createdAt ?? config.createdAt;
    const normalized = normalizeConfig({
      ...config,
      createdAt,
    });

    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO custom_providers (id, display_name, config, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             display_name = excluded.display_name,
             config = excluded.config,
             updated_at = excluded.updated_at`
        )
        .run(
          normalized.id,
          normalized.displayName,
          JSON.stringify(normalized),
          normalized.createdAt,
          normalized.updatedAt
        );

      return this.get(normalized.id)!;
    }

    const next = this.loadFileConfigs();
    next[normalized.id] = normalized;
    this.saveFileConfigs(next);
    return next[normalized.id]!;
  }

  delete(id: string): void {
    if (this.db) {
      this.db.prepare("DELETE FROM custom_providers WHERE id = ?").run(id);
      return;
    }

    const next = this.loadFileConfigs();
    if (!Object.prototype.hasOwnProperty.call(next, id)) {
      return;
    }
    delete next[id];
    this.saveFileConfigs(next);
  }

  private loadFileConfigs(): Record<string, CustomProviderConfig> {
    const parsed = readJsonFile<CustomProviderFileRecord | Record<string, CustomProviderConfig>>(
      this.filePath!
    );
    if (parsed !== undefined) {
      return normalizeFileConfigs(parsed);
    }

    return {};
  }

  private saveFileConfigs(configs: Record<string, CustomProviderConfig>): void {
    const payload: CustomProviderFileRecord = {
      version: 1,
      providers: configs,
    };
    writeJsonFileAtomic(this.filePath!, payload);
  }

  private rowToConfig(row: CustomProviderRow): CustomProviderConfig {
    const parsed = JSON.parse(row.config) as CustomProviderConfig;
    return normalizeConfig({
      ...parsed,
      id: row.id,
      displayName: row.display_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}
