import test from "node:test";
import assert from "node:assert/strict";
import {
  applyGeneralSettingsPatch,
  applyAgentDefaultsPatch,
  applyProviderGlobalPatch,
  cloneAppSettings,
  defaultAppSettings,
  normalizeAppSettings,
  toAppSettingsPayload,
} from "../apps/web/src/shared/app/provider-settings";
import { resolveAgentRuntimeCommand } from "../apps/web/src/shared/app/claude-settings";

test("normalizeAppSettings migrates legacy top-level provider globals into providers map", () => {
  const settings = normalizeAppSettings({
    claude: {
      global: {
        executable: "claude-nightly",
        startupArgs: ["--verbose"],
        env: {},
        settingsJson: { model: "sonnet" },
        globalConfigJson: {},
      },
    },
    codex: {
      global: {
        executable: "codex-nightly",
        extraArgs: ["--full-auto"],
        model: "gpt-5.4",
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
        webSearch: "live",
        modelReasoningEffort: "high",
        env: {},
      },
    },
  });

  assert.equal(settings.providers.claude.global.executable, "claude-nightly");
  assert.deepEqual(settings.providers.claude.global.startupArgs, ["--verbose"]);
  assert.equal(settings.providers.codex.global.executable, "codex-nightly");
  assert.deepEqual(settings.providers.codex.global.extraArgs, ["--full-auto"]);
  assert.equal(settings.claude.global.executable, "claude-nightly");
  assert.equal(settings.codex.global.executable, "codex-nightly");
});

test("applyProviderGlobalPatch updates one provider without mutating other provider settings", () => {
  const settings = defaultAppSettings();
  const withExecutable = applyProviderGlobalPatch(settings, "claude", ["executable"], "claude-nightly");
  const next = applyProviderGlobalPatch(withExecutable, "claude", ["startupArgs"], ["--verbose"]);

  assert.equal(next.providers.claude.global.executable, "claude-nightly");
  assert.deepEqual(next.providers.claude.global.startupArgs, ["--verbose"]);
  assert.equal(next.providers.codex.global.executable, settings.providers.codex.global.executable);
  assert.deepEqual(next.providers.codex.global, settings.providers.codex.global);
});

test("applyProviderGlobalPatch supports path-based nested updates without touching sibling providers", () => {
  const settings = defaultAppSettings();
  assert.deepEqual(Object.keys(settings.providers).sort(), ["claude", "codex"]);

  const next = applyProviderGlobalPatch(settings, "custom-agent", ["env", "CUSTOM_TOKEN"], "secret-token");

  assert.equal(
    ((next.providers["custom-agent"]?.global.env) as Record<string, unknown>).CUSTOM_TOKEN,
    "secret-token",
  );
  assert.deepEqual(next.providers.claude.global, settings.providers.claude.global);
});

test("agentDefaults.provider accepts custom provider ids and keeps agentCommand derived", () => {
  const configured = applyProviderGlobalPatch(defaultAppSettings(), "custom-agent", {
    executable: "custom-agent",
    args: ["--serve"],
  });
  const settings = applyAgentDefaultsPatch(configured, {
    provider: "custom-agent",
  });

  assert.equal(settings.agentDefaults.provider, "custom-agent");
  assert.equal(typeof settings.agentDefaults.provider, "string");
  assert.equal(settings.agentCommand, "custom-agent --serve");
});

test("resolveAgentRuntimeCommand uses generic provider settings for unknown providers", () => {
  const configured = applyProviderGlobalPatch(defaultAppSettings(), "custom-agent", {
    executable: "custom-agent",
    args: ["--serve"],
  });
  const settings = applyAgentDefaultsPatch(configured, {
    provider: "custom-agent",
  });

  assert.equal(
    resolveAgentRuntimeCommand(settings, { type: "native" }, "custom-agent"),
    "custom-agent --serve",
  );
});

test("resolveAgentRuntimeCommand omits explicit codex hooks feature args for codex provider", () => {
  const configured = applyProviderGlobalPatch(defaultAppSettings(), "codex", {
    executable: "codex",
    extraArgs: ["--full-auto"],
    model: "gpt-5.4",
    approvalPolicy: "on-request",
  });
  const settings = applyAgentDefaultsPatch(configured, {
    provider: "codex",
  });

  assert.equal(
    resolveAgentRuntimeCommand(settings, { type: "native" }, "codex"),
    'codex --full-auto --config model="gpt-5.4" --config approval_policy="on-request"',
  );
});

test("unknown provider fallback stays stable across normalize clone and patch flows", () => {
  const base = applyAgentDefaultsPatch(defaultAppSettings(), {
    provider: "unknown-provider",
  });
  const normalized = normalizeAppSettings(base);
  const cloned = cloneAppSettings(base);
  const patched = applyGeneralSettingsPatch(base, {
    terminalCompatibilityMode: "compatibility",
  });

  assert.equal(base.agentCommand, normalized.agentCommand);
  assert.equal(base.agentCommand, cloned.agentCommand);
  assert.equal(base.agentCommand, patched.agentCommand);
  assert.equal(
    resolveAgentRuntimeCommand(base, { type: "native" }, "unknown-provider"),
    base.agentCommand,
  );
});

test("cloneAppSettings and toAppSettingsPayload fold direct compatibility mirror edits back into providers", () => {
  const settings = defaultAppSettings();
  settings.claude.global.env.ANTHROPIC_AUTH_TOKEN = "token-1";
  settings.codex.global.model = "gpt-5.4";

  const cloned = cloneAppSettings(settings);
  const payload = toAppSettingsPayload(settings);

  assert.equal(
    (cloned.providers.claude.global.env as Record<string, unknown>).ANTHROPIC_AUTH_TOKEN,
    "token-1",
  );
  assert.equal(
    (payload.providers.claude.global.env as Record<string, unknown>).ANTHROPIC_AUTH_TOKEN,
    "token-1",
  );
  assert.equal(cloned.providers.codex.global.model, "gpt-5.4");
  assert.equal(payload.providers.codex.global.model, "gpt-5.4");
});
