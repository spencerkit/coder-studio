import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { SettingsRepo } from "../storage/repositories/settings-repo.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "./settings.js";

describe("settings commands", () => {
  let ctx: CommandContext;
  let tempDir: string;
  let settingsRepo: SettingsRepo;
  let providerConfigRepo: ProviderConfigRepo;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "settings-command-test-"));
    settingsRepo = new SettingsRepo({ filePath: join(tempDir, "settings.json") });
    providerConfigRepo = new ProviderConfigRepo({
      filePath: join(tempDir, "provider-configs.json"),
    });
    ctx = {
      workspaceMgr: {} as never,
      sessionMgr: {} as never,
      terminalMgr: {} as never,
      eventBus: {} as never,
      broadcaster: {} as never,
      settingsRepo,
      providerConfigRepo,
      providerRegistry: [],
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      autoFetch: {} as never,
      activationMgr: {} as never,
      lspMgr: {} as never,
    };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("settings.update persists flattened settings into the file-backed settings store", async () => {
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
    expect(settingsRepo.get("defaultProviderId")).toBe("codex");
    expect(settingsRepo.get("notifications.enabled")).toBe(true);
    expect(settingsRepo.get("notifications.soundEnabled")).toBe(false);
    expect(settingsRepo.get("supervisor.evaluationTimeoutSec")).toBe(600);
    expect(settingsRepo.get("supervisor.retryEnabled")).toBe(true);
    expect(settingsRepo.get("supervisor.retryMaxCount")).toBe(3);
    expect(settingsRepo.get("supervisor.retryDelaySec")).toBe(10);
    expect(settingsRepo.get("supervisor.retryOnTimeout")).toBe(true);
    expect(settingsRepo.get("supervisor.retryOnEvaluatorError")).toBe(false);
  });

  it("settings.update persists appearance.terminalCopyOnSelect into the file-backed settings store", async () => {
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
    expect(settingsRepo.get("appearance.terminalCopyOnSelect")).toBe(true);
  });

  it("settings.update persists appearance.themeId into the file-backed settings store", async () => {
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
    expect(settingsRepo.get("appearance.themeId")).toBe("graphite-light");
  });

  it("settings.update persists appearance.desktopTerminalFontSize into the file-backed settings store", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-desktop-terminal-font-size",
        op: "settings.update",
        args: {
          settings: {
            appearance: {
              desktopTerminalFontSize: 16,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(settingsRepo.get("appearance.desktopTerminalFontSize")).toBe(16);
  });

  it("settings.update persists appearance.mobileTerminalFontSize into the file-backed settings store", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-mobile-terminal-font-size",
        op: "settings.update",
        args: {
          settings: {
            appearance: {
              mobileTerminalFontSize: 15,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(settingsRepo.get("appearance.mobileTerminalFontSize")).toBe(15);
  });

  it("settings.update persists legacy appearance.theme light during themeId migration", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-legacy-theme-light",
        op: "settings.update",
        args: {
          settings: {
            appearance: {
              theme: "light",
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(settingsRepo.get("appearance.theme")).toBe("light");
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
    expect(settingsRepo.get("supervisor.evaluationTimeoutSec")).toBeUndefined();
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
    expect(settingsRepo.get("supervisor.evaluationTimeoutSec")).toBeUndefined();
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
    expect(settingsRepo.get("supervisor.retryDelaySec")).toBeUndefined();
  });

  it("settings.update rejects desktopTerminalFontSize values below the supported minimum", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-desktop-terminal-font-size-too-small",
        op: "settings.update",
        args: {
          settings: {
            appearance: {
              desktopTerminalFontSize: 9,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
    expect(settingsRepo.get("appearance.desktopTerminalFontSize")).toBeUndefined();
  });

  it("settings.update rejects mobileTerminalFontSize values above the supported maximum", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-mobile-terminal-font-size-too-large",
        op: "settings.update",
        args: {
          settings: {
            appearance: {
              mobileTerminalFontSize: 19,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
    expect(settingsRepo.get("appearance.mobileTerminalFontSize")).toBeUndefined();
  });

  it("settings.update rejects fractional desktopTerminalFontSize values", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-desktop-terminal-font-size-fractional",
        op: "settings.update",
        args: {
          settings: {
            appearance: {
              desktopTerminalFontSize: 15.5,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
    expect(settingsRepo.get("appearance.desktopTerminalFontSize")).toBeUndefined();
  });

  it("settings.update persists provider startup command arguments into the file-backed provider config store", async () => {
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
    expect(providerConfigRepo.get("claude")).toEqual({
      additionalArgs: ["--verbose", "--debug"],
    });
    expect(providerConfigRepo.get("codex")).toEqual({
      additionalArgs: ["-c", 'model_reasoning_effort="low"'],
    });
  });

  it("settings.update replaces legacy provider fields with startup args only", async () => {
    providerConfigRepo.set("codex", {
      additionalArgs: ["--old"],
      cwd: "/tmp/legacy",
    });

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
    expect(providerConfigRepo.get("codex")).toEqual({
      additionalArgs: ["--sandbox", "--full-auto"],
    });
  });

  it("settings.get exposes provider startup arguments per provider", async () => {
    providerConfigRepo.set("claude", { additionalArgs: ["--verbose"] });
    providerConfigRepo.set("codex", {
      additionalArgs: ["--sandbox", "--full-auto"],
    });

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
    settingsRepo.set("providers.codex.additionalArgs", ["--legacy-user-setting"]);
    providerConfigRepo.set("claude", {
      additionalArgs: ["--verbose"],
      model: "claude-opus-4-6",
    });
    providerConfigRepo.set("openai", {
      additionalArgs: ["--ignore-me"],
    });

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

  it("settings.get reads settings from the file-backed settings store", async () => {
    settingsRepo.set("defaultProviderId", "codex");
    settingsRepo.set("notifications.enabled", true);
    settingsRepo.set("supervisor.evaluationTimeoutSec", 900);
    settingsRepo.set("supervisor.retryEnabled", true);
    settingsRepo.set("supervisor.retryMaxCount", 4);
    settingsRepo.set("supervisor.retryDelaySec", 15);
    settingsRepo.set("supervisor.retryOnTimeout", false);
    settingsRepo.set("supervisor.retryOnEvaluatorError", true);

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

  it("settings.get reads appearance.terminalCopyOnSelect from the file-backed settings store", async () => {
    settingsRepo.set("appearance.terminalCopyOnSelect", true);

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

  it("settings.get returns appearance.themeId from the file-backed settings store", async () => {
    settingsRepo.set("appearance.themeId", "nord-dark");

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

  it("settings.get returns split terminal font size settings from the file-backed settings store", async () => {
    settingsRepo.set("appearance.desktopTerminalFontSize", 16);
    settingsRepo.set("appearance.mobileTerminalFontSize", 14);

    const result = await dispatch(
      {
        kind: "command",
        id: "settings-get-split-terminal-font-size",
        op: "settings.get",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      "appearance.desktopTerminalFontSize": 16,
      "appearance.mobileTerminalFontSize": 14,
    });
  });

  it("settings.get normalizes invalid persisted supervisor timeout values", async () => {
    settingsRepo.set("supervisor.evaluationTimeoutSec", 999999);

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
    settingsRepo.set("supervisor.evaluationTimeoutSec", 1.9);

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
