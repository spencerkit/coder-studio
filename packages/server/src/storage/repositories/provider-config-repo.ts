import type { ProviderConfig } from "@coder-studio/core";
import type { Database } from "../database.js";

/**
 * Provider configuration repository
 */
export class ProviderConfigRepo {
  constructor(private db: Database) {}

  /**
   * Gets a provider configuration by provider ID
   */
  get(providerId: string): ProviderConfig | undefined {
    const row = this.db
      .prepare("SELECT config FROM provider_configs WHERE provider_id = ?")
      .get(providerId) as { config: string } | undefined;

    return row ? (JSON.parse(row.config) as ProviderConfig) : undefined;
  }

  /**
   * Sets a provider configuration
   * Creates the configuration if it doesn't exist, updates if it does
   */
  set(providerId: string, config: ProviderConfig): void {
    const stmt = this.db.prepare(`
      INSERT INTO provider_configs (provider_id, config)
      VALUES (?, ?)
      ON CONFLICT(provider_id) DO UPDATE SET config = excluded.config
    `);

    stmt.run(providerId, JSON.stringify(config));
  }

  /**
   * Deletes a provider configuration by provider ID
   */
  delete(providerId: string): void {
    const stmt = this.db.prepare("DELETE FROM provider_configs WHERE provider_id = ?");
    stmt.run(providerId);
  }

  /**
   * Lists all provider IDs that have configurations
   */
  listProviderIds(): string[] {
    const rows = this.db.prepare("SELECT provider_id FROM provider_configs").all() as {
      provider_id: string;
    }[];
    return rows.map((row) => row.provider_id);
  }

  /**
   * Gets all provider configurations as a key-value object
   */
  getAll(): Record<string, ProviderConfig> {
    const rows = this.db.prepare("SELECT provider_id, config FROM provider_configs").all() as {
      provider_id: string;
      config: string;
    }[];

    const result: Record<string, ProviderConfig> = {};
    for (const row of rows) {
      result[row.provider_id] = JSON.parse(row.config) as ProviderConfig;
    }

    return result;
  }
}
