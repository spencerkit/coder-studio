import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { HTMLAttributes } from "react";
import type { Locale, Translator } from "../../i18n.ts";
import { EyeIcon, EyeOffIcon } from "../icons.tsx";
import type {
  AppSettings,
  ClaudeRuntimeProfile,
} from "../../types/app.ts";
import {
  forceClaudeExecutableDefaults,
  formatClaudeLaunchPreview,
  patchClaudeStructuredSettings,
  replaceClaudeAdvancedJson,
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

const BEHAVIOR_PERMISSION_MODE_OPTIONS = [
  { value: "", labelKey: "claudeSelectUnsetOption" },
  { value: "default", labelKey: "claudePermissionModeDefaultOption" },
  { value: "plan", labelKey: "claudePermissionModePlanOption" },
  { value: "auto", labelKey: "claudePermissionModeAutoOption" },
  { value: "acceptEdits", labelKey: "claudePermissionModeAcceptEditsOption" },
  { value: "dontAsk", labelKey: "claudePermissionModeDontAskOption" },
  { value: "bypassPermissions", labelKey: "claudePermissionModeBypassPermissionsOption" },
] as const;

const EFFORT_OPTIONS = [
  { value: "", labelKey: "claudeSelectUnsetOption" },
  { value: "low", labelKey: "claudeEffortLowOption" },
  { value: "medium", labelKey: "claudeEffortMediumOption" },
  { value: "high", labelKey: "claudeEffortHighOption" },
] as const;

const EDITOR_MODE_OPTIONS = [
  { value: "", labelKey: "claudeSelectUnsetOption" },
  { value: "default", labelKey: "claudeEditorModeDefaultOption" },
  { value: "vim", labelKey: "claudeEditorModeVimOption" },
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

const ClaudeFieldCopy = ({
  label,
  help,
  meta,
}: {
  label: string;
  help?: string;
  meta?: string;
}) => (
  <div className="claude-field-copy">
    <ClaudeFieldLabel label={label} help={help} />
    {meta ? <span className="claude-field-meta">{meta}</span> : null}
  </div>
);

const ClaudeInputField = ({
  label,
  help,
  meta,
  value,
  onChange,
  placeholder,
  type = "text",
  testId,
  inputMode,
  min,
  allowSecretReveal = false,
  revealLabel,
  concealLabel,
  className = "",
}: {
  label: string;
  help?: string;
  meta?: string;
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "number";
  testId?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  min?: number;
  allowSecretReveal?: boolean;
  revealLabel?: string;
  concealLabel?: string;
  className?: string;
}) => {
  const inputId = useId();
  const [revealed, setRevealed] = useState(false);
  const showSecretToggle = type === "password" && allowSecretReveal;
  const effectiveType = showSecretToggle && revealed ? "text" : type;

  return (
    <div className={`claude-field ${className}`.trim()}>
      <label htmlFor={inputId}>
        <ClaudeFieldCopy label={label} help={help} meta={meta} />
      </label>
      <div className={`claude-input-shell ${showSecretToggle ? "with-toggle" : ""}`.trim()}>
        <input
          id={inputId}
          className="settings-command-field"
          type={effectiveType}
          value={value}
          min={min}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          data-testid={testId}
        />
        {showSecretToggle ? (
          <button
            type="button"
            className="claude-visibility-toggle"
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? concealLabel : revealLabel}
            aria-pressed={revealed}
            data-testid={testId ? `${testId}-visibility-toggle` : undefined}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        ) : null}
      </div>
    </div>
  );
};

const ClaudeTextareaField = ({
  label,
  help,
  meta,
  value,
  onChange,
  placeholder,
  rows,
  className = "",
  testId,
}: {
  label: string;
  help?: string;
  meta?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows: number;
  className?: string;
  testId?: string;
}) => (
  <label className={`claude-field ${className}`.trim()}>
    <ClaudeFieldCopy label={label} help={help} meta={meta} />
    <textarea
      className="claude-textarea"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      data-testid={testId}
    />
  </label>
);

const ClaudeSelectField = ({
  label,
  help,
  meta,
  value,
  onChange,
  options,
  testId,
  className = "",
  t,
}: {
  label: string;
  help?: string;
  meta?: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; labelKey: string }>;
  testId?: string;
  className?: string;
  t: Translator;
}) => {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`claude-select-row ${className}`.trim()}>
      <ClaudeFieldCopy label={label} help={help} meta={meta} />
      <div className={`claude-select-shell ${open ? "open" : ""}`} ref={shellRef}>
        <button
          type="button"
          className={`claude-select-trigger ${open ? "open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          data-testid={testId}
        >
          <span className={`claude-select-trigger-text ${selected.value ? "" : "is-placeholder"}`.trim()}>
            {t(selected.labelKey)}
          </span>
          <span className="claude-select-chevron" aria-hidden="true" />
        </button>
        {open ? (
          <div className="claude-select-popover" role="listbox" id={listboxId}>
            {options.map((option) => {
              const optionSelected = option.value === value;
              return (
                <button
                  key={option.value || "unset"}
                  type="button"
                  role="option"
                  aria-selected={optionSelected}
                  className={`claude-select-option ${optionSelected ? "selected" : ""}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  data-testid={testId ? `${testId}-option-${option.value || "unset"}` : undefined}
                >
                  {t(option.labelKey)}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const ClaudeSettingsPanel = ({
  locale: _locale,
  settings,
  onChange,
  t,
}: ClaudeSettingsPanelProps) => {
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
  const scopeProfile = normalizedSettings.claude.global;
  const settingsJson = scopeProfile.settingsJson;
  const globalConfigJson = scopeProfile.globalConfigJson;

  useEffect(() => {
    setSettingsJsonDraft(formatJson(settingsJson));
    setGlobalConfigJsonDraft(formatJson(globalConfigJson));
    setSettingsJsonError("");
    setGlobalConfigJsonError("");
  }, [settingsJson, globalConfigJson]);

  const updateEnv = (updater: (env: Record<string, string>) => Record<string, string>) => {
    commitSettings(patchClaudeStructuredSettings(normalizedSettings, {
      env: updater(scopeProfile.env),
    }));
  };

  const updateStartupArgs = (updater: (startupArgs: string[]) => string[]) => {
    commitSettings(patchClaudeStructuredSettings(normalizedSettings, {
      startupArgs: updater(scopeProfile.startupArgs),
    }));
  };

  const updateSettingsJson = (path: string[], value: unknown) => {
    commitSettings(replaceClaudeAdvancedJson(normalizedSettings, {
      field: "settingsJson",
      value: setJsonPath(settingsJson, path, value),
    }));
  };

  const updateGlobalConfigJson = (path: string[], value: unknown) => {
    commitSettings(replaceClaudeAdvancedJson(normalizedSettings, {
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
      field: "globalConfigJson",
      value: parsed.data,
    }));
  };

  const extraEnvText = envToText(scopeProfile.env);
  const commandPreview = formatClaudeLaunchPreview(scopeProfile);
  const behaviorPermissionMode = readString(readJsonPath(settingsJson, ["permissionMode"]));
  const effortValue = readString(readJsonPath(settingsJson, ["effort"]));
  const editorModeValue = readString(readJsonPath(globalConfigJson, ["editorMode"]));
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
      <div className="settings-group-card">
        <div className="claude-settings-grid claude-settings-grid--startup">
          <div className="claude-field claude-field-wide">
            <ClaudeFieldCopy
              label={t("claudeCommandPreview")}
              help={t("claudeStartupExecutableFixed")}
            />
            <code className="claude-command-preview-code" data-testid="claude-command-preview">{commandPreview || "claude"}</code>
          </div>
          {STARTUP_VALUE_OPTIONS.map((option) => (
            <ClaudeSelectField
              key={option.flag}
              className="claude-field-compact"
              label={t(option.labelKey)}
              help={t(option.helpKey)}
              value={readSingleFlagValue(scopeProfile.startupArgs, option.flag)}
              onChange={(value) => updateStartupValueFlag(option.flag, value)}
              options={option.values}
              testId={option.testId}
              t={t}
            />
          ))}
          {STARTUP_BOOLEAN_OPTIONS.map((option) => (
            <label key={option.flag} className="claude-inline-toggle">
              <div className="claude-inline-toggle-copy">
                <ClaudeFieldCopy
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
          <ClaudeTextareaField
            className="claude-field-wide"
            label={t("claudeExtraStartupArgs")}
            help={t("claudeExtraStartupArgsHint")}
            meta={t("claudeExtraStartupArgsMeta")}
            value={listToLines(extraStartupArgs)}
            onChange={updateExtraStartupArgs}
            placeholder={t("claudeExtraStartupArgsPlaceholder")}
            rows={4}
            testId="claude-startup-args"
          />
        </div>
      </div>

      <div className="settings-group-card">
        <div className="claude-settings-grid">
          <ClaudeInputField
            label={t("claudeApiKey")}
            help={t("claudeApiKeyHelp")}
            meta={t("claudeApiKeyMeta")}
            type="password"
            allowSecretReveal
            revealLabel={t("claudeShowSecret")}
            concealLabel={t("claudeHideSecret")}
            value={scopeProfile.env.ANTHROPIC_API_KEY ?? ""}
            onChange={(value) => updateEnv((env) => ({
              ...env,
              ANTHROPIC_API_KEY: value,
            }))}
            placeholder={t("claudeApiKeyPlaceholder")}
            testId="claude-api-key-input"
          />
          <ClaudeInputField
            label={t("claudeAuthToken")}
            help={t("claudeAuthTokenHelp")}
            meta={t("claudeAuthTokenMeta")}
            type="password"
            allowSecretReveal
            revealLabel={t("claudeShowSecret")}
            concealLabel={t("claudeHideSecret")}
            value={scopeProfile.env.ANTHROPIC_AUTH_TOKEN ?? ""}
            onChange={(value) => updateEnv((env) => ({
              ...env,
              ANTHROPIC_AUTH_TOKEN: value,
            }))}
            placeholder={t("claudeAuthTokenPlaceholder")}
            testId="claude-auth-token-input"
          />
          <ClaudeInputField
            label={t("claudeBaseUrl")}
            help={t("claudeBaseUrlHelp")}
            meta={t("claudeBaseUrlMeta")}
            value={scopeProfile.env.ANTHROPIC_BASE_URL ?? ""}
            onChange={(value) => updateEnv((env) => ({
              ...env,
              ANTHROPIC_BASE_URL: value,
            }))}
            placeholder={t("claudeBaseUrlPlaceholder")}
            inputMode="url"
          />
          <ClaudeTextareaField
            label={t("claudeCustomHeaders")}
            help={t("claudeCustomHeadersHelp")}
            meta={t("claudeCustomHeadersMeta")}
            value={scopeProfile.env.ANTHROPIC_CUSTOM_HEADERS ?? ""}
            onChange={(value) => updateEnv((env) => ({
              ...env,
              ANTHROPIC_CUSTOM_HEADERS: value,
            }))}
            placeholder={t("claudeCustomHeadersPlaceholder")}
            rows={3}
          />
          <ClaudeInputField
            label={t("claudeApiKeyHelper")}
            help={t("claudeApiKeyHelperHelp")}
            meta={t("claudeApiKeyHelperMeta")}
            value={readString(readJsonPath(settingsJson, ["apiKeyHelper"]))}
            onChange={(value) => updateSettingsJson(["apiKeyHelper"], value.trim())}
            placeholder={t("claudeApiKeyHelperPlaceholder")}
          />
          <ClaudeTextareaField
            className="claude-field-wide"
            label={t("claudeExtraEnv")}
            help={t("claudeExtraEnvHelp")}
            meta={t("claudeExtraEnvMeta")}
            value={extraEnvText}
            onChange={(value) => updateEnv((env) => {
              const next = { ...env };
              for (const key of Object.keys(next)) {
                if (!RESERVED_ENV_KEYS.includes(key as typeof RESERVED_ENV_KEYS[number])) {
                  delete next[key];
                }
              }
              return {
                ...next,
                ...textToEnv(value),
              };
            })}
            placeholder={t("claudeExtraEnvPlaceholder")}
            rows={5}
          />
        </div>
      </div>

      <div className="settings-group-card">
        <div className="claude-settings-grid">
          <ClaudeInputField
            label={t("claudeModel")}
            meta={t("claudeModelMeta")}
            value={readString(readJsonPath(settingsJson, ["model"]))}
            onChange={(value) => updateSettingsJson(["model"], value.trim())}
            placeholder={t("claudeModelPlaceholder")}
            testId="claude-model-input"
          />
          <ClaudeInputField
            label={t("claudeFallbackModel")}
            meta={t("claudeFallbackModelMeta")}
            value={readString(readJsonPath(settingsJson, ["fallbackModel"]))}
            onChange={(value) => updateSettingsJson(["fallbackModel"], value.trim())}
            placeholder={t("claudeFallbackModelPlaceholder")}
          />
          <ClaudeSelectField
            label={t("claudePermissionMode")}
            value={behaviorPermissionMode}
            onChange={(value) => updateSettingsJson(["permissionMode"], value)}
            options={BEHAVIOR_PERMISSION_MODE_OPTIONS}
            t={t}
          />
          <ClaudeSelectField
            label={t("claudeEffort")}
            value={effortValue}
            onChange={(value) => updateSettingsJson(["effort"], value)}
            options={EFFORT_OPTIONS}
            t={t}
          />
          <ClaudeInputField
            label={t("languageLabel")}
            meta={t("claudeLanguageMeta")}
            value={readString(readJsonPath(settingsJson, ["language"]))}
            onChange={(value) => updateSettingsJson(["language"], value.trim())}
            placeholder={t("claudeLanguagePlaceholder")}
          />
          <ClaudeInputField
            label={t("claudeCleanupDays")}
            meta={t("claudeCleanupDaysMeta")}
            type="number"
            min={0}
            inputMode="numeric"
            value={readNumber(readJsonPath(settingsJson, ["cleanupPeriodDays"]))}
            onChange={(value) => updateSettingsJson(["cleanupPeriodDays"], value ? Number(value) : undefined)}
            placeholder={t("claudeCleanupDaysPlaceholder")}
          />
          <label className="claude-inline-toggle"><div className="claude-inline-toggle-copy"><ClaudeFieldLabel label={t("claudeIncludeGitInstructions")} /></div><input type="checkbox" checked={readBoolean(readJsonPath(settingsJson, ["includeGitInstructions"]))} onChange={(event) => updateSettingsJson(["includeGitInstructions"], event.target.checked ? true : undefined)} /></label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="claude-settings-grid">
          <label className="claude-inline-toggle"><div className="claude-inline-toggle-copy"><ClaudeFieldCopy label={t("claudeAutoConnectIde")} /></div><input type="checkbox" checked={readBoolean(readJsonPath(globalConfigJson, ["autoConnectIde"]))} onChange={(event) => updateGlobalConfigJson(["autoConnectIde"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-inline-toggle"><div className="claude-inline-toggle-copy"><ClaudeFieldCopy label={t("claudeAutoInstallIdeExtension")} /></div><input type="checkbox" checked={readBoolean(readJsonPath(globalConfigJson, ["autoInstallIdeExtension"]))} onChange={(event) => updateGlobalConfigJson(["autoInstallIdeExtension"], event.target.checked ? true : undefined)} /></label>
          <ClaudeSelectField
            label={t("claudeEditorMode")}
            value={editorModeValue}
            onChange={(value) => updateGlobalConfigJson(["editorMode"], value)}
            options={EDITOR_MODE_OPTIONS}
            t={t}
          />
          <label className="claude-inline-toggle"><div className="claude-inline-toggle-copy"><ClaudeFieldCopy label={t("claudeShowTurnDuration")} /></div><input type="checkbox" checked={readBoolean(readJsonPath(globalConfigJson, ["showTurnDuration"]))} onChange={(event) => updateGlobalConfigJson(["showTurnDuration"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-inline-toggle"><div className="claude-inline-toggle-copy"><ClaudeFieldCopy label={t("claudeTerminalProgressBarEnabled")} /></div><input type="checkbox" checked={readBoolean(readJsonPath(globalConfigJson, ["terminalProgressBarEnabled"]))} onChange={(event) => updateGlobalConfigJson(["terminalProgressBarEnabled"], event.target.checked ? true : undefined)} /></label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="claude-settings-grid">
          <label className="claude-field claude-field-wide">
            <ClaudeFieldCopy label={t("claudeSettingsJsonAdvanced")} />
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
            <ClaudeFieldCopy label={t("claudeGlobalConfigAdvanced")} />
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
