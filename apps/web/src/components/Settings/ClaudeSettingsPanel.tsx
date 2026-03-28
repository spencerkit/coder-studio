import { useEffect, useMemo, useState } from "react";
import type { Locale, Translator } from "../../i18n.ts";
import type {
  AppSettings,
  ClaudeRuntimeProfile,
  ClaudeSettingsScope,
} from "../../types/app.ts";
import {
  forceClaudeExecutableDefaults,
  formatClaudeLaunchPreview,
  getClaudeScopeProfile,
  isClaudeScopeOverrideEnabled,
  patchClaudeStructuredSettings,
  replaceClaudeAdvancedJson,
  setClaudeScopeOverrideEnabled,
} from "../../shared/app/claude-settings.ts";

const RESERVED_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
] as const;

const STARTUP_BOOLEAN_OPTIONS = [
  {
    flag: "--dangerously-skip-permissions",
    labelKey: "claudeDangerouslySkipPermissions",
    helpKey: "claudeDangerouslySkipPermissionsHelp",
    testId: "claude-flag-dangerously-skip-permissions",
  },
  {
    flag: "--allow-dangerously-skip-permissions",
    labelKey: "claudeAllowDangerouslySkipPermissions",
    helpKey: "claudeAllowDangerouslySkipPermissionsHelp",
    testId: "claude-flag-allow-dangerously-skip-permissions",
  },
  {
    flag: "--verbose",
    labelKey: "claudeVerbose",
    helpKey: "claudeVerboseHelp",
    testId: "claude-flag-verbose",
  },
  {
    flag: "--ide",
    labelKey: "claudeIdeFlag",
    helpKey: "claudeIdeHelp",
    testId: "claude-flag-ide",
  },
  {
    flag: "--brief",
    labelKey: "claudeBrief",
    helpKey: "claudeBriefHelp",
    testId: "claude-flag-brief",
  },
  {
    flag: "--bare",
    labelKey: "claudeBare",
    helpKey: "claudeBareHelp",
    testId: "claude-flag-bare",
  },
] as const;

const STARTUP_VALUE_OPTIONS = [
  {
    flag: "--permission-mode",
    labelKey: "claudePermissionModeFlag",
    helpKey: "claudePermissionModeHelp",
    testId: "claude-startup-permission-mode",
    values: [
      { value: "", labelKey: "claudePermissionModeInherit" },
      { value: "default", labelKey: "claudePermissionModeDefaultOption" },
      { value: "plan", labelKey: "claudePermissionModePlanOption" },
      { value: "auto", labelKey: "claudePermissionModeAutoOption" },
      { value: "acceptEdits", labelKey: "claudePermissionModeAcceptEditsOption" },
      { value: "dontAsk", labelKey: "claudePermissionModeDontAskOption" },
      { value: "bypassPermissions", labelKey: "claudePermissionModeBypassPermissionsOption" },
    ],
  },
] as const;

const STARTUP_BOOLEAN_FLAGS = STARTUP_BOOLEAN_OPTIONS.map((option) => option.flag);
const STARTUP_VALUE_FLAGS = STARTUP_VALUE_OPTIONS.map((option) => option.flag);
const STARTUP_STRUCTURED_FLAGS = [...STARTUP_BOOLEAN_FLAGS, ...STARTUP_VALUE_FLAGS];

const readJsonPath = (source: Record<string, unknown>, path: string[]): unknown => {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const cloneJson = (value: Record<string, unknown>) => structuredClone(value);

const removeJsonPath = (source: Record<string, unknown>, path: string[]): Record<string, unknown> => {
  const next = cloneJson(source);
  let current: Record<string, unknown> = next;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const child = current[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      return next;
    }
    current = child as Record<string, unknown>;
  }
  delete current[path[path.length - 1]];
  return next;
};

