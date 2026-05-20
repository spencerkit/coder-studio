import type { CustomProviderConfig } from "@coder-studio/core";
import type { Database } from "../database.js";

interface CustomProviderRow {
  id: string;
  display_name: string;
  config: string;
  created_at: number;
  updated_at: number;
}

export class CustomProviderRepo {
  constructor(private readonly db: Database) {}

  list(): CustomProviderConfig[] {
    const rows = this.db
      .prepare(
        `SELECT id, display_name, config, created_at, updated_at
         FROM custom_providers
         ORDER BY updated_at DESC, id ASC`
      )
      .all() as unknown as CustomProviderRow[];

    return rows.map((row) => this.rowToConfig(row));
  }

  get(id: string): CustomProviderConfig | undefined {
    const row = this.db
      .prepare(
        `SELECT id, display_name, config, created_at, updated_at
         FROM custom_providers
         WHERE id = ?`
      )
      .get(id) as CustomProviderRow | undefined;

    return row ? this.rowToConfig(row) : undefined;
  }

  set(config: CustomProviderConfig): CustomProviderConfig {
    const existing = this.get(config.id);
    const createdAt = existing?.createdAt ?? config.createdAt;

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
        config.id,
        config.displayName,
        JSON.stringify({
          ...config,
          createdAt,
        }),
        createdAt,
        config.updatedAt
      );

    return this.get(config.id)!;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM custom_providers WHERE id = ?").run(id);
  }

  private rowToConfig(row: CustomProviderRow): CustomProviderConfig {
    const parsed = JSON.parse(row.config) as CustomProviderConfig;
    return {
      ...parsed,
      id: row.id,
      displayName: row.display_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
