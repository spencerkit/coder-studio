import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatch } from '../ws/dispatch.js';
import type { CommandContext } from '../ws/dispatch.js';
import { closeDatabase, openDatabase } from '../storage/db.js';
import type { Database } from '../storage/database.js';
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
              soundEnabled: false,
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
      db.prepare('SELECT value FROM user_settings WHERE key = ?').get('notifications.soundEnabled')
    ).toEqual({ value: 'false' });
  });

  it('settings.update persists provider startup command arguments per provider config', async () => {
    const result = await dispatch(
      {
        kind: 'command',
        id: 'settings-update-provider-args',
        op: 'settings.update',
        args: {
          settings: {
            providers: {
              claude: {
                additionalArgs: ['--verbose', '--debug'],
              },
              codex: {
                additionalArgs: ['-c', 'model_reasoning_effort="low"'],
              },
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(
      db.prepare('SELECT config FROM provider_configs WHERE provider_id = ?').get('claude')
    ).toEqual({ config: '{"additionalArgs":["--verbose","--debug"]}' });
    expect(
      db.prepare('SELECT config FROM provider_configs WHERE provider_id = ?').get('codex')
    ).toEqual({ config: '{"additionalArgs":["-c","model_reasoning_effort=\\"low\\""]}' });
  });

  it('settings.update replaces legacy provider fields with startup args only', async () => {
    db.prepare('INSERT INTO provider_configs (provider_id, config) VALUES (?, ?)').run(
      'codex',
      '{"additionalArgs":["--old"],"cwd":"/tmp/legacy"}'
    );

    const result = await dispatch(
      {
        kind: 'command',
        id: 'settings-update-provider-args-replace',
        op: 'settings.update',
        args: {
          settings: {
            providers: {
              codex: {
                additionalArgs: ['--sandbox', '--full-auto'],
              },
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(
      db.prepare('SELECT config FROM provider_configs WHERE provider_id = ?').get('codex')
    ).toEqual({ config: '{"additionalArgs":["--sandbox","--full-auto"]}' });
  });

  it('settings.get exposes provider startup arguments per provider', async () => {
    db.prepare('INSERT INTO provider_configs (provider_id, config) VALUES (?, ?)').run(
      'claude',
      '{"additionalArgs":["--verbose"]}'
    );
    db.prepare('INSERT INTO provider_configs (provider_id, config) VALUES (?, ?)').run(
      'codex',
      '{"additionalArgs":["--sandbox","--full-auto"]}'
    );

    const result = await dispatch(
      {
        kind: 'command',
        id: 'settings-get-provider-args',
        op: 'settings.get',
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      'providers.claude.additionalArgs': ['--verbose'],
      'providers.codex.additionalArgs': ['--sandbox', '--full-auto'],
    });
  });

  it('settings.get ignores legacy provider keys and sanitizes stored configs', async () => {
    db.prepare('INSERT INTO user_settings (key, value) VALUES (?, ?)').run(
      'providers.codex.additionalArgs',
      '["--legacy-user-setting"]'
    );
    db.prepare('INSERT INTO provider_configs (provider_id, config) VALUES (?, ?)').run(
      'claude',
      '{"additionalArgs":["--verbose"],"model":"claude-opus-4-6"}'
    );
    db.prepare('INSERT INTO provider_configs (provider_id, config) VALUES (?, ?)').run(
      'openai',
      '{"additionalArgs":["--ignore-me"]}'
    );

    const result = await dispatch(
      {
        kind: 'command',
        id: 'settings-get-provider-sanitized',
        op: 'settings.get',
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data?.['providers.claude.additionalArgs']).toEqual(['--verbose']);
    expect(result.data?.['providers.claude.model']).toBeUndefined();
    expect(result.data?.['providers.codex.additionalArgs']).toBeUndefined();
    expect(result.data?.['providers.openai.additionalArgs']).toBeUndefined();
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