const setJsonPath = (
  source: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> => {
  if (
    value === undefined
    || value === null
    || value === ""
    || (Array.isArray(value) && value.length === 0)
  ) {
    return removeJsonPath(source, path);
  }

  const next = cloneJson(source);
  let current: Record<string, unknown> = next;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const child = current[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value as never;
  return next;
};

const readString = (value: unknown) => (typeof value === "string" ? value : "");
const readBoolean = (value: unknown) => value === true;
const readNumber = (value: unknown) => (typeof value === "number" ? value : "");

const linesToList = (value: string) => value
  .split("\n")
  .map((entry) => entry.trim())
  .filter(Boolean);

const listToLines = (value: string[]) => value.join("\n");

const envToText = (env: Record<string, string>) => Object.entries(env)
  .filter(([key]) => !RESERVED_ENV_KEYS.includes(key as typeof RESERVED_ENV_KEYS[number]))
  .map(([key, value]) => `${key}=${value}`)
  .join("\n");

const textToEnv = (value: string) => Object.fromEntries(
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const splitIndex = entry.indexOf("=");
      if (splitIndex === -1) {
        return [entry, ""] as const;
      }
      return [entry.slice(0, splitIndex).trim(), entry.slice(splitIndex + 1)] as const;
    })
    .filter(([key]) => Boolean(key)),
);

const stripFlags = (
  startupArgs: string[],
  flags: string[],
  valueFlags: string[] = [],
): string[] => {
  const next: string[] = [];
  for (let index = 0; index < startupArgs.length; index += 1) {
    const current = startupArgs[index];
    if (!flags.includes(current)) {
      next.push(current);
      continue;
    }
    const takesValue = valueFlags.includes(current);
    if (
      takesValue
      && typeof startupArgs[index + 1] === "string"
      && !startupArgs[index + 1].startsWith("--")
    ) {
      index += 1;
    }
  }
  return next;
};

const readStandaloneFlag = (startupArgs: string[], flag: string) => startupArgs.includes(flag);

const readFlagValues = (startupArgs: string[], flag: string) => {
  const values: string[] = [];
  for (let index = 0; index < startupArgs.length; index += 1) {
    if (startupArgs[index] !== flag) continue;
    const next = startupArgs[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      values.push(next);
      index += 1;
    }
  }
  return values;
};

const readSingleFlagValue = (startupArgs: string[], flag: string) => readFlagValues(startupArgs, flag)[0] ?? "";

const formatJson = (value: Record<string, unknown>) => JSON.stringify(value, null, 2);

const parseJsonObject = (value: string): { data?: Record<string, unknown>; error?: string } => {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "JSON must be an object." };
    }
    return { data: parsed as Record<string, unknown> };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

type ClaudeSettingsPanelProps = {
  locale: Locale;
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  t: Translator;
};

const ClaudeHelpTip = ({ help }: { help: string }) => (
  <span className="claude-help-tip">
    <span className="claude-help-dot" tabIndex={0} aria-label={help}>
      i
    </span>
    <span className="claude-help-tooltip" role="tooltip">{help}</span>
  </span>
);

const ClaudeFieldLabel = ({
  label,
  help,
}: {
  label: string;
  help?: string;
}) => (
  <span className="claude-field-label">
    <span>{label}</span>
    {help ? <ClaudeHelpTip help={help} /> : null}
  </span>
);

