import { useAtomValue } from "jotai";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { connectionStatusAtom, dispatchCommandAtom } from "../../../atoms/connection";
import { SegmentedControl, Textarea } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import { ConfigEditor, type ConfigType } from "./config-editor";

export interface ProviderInfo {
  id: "claude" | "codex";
  displayName: string;
}

interface ProviderSettingsProps {
  providers: ProviderInfo[];
  additionalArgsById: Record<string, string>;
  setAdditionalArgsById: Dispatch<SetStateAction<Record<string, string>>>;
  isMobile: boolean;
  onLayoutModeChange?: (mode: "default" | "fill-height") => void;
}

type ProviderDetailView = "base" | "config";

function parseProviderAdditionalArgs(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function createProviderRecord<T>(
  providers: ProviderInfo[],
  createValue: () => T
): Record<string, T> {
  return Object.fromEntries(providers.map((provider) => [provider.id, createValue()]));
}

export function ProviderSettings({
  providers,
  additionalArgsById,
  setAdditionalArgsById,
  isMobile,
  onLayoutModeChange,
}: ProviderSettingsProps) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo["id"]>(
    providers[0]?.id ?? "claude"
  );
  const [desktopView, setDesktopView] = useState<ProviderDetailView>("base");
  const [mobileView, setMobileView] = useState<ProviderDetailView>("base");
  const [previewByProvider, setPreviewByProvider] = useState<Record<string, string>>(() =>
    createProviderRecord(providers, () => "")
  );
  const [visitedConfigProviders, setVisitedConfigProviders] = useState<Record<string, boolean>>(
    () => createProviderRecord(providers, () => false)
  );
  const previewRequestVersionRef = useRef<Record<string, number>>(
    createProviderRecord(providers, () => 0)
  );

  useEffect(() => {
    if (providers.some((provider) => provider.id === selectedProvider)) {
      return;
    }

    setSelectedProvider(providers[0]?.id ?? "claude");
  }, [providers, selectedProvider]);

  useEffect(() => {
    setPreviewByProvider((previous) => {
      const next = createProviderRecord(providers, () => "");
      let changed = false;

      for (const provider of providers) {
        if (provider.id in previous) {
          next[provider.id] = previous[provider.id];
        } else {
          changed = true;
        }
      }

      if (Object.keys(previous).length !== providers.length) {
        changed = true;
      }

      return changed ? next : previous;
    });

    setVisitedConfigProviders((previous) => {
      const next = createProviderRecord(providers, () => false);
      let changed = false;

      for (const provider of providers) {
        if (provider.id in previous) {
          next[provider.id] = previous[provider.id];
        } else {
          changed = true;
        }
      }

      if (Object.keys(previous).length !== providers.length) {
        changed = true;
      }

      return changed ? next : previous;
    });

    const nextVersions = createProviderRecord(providers, () => 0);
    for (const provider of providers) {
      if (provider.id in previewRequestVersionRef.current) {
        nextVersions[provider.id] = previewRequestVersionRef.current[provider.id];
      }
    }
    previewRequestVersionRef.current = nextVersions;
  }, [providers]);

  const provider = providers.find((entry) => entry.id === selectedProvider);
  const additionalArgsText = provider ? (additionalArgsById[provider.id] ?? "") : "";
  const additionalArgs = useMemo(
    () => parseProviderAdditionalArgs(additionalArgsText),
    [additionalArgsText]
  );
  const showBase = isMobile ? mobileView === "base" : desktopView === "base";
  const showConfig = isMobile ? mobileView === "config" : desktopView === "config";
  const currentPreview = provider ? (previewByProvider[provider.id] ?? "") : "";
  const useFillHeightLayout = showConfig;

  useEffect(() => {
    onLayoutModeChange?.(useFillHeightLayout ? "fill-height" : "default");
  }, [onLayoutModeChange, useFillHeightLayout]);

  useEffect(() => {
    if (connectionStatus !== "connected") {
      return;
    }

    if (!provider) {
      return;
    }

    const version = (previewRequestVersionRef.current[provider.id] ?? 0) + 1;
    previewRequestVersionRef.current[provider.id] = version;
    let cancelled = false;

    const loadPreview = async () => {
      const result = await dispatch<{ preview: string }>("settings.previewCommand", {
        providerId: provider.id,
        config: { additionalArgs },
      });

      if (cancelled) {
        return;
      }

      if (previewRequestVersionRef.current[provider.id] !== version) {
        return;
      }

      setPreviewByProvider((previous) => ({
        ...previous,
        [provider.id]: result.ok && result.data ? result.data.preview : "Error loading preview",
      }));
    };

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [additionalArgs, additionalArgsText, connectionStatus, dispatch, provider]);

  useEffect(() => {
    if (!provider || !showConfig) {
      return;
    }

    setVisitedConfigProviders((previous) =>
      previous[provider.id] ? previous : { ...previous, [provider.id]: true }
    );
  }, [provider, showConfig]);

  const handleProviderSelect = (providerId: ProviderInfo["id"]) => {
    setSelectedProvider(providerId);
    if (isMobile) {
      setMobileView("base");
    }
  };

  const saveSettings = async (providerId: ProviderInfo["id"], nextValue: string) => {
    await dispatch("settings.update", {
      settings: {
        providers: {
          [providerId]: {
            additionalArgs: parseProviderAdditionalArgs(nextValue),
          },
        },
      },
    });
  };

  return (
    <div
      className={`settings-section ${useFillHeightLayout ? "settings-section--fill-height settings-provider-section--config-active" : ""}`}
    >
      <SegmentedControl
        aria-label={t("settings.providers")}
        className="settings-provider-tabs"
        onChange={(nextValue) => handleProviderSelect(nextValue as ProviderInfo["id"])}
        optionClassName="settings-provider-tab"
        options={providers.map((entry) => ({
          label: entry.displayName,
          value: entry.id,
        }))}
        value={selectedProvider}
      />

      {!isMobile ? (
        <SegmentedControl
          className="settings-provider-subnav"
          aria-label={t("settings.provider.config")}
          onChange={(nextValue) => setDesktopView(nextValue as ProviderDetailView)}
          optionClassName="settings-provider-subnav-button"
          options={[
            {
              label: t("settings.provider.base"),
              value: "base",
            },
            {
              label: t("settings.provider.config_file"),
              value: "config",
            },
          ]}
          value={desktopView}
        />
      ) : null}

      {provider && showBase ? (
        <div
          className={`settings-provider-content ${useFillHeightLayout ? "settings-provider-content--fill-height" : ""}`}
        >
          <div className="settings-group">
            <h3 className="settings-group-title">{t("settings.provider.config")}</h3>
            <p className="settings-group-desc">{t("settings.provider.startup_args_hint")}</p>
            <div className="settings-config-field">
              <label className="settings-config-label" htmlFor="provider-startup-args">
                {t("settings.provider.startup_args")}
              </label>
              <Textarea
                id="provider-startup-args"
                className="settings-provider-args-input"
                rows={4}
                placeholder={t("settings.provider.startup_args_placeholder")}
                value={additionalArgsText}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setAdditionalArgsById((previous) => ({
                    ...previous,
                    [provider.id]: nextValue,
                  }));
                  void saveSettings(provider.id, nextValue);
                }}
              />
            </div>
          </div>

          <div className="settings-group">
            <h3 className="settings-group-title">Command Preview</h3>
            <p className="settings-group-desc">Preview of the effective provider command</p>
            <div className="settings-config-field">
              <code className="settings-command-preview">{currentPreview}</code>
            </div>
          </div>

          {isMobile ? (
            <button
              type="button"
              className="settings-provider-mobile-entry"
              aria-label={t("settings.provider.open_config_file_editor")}
              onClick={() => setMobileView("config")}
            >
              <span className="settings-provider-mobile-entry__title">
                {t("settings.provider.open_config_file_editor")}
              </span>
              <span className="settings-provider-mobile-entry__meta">
                {provider.id === "codex"
                  ? t("settings.config_files.codex_config")
                  : t("settings.config_files.claude_config")}
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className={`settings-provider-config-stack ${useFillHeightLayout ? "settings-provider-config-stack--fill-height" : ""}`}
      >
        {providers
          .filter(
            (entry) => visitedConfigProviders[entry.id] || (provider?.id === entry.id && showConfig)
          )
          .map((entry) => {
            const visible = provider?.id === entry.id && showConfig;

            return (
              <div
                key={entry.id}
                className={`settings-provider-config-panel ${useFillHeightLayout ? "settings-provider-config-panel--fill-height" : ""} ${visible ? "" : "settings-provider-config-panel-hidden"}`}
                aria-hidden={!visible}
              >
                <div
                  className={`settings-provider-content ${useFillHeightLayout ? "settings-provider-content--fill-height" : ""}`}
                >
                  <div
                    className={`settings-group ${useFillHeightLayout ? "settings-group--fill-height" : ""}`}
                  >
                    {isMobile ? (
                      <div className="settings-provider-mobile-config-header">
                        <button
                          type="button"
                          className="settings-link"
                          onClick={() => setMobileView("base")}
                        >
                          {t("settings.provider.back_to_base")}
                        </button>
                      </div>
                    ) : null}
                    <h3 className="settings-group-title">{t("settings.config_files.title")}</h3>
                    <p className="settings-group-desc">
                      {entry.id === "codex"
                        ? t("settings.config_files.codex_config")
                        : t("settings.config_files.claude_config")}
                    </p>
                    <ConfigEditor
                      configType={entry.id as ConfigType}
                      visible={visible}
                      fillHeight={useFillHeightLayout}
                    />
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
