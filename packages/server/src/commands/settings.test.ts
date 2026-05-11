import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../storage/database.js";
import { closeDatabase, openDatabase } from "../storage/db.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "./settings.js";

describe("settings commands", () => {
  let db: Database;
  let ctx: CommandContext;

  beforeEach(() => {
    db = openDatabase(":memory:");
    ctx = {
      workspaceMgr: {} as never,
      sessionMgr: {} as never,
      terminalMgr: {} as never,
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

  it("settings.update persists flattened settings into user_settings", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-1",
        op: "settings.update",
        args: {
          settings: {
            defaultProviderId: "codex",
            notifications: {
              enabled: true,
              soundEnabled: false,
            },
            supervisor: {
              evaluationTimeoutSec: 600,
              retryEnabled: true,
              retryMaxCount: 3,
              retryDelaySec: 10,
              retryOnTimeout: true,
              retryOnEvaluatorError: false,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(
      db.prepare("SELECT value FROM user_settings WHERE key = ?").get("defaultProviderId")
    ).toEqual({ value: '"codex"' });
    expect(
      db.prepare("SELECT value FROM user_settings WHERE key = ?").get("notifications.enabled")
    ).toEqual({ value: "true" });
    expect(
      db.prepare("SELECT value FROM user_settings WHERE key = ?").get("notifications.soundEnabled")
    ).toEqual({ value: "false" });
    expect(
      db
        .prepare("SELECT value FROM user_settings WHERE key = ?")
        .get("supervisor.evaluationTimeoutSec")
    ).toEqual({ value: "600" });
    expect(
      db.prepare("SELECT value FROM user_settings WHERE key = ?").get("supervisor.retryEnabled")
    ).toEqual({ value: "true" });
    expect(
      db.prepare("SELECT value FROM user_settings WHERE key = ?").get("supervisor.retryMaxCount")
    ).toEqual({ value: "3" });
    expect(
      db.prepare("SELECT value FROM user_settings WHERE key = ?").get("supervisor.retryDelaySec")
    ).toEqual({ value: "10" });
    expect(
      db.prepare("SELECT value FROM user_settings WHERE key = ?").get("supervisor.retryOnTimeout")
    ).toEqual({ value: "true" });
    expect(
      db
        .prepare("SELECT value FROM user_settings WHERE key = ?")
        .get("supervisor.retryOnEvaluatorError")
    ).toEqual({ value: "false" });
  });

  it("settings.update persists appearance.terminalCopyOnSelect into user_settings", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-terminal-copy-on-select",
        op: "settings.update",
        args: {
          settings: {
            appearance: {
              terminalCopyOnSelect: true,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(
      db
        .prepare("SELECT value FROM user_settings WHERE key = ?")
        .get("appearance.terminalCopyOnSelect")
    ).toEqual({ value: "true" });
  });

  it("settings.update persists appearance.themeId into user_settings", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-theme-id",
        op: "settings.update",
        args: {
          settings: {
            appearance: {
              themeId: "graphite-light",
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(
      db.prepare("SELECT value FROM user_settings WHERE key = ?").get("appearance.themeId")
    ).toEqual({ value: '"graphite-light"' });
  });

  it("settings.update rejects fractional supervisor timeout values", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-supervisor-timeout-fractional",
        op: "settings.update",
        args: {
          settings: {
            supervisor: {
              evaluationTimeoutSec: 1.9,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
    expect(
      db
        .prepare("SELECT value FROM user_settings WHERE key = ?")
        .get("supervisor.evaluationTimeoutSec")
    ).toBeUndefined();
  });

  it("settings.update rejects supervisor timeout values above the supported maximum", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-supervisor-timeout-too-large",
        op: "settings.update",
        args: {
          settings: {
            supervisor: {
              evaluationTimeoutSec: 86_401,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
    expect(
      db
        .prepare("SELECT value FROM user_settings WHERE key = ?")
        .get("supervisor.evaluationTimeoutSec")
    ).toBeUndefined();
  });

  it("settings.update rejects retryDelaySec values below the supported minimum", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-supervisor-retry-delay-too-small",
        op: "settings.update",
        args: {
          settings: {
            supervisor: {
              retryDelaySec: 0,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
    expect(
      db.prepare("SELECT value FROM user_settings WHERE key = ?").get("supervisor.retryDelaySec")
    ).toBeUndefined();
  });

  it("settings.update persists provider startup command arguments per provider config", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-provider-args",
        op: "settings.update",
        args: {
          settings: {
            providers: {
              claude: {
                additionalArgs: ["--verbose", "--debug"],
              },
              codex: {
                additionalArgs: ["-c", 'model_reasoning_effort="low"'],
              },
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(
      db.prepare("SELECT config FROM provider_configs WHERE provider_id = ?").get("claude")
    ).toEqual({ config: '{"additionalArgs":["--verbose","--debug"]}' });
    expect(
      db.prepare("SELECT config FROM provider_configs WHERE provider_id = ?").get("codex")
    ).toEqual({ config: '{"additionalArgs":["-c","model_reasoning_effort=\\"low\\""]}' });
  });

  it("settings.update replaces legacy provider fields with startup args only", async () => {
    db.prepare("INSERT INTO provider_configs (provider_id, config) VALUES (?, ?)").run(
      "codex",
      '{"additionalArgs":["--old"],"cwd":"/tmp/legacy"}'
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-provider-args-replace",
        op: "settings.update",
        args: {
          settings: {
            providers: {
              codex: {
                additionalArgs: ["--sandbox", "--full-auto"],
              },
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(
      db.prepare("SELECT config FROM provider_configs WHERE provider_id = ?").get("codex")
    ).toEqual({ config: '{"additionalArgs":["--sandbox","--full-auto"]}' });
  });

  it("settings.get exposes provider startup arguments per provider", async () => {
    db.prepare("INSERT INTO provider_configs (provider_id, config) VALUES (?, ?)").run(
      "claude",
      '{"additionalArgs":["--verbose"]}'
    );
    db.prepare("INSERT INTO provider_configs (provider_id, config) VALUES (?, ?)").run(
      "codex",
      '{"additionalArgs":["--sandbox","--full-auto"]}'
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "settings-get-provider-args",
        op: "settings.get",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      "providers.claude.additionalArgs": ["--verbose"],
      "providers.codex.additionalArgs": ["--sandbox", "--full-auto"],
    });
  });

  it("settings.get ignores legacy provider keys and sanitizes stored configs", async () => {
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "providers.codex.additionalArgs",
      '["--legacy-user-setting"]'
    );
    db.prepare("INSERT INTO provider_configs (provider_id, config) VALUES (?, ?)").run(
      "claude",
      '{"additionalArgs":["--verbose"],"model":"claude-opus-4-6"}'
    );
    db.prepare("INSERT INTO provider_configs (provider_id, config) VALUES (?, ?)").run(
      "openai",
      '{"additionalArgs":["--ignore-me"]}'
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "settings-get-provider-sanitized",
        op: "settings.get",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data?.["providers.claude.additionalArgs"]).toEqual(["--verbose"]);
    expect(result.data?.["providers.claude.model"]).toBeUndefined();
    expect(result.data?.["providers.codex.additionalArgs"]).toBeUndefined();
    expect(result.data?.["providers.openai.additionalArgs"]).toBeUndefined();
  });

  it("settings.get reads settings from user_settings", async () => {
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "defaultProviderId",
      '"codex"'
    );
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "notifications.enabled",
      "true"
    );
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "supervisor.evaluationTimeoutSec",
      "900"
    );
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "supervisor.retryEnabled",
      "true"
    );
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "supervisor.retryMaxCount",
      "4"
    );
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "supervisor.retryDelaySec",
      "15"
    );
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "supervisor.retryOnTimeout",
      "false"
    );
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "supervisor.retryOnEvaluatorError",
      "true"
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "settings-get-1",
        op: "settings.get",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      defaultProviderId: "codex",
      "notifications.enabled": true,
      "supervisor.evaluationTimeoutSec": 900,
      "supervisor.retryEnabled": true,
      "supervisor.retryMaxCount": 4,
      "supervisor.retryDelaySec": 15,
      "supervisor.retryOnTimeout": false,
      "supervisor.retryOnEvaluatorError": true,
    });
  });

  it("settings.get reads appearance.terminalCopyOnSelect from user_settings", async () => {
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "appearance.terminalCopyOnSelect",
      "true"
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "settings-get-terminal-copy-on-select",
        op: "settings.get",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data?.["appearance.terminalCopyOnSelect"]).toBe(true);
  });

  it("settings.get returns appearance.themeId from user_settings", async () => {
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "appearance.themeId",
      '"nord-dark"'
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "settings-get-theme-id",
        op: "settings.get",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      "appearance.themeId": "nord-dark",
    });
  });

  it("settings.get normalizes invalid persisted supervisor timeout values", async () => {
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "supervisor.evaluationTimeoutSec",
      "999999"
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "settings-get-supervisor-timeout-invalid",
        op: "settings.get",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data?.["supervisor.evaluationTimeoutSec"]).toBe(600);
  });

  it("settings.get falls back when the persisted supervisor timeout is fractional", async () => {
    db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
      "supervisor.evaluationTimeoutSec",
      "1.9"
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "settings-get-supervisor-timeout-fractional",
        op: "settings.get",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data?.["supervisor.evaluationTimeoutSec"]).toBe(600);
  });
});
