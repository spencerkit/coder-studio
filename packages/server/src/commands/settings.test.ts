import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatch } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';
import { closeDatabase, openDatabase } from '../storage/db.js';
import type { Database } from 'better-sqlite3';
import './settings.js';

describe('settings commands', () => {
  let db: Database;
  let ctx: CommandContext;

  beforeEach(() => {
    db = openDatabase(':memory:');
    ctx = {
      workspaceMgr: {} as never,
      sessionMgr: {} as never,
      terminalMgr: {} as never,
      hooksMgr: {
        listRegistrations: () => [],
        auditExternalConfigs: () => ({ codex: { configPath: '/tmp/config.toml', exists: false, findings: [] } }),
        cleanupCodexConfig: () => ({ removed: [], backupPath: null, noop: true }),
      } as never,
      eventBus: {} as never,
      broadcaster: {} as never,
      db,
      providerRegistry: [],
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
    };
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('settings.update persists flattened settings into user_settings', async () => {
    const result = await dispatch(
      {
        kind: 'command',
        id: 'settings-update-1',
        op: 'settings.update',
        args: {
          settings: {
            defaultProviderId: 'codex',
            notifications: {
              enabled: true,
              onlyWhenBackgrounded: false,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(
      db.prepare('SELECT value FROM user_settings WHERE key = ?').get('defaultProviderId')
    ).toEqual({ value: '"codex"' });
    expect(
      db.prepare('SELECT value FROM user_settings WHERE key = ?').get('notifications.enabled')
    ).toEqual({ value: 'true' });
    expect(
      db.prepare('SELECT value FROM user_settings WHERE key = ?').get('notifications.onlyWhenBackgrounded')
    ).toEqual({ value: 'false' });
  });

  it('settings.get reads settings from user_settings and includes audit metadata', async () => {
    db.prepare('INSERT INTO user_settings (key, value) VALUES (?, ?)').run('defaultProviderId', '"codex"');
    db.prepare('INSERT INTO user_settings (key, value) VALUES (?, ?)').run('notifications.enabled', 'true');

    const result = await dispatch(
      {
        kind: 'command',
        id: 'settings-get-1',
        op: 'settings.get',
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      defaultProviderId: 'codex',
      'notifications.enabled': true,
      hookRegistrations: [],
      externalConfigAudit: {
        codex: {
          configPath: '/tmp/config.toml',
          exists: false,
          findings: [],
        },
      },
    });
  });
});