export const ClaudeSettingsPanel = ({
  locale: _locale,
  settings,
  onChange,
  t,
}: ClaudeSettingsPanelProps) => {
  const [activeScope, setActiveScope] = useState<ClaudeSettingsScope>("global");
  const [settingsJsonDraft, setSettingsJsonDraft] = useState("");
  const [globalConfigJsonDraft, setGlobalConfigJsonDraft] = useState("");
  const [settingsJsonError, setSettingsJsonError] = useState("");
  const [globalConfigJsonError, setGlobalConfigJsonError] = useState("");
  const normalizedSettings = useMemo(
    () => forceClaudeExecutableDefaults(settings),
    [settings],
  );
  const commitSettings = (nextSettings: AppSettings) => {
    onChange(forceClaudeExecutableDefaults(nextSettings));
  };

  const scopeProfile = useMemo(
    () => getClaudeScopeProfile(normalizedSettings, activeScope),
    [activeScope, normalizedSettings],
  );
  const scopeOverrideEnabled = activeScope === "global"
    ? true
    : isClaudeScopeOverrideEnabled(normalizedSettings, activeScope);
  const settingsJson = scopeProfile.settingsJson;
  const globalConfigJson = scopeProfile.globalConfigJson;

  useEffect(() => {
    setSettingsJsonDraft(formatJson(settingsJson));
    setGlobalConfigJsonDraft(formatJson(globalConfigJson));
    setSettingsJsonError("");
    setGlobalConfigJsonError("");
  }, [activeScope, settingsJson, globalConfigJson]);

  const updateEnv = (updater: (env: Record<string, string>) => Record<string, string>) => {
    commitSettings(patchClaudeStructuredSettings(normalizedSettings, {
      scope: activeScope,
      env: updater(scopeProfile.env),
    }));
  };

  const updateStartupArgs = (updater: (startupArgs: string[]) => string[]) => {
    commitSettings(patchClaudeStructuredSettings(normalizedSettings, {
      scope: activeScope,
      startupArgs: updater(scopeProfile.startupArgs),
    }));
  };

  const updateSettingsJson = (path: string[], value: unknown) => {
    commitSettings(replaceClaudeAdvancedJson(normalizedSettings, {
      scope: activeScope,
      field: "settingsJson",
      value: setJsonPath(settingsJson, path, value),
    }));
  };

  const updateGlobalConfigJson = (path: string[], value: unknown) => {
    commitSettings(replaceClaudeAdvancedJson(normalizedSettings, {
      scope: activeScope,
      field: "globalConfigJson",
      value: setJsonPath(globalConfigJson, path, value),
    }));
  };

  const commitSettingsJsonDraft = () => {
    const parsed = parseJsonObject(settingsJsonDraft);
    if (!parsed.data) {
      setSettingsJsonError(parsed.error ?? t("claudeJsonInvalid"));
      return;
    }
    setSettingsJsonError("");
    commitSettings(replaceClaudeAdvancedJson(normalizedSettings, {
      scope: activeScope,
      field: "settingsJson",
      value: parsed.data,
    }));
  };

  const commitGlobalConfigJsonDraft = () => {
    const parsed = parseJsonObject(globalConfigJsonDraft);
    if (!parsed.data) {
      setGlobalConfigJsonError(parsed.error ?? t("claudeJsonInvalid"));
      return;
    }
    setGlobalConfigJsonError("");
    commitSettings(replaceClaudeAdvancedJson(normalizedSettings, {
      scope: activeScope,
      field: "globalConfigJson",
      value: parsed.data,
    }));
  };

  const extraEnvText = envToText(scopeProfile.env);
  const commandPreview = formatClaudeLaunchPreview(scopeProfile);
  const extraStartupArgs = stripFlags(
    scopeProfile.startupArgs,
    STARTUP_STRUCTURED_FLAGS,
    STARTUP_VALUE_FLAGS,
  );
  const collectStructuredStartupArgs = (startupArgs: string[]) => {
    const nextBooleanFlags = STARTUP_BOOLEAN_OPTIONS
      .filter((option) => readStandaloneFlag(startupArgs, option.flag))
      .map((option) => option.flag);
    const nextValueFlags = STARTUP_VALUE_OPTIONS.flatMap((option) => {
      const value = readSingleFlagValue(startupArgs, option.flag).trim();
      return value ? [option.flag, value] : [];
    });
    return [...nextBooleanFlags, ...nextValueFlags];
  };
  const updateStartupBooleanFlag = (flag: string, enabled: boolean) => {
    updateStartupArgs((current) => {
      const remainingArgs = stripFlags(current, STARTUP_STRUCTURED_FLAGS, STARTUP_VALUE_FLAGS);
      const nextFlags = STARTUP_BOOLEAN_OPTIONS
        .filter((option) => option.flag === flag ? enabled : readStandaloneFlag(current, option.flag))
        .map((option) => option.flag);
      const nextValueFlags = STARTUP_VALUE_OPTIONS.flatMap((option) => {
        const value = readSingleFlagValue(current, option.flag).trim();
        return value ? [option.flag, value] : [];
      });
      return [...nextFlags, ...nextValueFlags, ...remainingArgs];
    });
  };
  const updateStartupValueFlag = (flag: string, value: string) => {
    updateStartupArgs((current) => {
      const remainingArgs = stripFlags(current, STARTUP_STRUCTURED_FLAGS, STARTUP_VALUE_FLAGS);
      const nextBooleanFlags = STARTUP_BOOLEAN_OPTIONS
        .filter((option) => readStandaloneFlag(current, option.flag))
        .map((option) => option.flag);
      const nextValueFlags = STARTUP_VALUE_OPTIONS.flatMap((option) => {
        const nextValue = option.flag === flag
          ? value.trim()
          : readSingleFlagValue(current, option.flag).trim();
        return nextValue ? [option.flag, nextValue] : [];
      });
      return [...nextBooleanFlags, ...nextValueFlags, ...remainingArgs];
    });
  };
  const updateExtraStartupArgs = (value: string) => {
    updateStartupArgs((current) => {
      const nextFlags = collectStructuredStartupArgs(current);
      return [...nextFlags, ...linesToList(value)];
    });
  };

  return (
    <div className="claude-settings-panel">
      <div className="claude-settings-toolbar">
        <div className="claude-scope-switcher">
          {(["global", "native", "wsl"] as ClaudeSettingsScope[]).map((scope) => (
            <button
              key={scope}
              type="button"
              className={`settings-pill-option ${activeScope === scope ? "active" : ""}`}
              onClick={() => setActiveScope(scope)}
              data-testid={`claude-scope-${scope}`}
            >
              {scope === "global" ? t("claudeScopeGlobal") : scope === "native" ? t("claudeScopeNative") : t("claudeScopeWsl")}
            </button>
          ))}
        </div>
        {activeScope !== "global" && (
          <div className="claude-override-toggle">
            <label className="toggle">
              <input
                type="checkbox"
                checked={scopeOverrideEnabled}
                onChange={(event) => commitSettings(setClaudeScopeOverrideEnabled(normalizedSettings, activeScope, event.target.checked))}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
            </label>
            <span>{scopeOverrideEnabled ? t("claudeOverrideEnabled") : t("claudeOverrideInherited")}</span>
          </div>
        )}
      </div>

      <div className="settings-group-card">
        <div className="claude-settings-grid claude-settings-grid--startup">
          <div className="claude-field claude-field-wide">
            <ClaudeFieldLabel label={t("claudeCommandPreview")} help={t("claudeStartupExecutableFixed")} />
            <code className="claude-command-preview-code" data-testid="claude-command-preview">{commandPreview || "claude"}</code>
          </div>
          {STARTUP_VALUE_OPTIONS.map((option) => (
            <label key={option.flag} className="claude-field claude-field-compact">
              <ClaudeFieldLabel
                label={t(option.labelKey)}
                help={t(option.helpKey)}
              />
              <select
                className="settings-command-field"
                value={readSingleFlagValue(scopeProfile.startupArgs, option.flag)}
                onChange={(event) => updateStartupValueFlag(option.flag, event.target.value)}
                data-testid={option.testId}
              >
                {option.values.map((entry) => (
                  <option key={entry.value || "inherit"} value={entry.value}>
                    {t(entry.labelKey)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {STARTUP_BOOLEAN_OPTIONS.map((option) => (
            <label key={option.flag} className="claude-inline-toggle">
              <div className="claude-inline-toggle-copy">
                <ClaudeFieldLabel
                  label={t(option.labelKey)}
                  help={t(option.helpKey)}
                />
              </div>
              <input
                type="checkbox"
                checked={readStandaloneFlag(scopeProfile.startupArgs, option.flag)}
                onChange={(event) => updateStartupBooleanFlag(option.flag, event.target.checked)}
                data-testid={option.testId}
              />
            </label>
          ))}
          <label className="claude-field claude-field-wide">
            <ClaudeFieldLabel label={t("claudeExtraStartupArgs")} help={t("claudeExtraStartupArgsHint")} />
            <textarea
              className="claude-textarea"
              value={listToLines(extraStartupArgs)}
              onChange={(event) => updateExtraStartupArgs(event.target.value)}
              placeholder="--debug"
              rows={4}
              data-testid="claude-startup-args"
            />
          </label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="claude-settings-grid">
          <label className="claude-field">
            <ClaudeFieldLabel label={t("claudeApiKey")} help={t("claudeApiKeyHelp")} />
            <input
              className="settings-command-field"
              type="password"
              value={scopeProfile.env.ANTHROPIC_API_KEY ?? ""}
              onChange={(event) => updateEnv((env) => ({
                ...env,
                ANTHROPIC_API_KEY: event.target.value,
              }))}
            />
          </label>
          <label className="claude-field">
            <ClaudeFieldLabel label={t("claudeAuthToken")} help={t("claudeAuthTokenHelp")} />
            <input
              className="settings-command-field"
              type="password"
              value={scopeProfile.env.ANTHROPIC_AUTH_TOKEN ?? ""}
              onChange={(event) => updateEnv((env) => ({
                ...env,
                ANTHROPIC_AUTH_TOKEN: event.target.value,
              }))}
            />
          </label>
          <label className="claude-field">
            <ClaudeFieldLabel label={t("claudeBaseUrl")} help={t("claudeBaseUrlHelp")} />
            <input
              className="settings-command-field"
              value={scopeProfile.env.ANTHROPIC_BASE_URL ?? ""}
              onChange={(event) => updateEnv((env) => ({
                ...env,
                ANTHROPIC_BASE_URL: event.target.value,
              }))}
            />
          </label>
          <label className="claude-field">
            <ClaudeFieldLabel label={t("claudeCustomHeaders")} help={t("claudeCustomHeadersHelp")} />
            <textarea
              className="claude-textarea"
              value={scopeProfile.env.ANTHROPIC_CUSTOM_HEADERS ?? ""}
              onChange={(event) => updateEnv((env) => ({
                ...env,
                ANTHROPIC_CUSTOM_HEADERS: event.target.value,
              }))}
              rows={3}
            />
          </label>
          <label className="claude-field">
            <ClaudeFieldLabel label={t("claudeApiKeyHelper")} help={t("claudeApiKeyHelperHelp")} />
            <input
              className="settings-command-field"
              value={readString(readJsonPath(settingsJson, ["apiKeyHelper"]))}
              onChange={(event) => updateSettingsJson(["apiKeyHelper"], event.target.value.trim())}
            />
          </label>
          <label className="claude-field claude-field-wide">
            <ClaudeFieldLabel label={t("claudeExtraEnv")} help={t("claudeExtraEnvHelp")} />
            <textarea
              className="claude-textarea"
              value={extraEnvText}
              onChange={(event) => updateEnv((env) => {
                const next = { ...env };
                for (const key of Object.keys(next)) {
                  if (!RESERVED_ENV_KEYS.includes(key as typeof RESERVED_ENV_KEYS[number])) {
                    delete next[key];
                  }
                }
                return {
                  ...next,
                  ...textToEnv(event.target.value),
                };
              })}
              rows={5}
            />
          </label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="claude-settings-grid">
          <label className="claude-field"><ClaudeFieldLabel label={t("claudeModel")} /><input className="settings-command-field" value={readString(readJsonPath(settingsJson, ["model"]))} onChange={(event) => updateSettingsJson(["model"], event.target.value.trim())} data-testid="claude-model-input" /></label>
          <label className="claude-field"><ClaudeFieldLabel label={t("claudeFallbackModel")} /><input className="settings-command-field" value={readString(readJsonPath(settingsJson, ["fallbackModel"]))} onChange={(event) => updateSettingsJson(["fallbackModel"], event.target.value.trim())} /></label>
          <label className="claude-field"><ClaudeFieldLabel label={t("claudePermissionMode")} /><input className="settings-command-field" value={readString(readJsonPath(settingsJson, ["permissionMode"]))} onChange={(event) => updateSettingsJson(["permissionMode"], event.target.value.trim())} /></label>
          <label className="claude-field"><ClaudeFieldLabel label={t("claudeEffort")} /><input className="settings-command-field" value={readString(readJsonPath(settingsJson, ["effort"]))} onChange={(event) => updateSettingsJson(["effort"], event.target.value.trim())} /></label>
          <label className="claude-field"><ClaudeFieldLabel label={t("languageLabel")} /><input className="settings-command-field" value={readString(readJsonPath(settingsJson, ["language"]))} onChange={(event) => updateSettingsJson(["language"], event.target.value.trim())} /></label>
          <label className="claude-field"><ClaudeFieldLabel label={t("claudeCleanupDays")} /><input className="settings-command-field" type="number" value={readNumber(readJsonPath(settingsJson, ["cleanupPeriodDays"]))} onChange={(event) => updateSettingsJson(["cleanupPeriodDays"], event.target.value ? Number(event.target.value) : undefined)} /></label>
          <label className="claude-inline-toggle"><div className="claude-inline-toggle-copy"><ClaudeFieldLabel label={t("claudeIncludeGitInstructions")} /></div><input type="checkbox" checked={readBoolean(readJsonPath(settingsJson, ["includeGitInstructions"]))} onChange={(event) => updateSettingsJson(["includeGitInstructions"], event.target.checked ? true : undefined)} /></label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="claude-settings-grid">
          <label className="claude-inline-toggle"><div className="claude-inline-toggle-copy"><ClaudeFieldLabel label={t("claudeAutoConnectIde")} /></div><input type="checkbox" checked={readBoolean(readJsonPath(globalConfigJson, ["autoConnectIde"]))} onChange={(event) => updateGlobalConfigJson(["autoConnectIde"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-inline-toggle"><div className="claude-inline-toggle-copy"><ClaudeFieldLabel label={t("claudeAutoInstallIdeExtension")} /></div><input type="checkbox" checked={readBoolean(readJsonPath(globalConfigJson, ["autoInstallIdeExtension"]))} onChange={(event) => updateGlobalConfigJson(["autoInstallIdeExtension"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-field"><ClaudeFieldLabel label={t("claudeEditorMode")} /><input className="settings-command-field" value={readString(readJsonPath(globalConfigJson, ["editorMode"]))} onChange={(event) => updateGlobalConfigJson(["editorMode"], event.target.value.trim())} /></label>
          <label className="claude-inline-toggle"><div className="claude-inline-toggle-copy"><ClaudeFieldLabel label={t("claudeShowTurnDuration")} /></div><input type="checkbox" checked={readBoolean(readJsonPath(globalConfigJson, ["showTurnDuration"]))} onChange={(event) => updateGlobalConfigJson(["showTurnDuration"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-inline-toggle"><div className="claude-inline-toggle-copy"><ClaudeFieldLabel label={t("claudeTerminalProgressBarEnabled")} /></div><input type="checkbox" checked={readBoolean(readJsonPath(globalConfigJson, ["terminalProgressBarEnabled"]))} onChange={(event) => updateGlobalConfigJson(["terminalProgressBarEnabled"], event.target.checked ? true : undefined)} /></label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="claude-settings-grid">
          <label className="claude-field claude-field-wide">
            <ClaudeFieldLabel label={t("claudeSettingsJsonAdvanced")} />
            <textarea
              className="claude-json-editor"
              rows={12}
              value={settingsJsonDraft}
              onChange={(event) => setSettingsJsonDraft(event.target.value)}
              onBlur={commitSettingsJsonDraft}
            />
            {settingsJsonError && <span className="claude-json-error">{settingsJsonError}</span>}
          </label>
          <label className="claude-field claude-field-wide">
            <ClaudeFieldLabel label={t("claudeGlobalConfigAdvanced")} />
            <textarea
              className="claude-json-editor"
              rows={12}
              value={globalConfigJsonDraft}
              onChange={(event) => setGlobalConfigJsonDraft(event.target.value)}
              onBlur={commitGlobalConfigJsonDraft}
            />
            {globalConfigJsonError && <span className="claude-json-error">{globalConfigJsonError}</span>}
          </label>
        </div>
      </div>
    </div>
  );
};

export default ClaudeSettingsPanel;
