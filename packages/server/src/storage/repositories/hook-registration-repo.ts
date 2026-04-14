import type Database from 'better-sqlite3';

/**
 * Database row representation for hook_registrations table
 */
export interface HookRegistrationRow {
  provider_id: string;
  marker_version: string;
  injected_at: number;
  global_config_path: string;
  last_check_at: number;
  last_status: 'ok' | 'error';
  last_error: string | null;
}

/**
 * Hook registration data
 */
export interface HookRegistration {
  providerId: string;
  markerVersion: string;
  injectedAt: number;
  globalConfigPath: string;
  lastCheckAt: number;
  lastStatus: 'ok' | 'error';
  lastError?: string;
}

/**
 * Input type for creating a new hook registration
 */
export interface NewHookRegistration {
  providerId: string;
  markerVersion: string;
  injectedAt: number;
  globalConfigPath: string;
  lastCheckAt: number;
  lastStatus: 'ok' | 'error';
  lastError?: string;
}

/**
 * Hook registration repository for tracking provider hook injection status
 */
export class HookRegistrationRepo {
  constructor(private db: Database.Database) {}

  /**
   * Gets a hook registration by provider ID
   */
  get(providerId: string): HookRegistration | undefined {
    const row = this.db.prepare('SELECT * FROM hook_registrations WHERE provider_id = ?').get(providerId) as
      | HookRegistrationRow
      | undefined;

    return row ? this.rowToHookRegistration(row) : undefined;
  }

  /**
   * Creates a new hook registration
   */
  create(registration: NewHookRegistration): HookRegistration {
    const stmt = this.db.prepare(`
      INSERT INTO hook_registrations (provider_id, marker_version, injected_at, global_config_path, last_check_at, last_status, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      registration.providerId,
      registration.markerVersion,
      registration.injectedAt,
      registration.globalConfigPath,
      registration.lastCheckAt,
      registration.lastStatus,
      registration.lastError ?? null
    );

    return this.get(registration.providerId)!;
  }

  /**
   * Updates the last check timestamp and status
   */
  updateCheckStatus(providerId: string, lastCheckAt: number, lastStatus: 'ok' | 'error', lastError?: string): void {
    const stmt = this.db.prepare(`
      UPDATE hook_registrations 
      SET last_check_at = ?, last_status = ?, last_error = ?
      WHERE provider_id = ?
    `);

    stmt.run(lastCheckAt, lastStatus, lastError ?? null, providerId);
  }

  /**
   * Updates the marker version and injection timestamp
   */
  updateInjection(providerId: string, markerVersion: string, injectedAt: number): void {
    const stmt = this.db.prepare(`
      UPDATE hook_registrations 
      SET marker_version = ?, injected_at = ?
      WHERE provider_id = ?
    `);

    stmt.run(markerVersion, injectedAt, providerId);
  }

  /**
   * Deletes a hook registration by provider ID
   */
  delete(providerId: string): void {
    const stmt = this.db.prepare('DELETE FROM hook_registrations WHERE provider_id = ?');
    stmt.run(providerId);
  }

  /**
   * Lists all hook registrations
   */
  listAll(): HookRegistration[] {
    const rows = this.db.prepare('SELECT * FROM hook_registrations').all() as HookRegistrationRow[];
    return rows.map(row => this.rowToHookRegistration(row));
  }

  /**
   * Converts a database row to a HookRegistration domain object
   */
  private rowToHookRegistration(row: HookRegistrationRow): HookRegistration {
    return {
      providerId: row.provider_id,
      markerVersion: row.marker_version,
      injectedAt: row.injected_at,
      globalConfigPath: row.global_config_path,
      lastCheckAt: row.last_check_at,
      lastStatus: row.last_status,
      lastError: row.last_error ?? undefined,
    };
  }
}
