import type { Database } from '../database.js';

/**
 * Settings repository for key-value storage
 * Stores JSON values for various settings
 */
export class SettingsRepo {
  constructor(private db: Database) {}

  /**
   * Gets a setting value by key
   * @returns The parsed JSON value, or undefined if not found
   */
  get<T = unknown>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM user_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;

    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  /**
   * Sets a setting value
   * Creates the setting if it doesn't exist, updates if it does
   */
  set<T>(key: string, value: T): void {
    const stmt = this.db.prepare(`
      INSERT INTO user_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    stmt.run(key, JSON.stringify(value));
  }

  /**
   * Deletes a setting by key
   */
  delete(key: string): void {
    const stmt = this.db.prepare('DELETE FROM user_settings WHERE key = ?');
    stmt.run(key);
  }

  /**
   * Lists all settings keys
   */
  listKeys(): string[] {
    const rows = this.db.prepare('SELECT key FROM user_settings').all() as { key: string }[];
    return rows.map(row => row.key);
  }

  /**
   * Gets all settings as a key-value object
   */
  getAll(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value FROM user_settings').all() as { key: string; value: string }[];

    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value);
    }

    return result;
  }
}
