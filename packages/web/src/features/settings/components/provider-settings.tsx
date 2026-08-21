import type {
  ProviderListItem,
  ProviderRuntimeStatusEntry,
  ProviderRuntimeStatusResponse,
} from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { activationStatusAtom } from "../../../atoms/activation";
import { connectionStatusAtom } from "../../../atoms/connection";
import { Button, Notice, SegmentedControl, Tag, Textarea } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import { buildDiagnosticsPath } from "../../diagnostics/navigation";
import { ConfigEditor, type ConfigType } from "./config-editor";
import { useSessionGateDispatch } from "./use-session-gate-dispatch";

export interface ProviderInfo {
  id: string;
  displayName: string;
  badge?: string;
  kind?: ProviderListItem["kind"];
  stability?: ProviderListItem["stability"];
  capability?: ProviderListItem["capability"];
  capabilities?: ProviderListItem["capabilities"];
}

interface ProviderSettingsProps {
  providers: ProviderInfo[];
  additionalArgsById: Record<string, string>;
  setAdditionalArgsById: Dispatch<SetStateAction<Record<string, string>>>;
  isMobile: boolean;
  activeWorkspaceId?: string | null;
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

function supportsConfigEditor(provider: ProviderInfo | undefined): provider is ProviderInfo & {
  id: ConfigType;
} {
  return provider?.id === "claude" || provider?.id === "codex";
}

export function ProviderSettings({
  providers,
  additionalArgsById,
  setAdditionalArgsById,
  isMobile,
  activeWorkspaceId,
  onLayoutModeChange,
}: ProviderSettingsProps) {
  const t = useTranslation();
  const navigate = useNavigate();
  const dispatch = useSessionGateDispatch();
  const activationStatus = useAtomValue(activationStatusAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const commandPreviewTitle = t("settings.provider.command_preview_title");
  const commandPreviewHint = t("settings.provider.command_preview_hint");
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo["id"]>(
    providers[0]?.id ?? "claude"
  );
  const [desktopView, setDesktopView] = useState<ProviderDetailView>("base");
  const [mobileView, setMobileView] = useState<ProviderDetailView>("base");
  const [previewByProvider, setPreviewByProvider] = useState<Record<string, string>>(() =>
    createProviderRecord(providers, () => "")
  );
  const [runtimeByProvider, setRuntimeByProvider] = useState<
    Record<string, ProviderRuntimeStatusEntry | null>
  >(() => createProviderRecord(providers, () => null));
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

    setRuntimeByProvider((previous) => {
      const next = createProviderRecord(providers, () => null);
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
  const runtime = provider ? runtimeByProvider[provider.id] : null;
  const additionalArgsText = provider ? (additionalArgsById[provider.id] ?? "") : "";
  const additionalArgs = useMemo(
    () => parseProviderAdditionalArgs(additionalArgsText),
    [additionalArgsText]
  );
  const showBase = isMobile ? mobileView === "base" : desktopView === "base";
  const showConfig = isMobile ? mobileView === "config" : desktopView === "config";
  const currentPreview = provider ? (previewByProvider[provider.id] ?? "") : "";
  const useFillHeightLayout = showConfig;
  const providerSupportsConfigEditor = supportsConfigEditor(provider);
  const providerBadge = provider?.badge ?? provider?.displayName ?? "";
  const providerCapabilitySummary = provider?.capability
    ? t(`settings.provider.capability_${provider.capability}`)
    : null;
  const providerStabilitySummary = provider?.stability
    ? t(`agent_panes.provider_stability_${provider.stability}`)
    : null;
  const providerCapabilitiesSummary =
    provider?.capabilities
      ?.filter((capability) => capability.supported)
      .map((capability) => capability.label) ?? [];

  useEffect(() => {
    onLayoutModeChange?.(useFillHeightLayout ? "fill-height" : "default");
  }, [onLayoutModeChange, useFillHeightLayout]);

  useEffect(() => {
    if (providerSupportsConfigEditor) {
      return;
    }

    if (desktopView === "config") {
      setDesktopView("base");
    }

    if (mobileView === "config") {
      setMobileView("base");
    }
  }, [desktopView, mobileView, providerSupportsConfigEditor]);

  useEffect(() => {
    if (connectionStatus !== "connected" || activationStatus !== "active") {
      return;
    }

    let cancelled = false;

    const loadRuntimeStatus = async () => {
      const result = await dispatch<ProviderRuntimeStatusResponse>("provider.runtimeStatus", {});
      if (cancelled || result === null || !result.ok || !result.data) {
        return;
      }
      const providersData = result.data.providers ?? {};

      setRuntimeByProvider((previous) => {
        const next = { ...previous };

        for (const entry of providers) {
          next[entry.id] = providersData[entry.id] ?? null;
        }

        return next;
      });
    };

    void loadRuntimeStatus();

    return () => {
      cancelled = true;
    };
  }, [activationStatus, connectionStatus, dispatch, providers]);

  useEffect(() => {
    if (connectionStatus !== "connected" || activationStatus !== "active") {
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

      if (cancelled || result === null) {
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
  }, [activationStatus, additionalArgs, additionalArgsText, connectionStatus, dispatch, provider]);

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

  const providerGuideMessage =
    runtime && !runtime.available ? runtime.manualGuideKeys.map((key) => t(key)).join(" ") : "";
  const providerStatusTitle =
    provider && runtime
      ? runtime.available
        ? t("diagnostics.checks.provider_runtime_ready.title", {
            provider: provider.displayName,
          })
        : t("diagnostics.checks.provider_cli_missing.title", {
            provider: provider.displayName,
          })
      : "";
  const providerStatusDescription =
    provider && runtime
      ? runtime.available
        ? t("diagnostics.checks.provider_runtime_ready.description", {
            provider: provider.displayName,
          })
        : t("diagnostics.checks.provider_cli_missing.description", {
            provider: provider.displayName,
          })
      : "";

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

      {!isMobile && providerSupportsConfigEditor ? (
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
          <div className="settings-provider-base-layout">
            <div className="settings-group">
              <h3 className="settings-group-title">{provider.displayName}</h3>
              <div className="settings-provider-badges">
                <Tag color="neutral">{providerBadge}</Tag>
                {providerCapabilitySummary ? (
                  <Tag color="neutral">{providerCapabilitySummary}</Tag>
                ) : null}
                {providerStabilitySummary ? (
                  <Tag color="neutral">{providerStabilitySummary}</Tag>
                ) : null}
              </div>
              {providerCapabilitiesSummary.length > 0 ? (
                <p className="settings-group-desc">
                  {t("agent_panes.provider_capabilities")}: {providerCapabilitiesSummary.join(", ")}
                </p>
              ) : null}
            </div>

            {runtime ? (
              <div className="settings-group">
                <h3 className="settings-group-title">{t("settings.provider.status")}</h3>
                <Notice
                  tone={runtime.available ? "success" : "warning"}
                  title={providerStatusTitle}
                  message={
                    providerGuideMessage
                      ? `${providerStatusDescription} ${providerGuideMessage}`
                      : providerStatusDescription
                  }
                  action={
                    <div className="settings-provider-actions">
                      {runtime.docUrls.provider ? (
                        <Button
                          as="a"
                          href={runtime.docUrls.provider}
                          rel="noreferrer"
                          size="sm"
                          target="_blank"
                          variant="ghost"
                        >
                          {t("provider.install.open_docs")}
                        </Button>
                      ) : null}
                      <Button
                        onClick={() =>
                          navigate(
                            buildDiagnosticsPath({
                              context: "manual_check",
                              workspaceId: activeWorkspaceId ?? undefined,
                              providerId: provider.id,
                            })
                          )
                        }
                        size="sm"
                        variant="ghost"
                      >
                        {t("diagnostics.actions.open_diagnostics")}
                      </Button>
                    </div>
                  }
                />
              </div>
            ) : null}

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
              <h3 className="settings-group-title">{commandPreviewTitle}</h3>
              <p className="settings-group-desc">{commandPreviewHint}</p>
              <div className="settings-config-field">
                <code className="settings-command-preview">{currentPreview}</code>
              </div>
            </div>
          </div>

          {isMobile && providerSupportsConfigEditor ? (
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
          .filter((entry) => supportsConfigEditor(entry))
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
