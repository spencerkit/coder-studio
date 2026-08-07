import type { UpdatePrepareInstallResponse, UpdateStateView } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useId, useMemo, useState } from "react";
import { dispatchCommandAtom, serverInfoAtom } from "../../../atoms/connection";
import {
  Button,
  ConfirmDialog,
  Notice,
  SegmentedControl,
  StatusDot,
  Switch,
} from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import { pushToastAtom } from "../../notifications";
import { updatePrepareInstallAtom, updateStateAtom } from "../../updates/atoms";

function formatTime(timestamp: number | null, locale: "zh" | "en", emptyLabel: string): string {
  if (!timestamp) {
    return emptyLabel;
  }
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function getStatusTone(
  state: UpdateStateView | null
): "neutral" | "info" | "warning" | "success" | "error" {
  if (!state) return "neutral";
  switch (state.updateStatus) {
    case "installing":
    case "restarting":
    case "checking":
      return "info";
    case "succeeded":
      return "success";
    case "manual_required":
      return "warning";
    case "failed":
      return "error";
    default:
      return "neutral";
  }
}

function mapDesktopRuntimeUpdateState(state: DesktopRuntimeUpdateState): UpdateStateView {
  const availability =
    state.status === "current"
      ? "up_to_date"
      : state.status === "ready"
        ? "update_available"
        : state.status === "error" || state.status === "quarantined"
          ? "check_failed"
          : "unknown";
  const updateStatus =
    state.status === "checking"
      ? "checking"
      : state.status === "error" || state.status === "quarantined"
        ? "failed"
        : "idle";
  return {
    version: 1,
    currentVersion: state.currentVersion,
    latestVersion: state.latestVersion,
    availability,
    updateStatus,
    lastCheckedAt: state.lastCheckedAt,
    targetVersion: state.pendingVersion,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: state.errorSummary,
    supported: state.supported,
    installKind: "unsupported",
    unsupportedReason: state.unsupportedReason,
  };
}

const UPDATE_INTERVALS = [3600, 21600, 43200, 86400] as const;

export type AboutSettingsView = "all" | "product" | "update-status" | "auto-update";

interface AboutSettingsProps {
  autoCheckEnabled: boolean;
  checkIntervalSec: number;
  onAutoCheckEnabledChange: (value: boolean) => void;
  onCheckIntervalChange: (value: number) => void;
  locale: "zh" | "en";
  view?: AboutSettingsView;
}

export function AboutSettings({
  autoCheckEnabled,
  checkIntervalSec,
  onAutoCheckEnabledChange,
  onCheckIntervalChange,
  locale,
  view = "all",
}: AboutSettingsProps) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const serverInfo = useAtomValue(serverInfoAtom);
  const updateState = useAtomValue(updateStateAtom);
  const setUpdateState = useSetAtom(updateStateAtom);
  const setUpdatePrepareInstall = useSetAtom(updatePrepareInstallAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const [confirmState, setConfirmState] = useState<UpdatePrepareInstallResponse | null>(null);
  const [loading, setLoading] = useState<null | "check" | "prepare" | "install">(null);
  const desktopApi = window.coderStudioDesktop;
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopRuntimeUpdateState | null>(
    null
  );
  const autoCheckLabelId = useId();
  const autoCheckDescId = useId();
  const checkIntervalLabelId = useId();
  const showProduct = view === "all" || view === "product";
  const showUpdateStatus = view === "all" || view === "update-status";
  const showAutoUpdate = view === "all" || view === "auto-update";
  const visibleUpdateState = desktopApi
    ? desktopUpdateState
      ? mapDesktopRuntimeUpdateState(desktopUpdateState)
      : null
    : updateState;

  useEffect(() => {
    if (!desktopApi) return;
    let disposed = false;
    const unsubscribe = desktopApi.onRuntimeUpdateStateChanged((state) => {
      if (!disposed) setDesktopUpdateState(state);
    });
    void desktopApi
      .getRuntimeUpdateState()
      .then((state) => {
        if (!disposed) setDesktopUpdateState(state);
      })
      .catch(() => {
        // A manual check will surface IPC failures to the user.
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [desktopApi]);

  const statusLabel = useMemo(() => {
    if (!visibleUpdateState) {
      return t("settings.about.update_status_unknown");
    }
    switch (visibleUpdateState.updateStatus) {
      case "idle":
        return t("settings.about.update_status_idle");
      case "checking":
        return t("settings.about.update_status_checking");
      case "installing":
        return t("settings.about.update_status_installing");
      case "restarting":
        return t("settings.about.update_status_restarting");
      case "succeeded":
        return t("settings.about.update_status_succeeded");
      case "failed":
        return t("settings.about.update_status_failed");
      case "manual_required":
        return t("settings.about.update_status_manual_required");
    }
  }, [t, visibleUpdateState]);

  const availabilityLabel = useMemo(() => {
    if (!visibleUpdateState) {
      return t("settings.about.availability_unknown");
    }
    switch (visibleUpdateState.availability) {
      case "unknown":
        return t("settings.about.availability_unknown");
      case "up_to_date":
        return t("settings.about.availability_up_to_date");
      case "update_available":
        return t("settings.about.availability_update_available");
      case "check_failed":
        return t("settings.about.availability_check_failed");
    }
  }, [t, visibleUpdateState]);

  const intervalOptions = useMemo(
    () =>
      UPDATE_INTERVALS.map((value) => ({
        disabled: !autoCheckEnabled,
        label: t(`settings.about.interval_${value}`),
        value: String(value),
      })),
    [autoCheckEnabled, t]
  );

  const handleCheck = async () => {
    setLoading("check");
    if (desktopApi) {
      try {
        const state = await desktopApi.checkRuntimeUpdate();
        setDesktopUpdateState(state);
        if (state.status === "error") {
          pushToast({
            kind: "error",
            title: t("settings.about.check_failed"),
            body: state.errorSummary ?? undefined,
          });
        }
      } catch (error) {
        pushToast({
          kind: "error",
          title: t("settings.about.check_failed"),
          body: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setLoading(null);
      }
      return;
    }
    const result = await dispatch<UpdateStateView>("updates.check", {});
    setLoading(null);
    if (!result.ok || !result.data) {
      pushToast({
        kind: "error",
        title: t("settings.about.check_failed"),
        body: result.error?.message,
      });
      return;
    }
    setUpdateState(result.data);
  };

  const handlePrepareInstall = async () => {
    setLoading("prepare");
    if (desktopApi) {
      try {
        const restarting = await desktopApi.restartForRuntimeUpdate();
        if (!restarting) {
          const state = await desktopApi.getRuntimeUpdateState();
          setDesktopUpdateState(state);
          pushToast({
            kind: "error",
            title: t("settings.about.update_now"),
            body: state.errorSummary ?? t("settings.about.install_unsupported"),
          });
        }
      } catch (error) {
        pushToast({
          kind: "error",
          title: t("settings.about.update_now"),
          body: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setLoading(null);
      }
      return;
    }
    const result = await dispatch<UpdatePrepareInstallResponse>("updates.prepareInstall", {});
    setLoading(null);
    if (!result.ok || !result.data) {
      pushToast({
        kind: "error",
        title: t("settings.about.update_now"),
        body: result.error?.message,
      });
      return;
    }
    setUpdatePrepareInstall(result.data);
    if (result.data.activity.hasActiveWork) {
      setConfirmState(result.data);
      return;
    }
    await handleStartInstall(result.data, false);
  };

  const handleStartInstall = async (prepared: UpdatePrepareInstallResponse, force: boolean) => {
    setLoading("install");
    const result = await dispatch<UpdateStateView>("updates.startInstall", {
      targetVersion: prepared.latestVersion ?? prepared.targetVersion ?? undefined,
      force,
    });
    setLoading(null);
    setConfirmState(null);
    if (!result.ok || !result.data) {
      pushToast({
        kind: "error",
        title: t("settings.about.update_now"),
        body: result.error?.message,
      });
      return;
    }
    setUpdateState(result.data);
  };

  return (
    <div className="settings-section" data-testid="about-settings">
      {showProduct ? (
        <div className="settings-group">
          <h3 className="settings-group-title">{t("settings.about.title")}</h3>
          <p className="settings-group-desc">{t("settings.about.description")}</p>

          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.product_name")}</span>
            <span className="settings-info-value">Coder Studio</span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.current_version")}</span>
            <span className="settings-info-value">
              v{visibleUpdateState?.currentVersion ?? serverInfo?.version ?? "0.0.0"}
            </span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.server_instance_id")}</span>
            <span className="settings-info-value">{serverInfo?.serverInstanceId ?? "-"}</span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.install_support")}</span>
            <span className="settings-info-value">
              {visibleUpdateState?.supported
                ? t("settings.about.install_supported")
                : (visibleUpdateState?.unsupportedReason ??
                  t("settings.about.install_unsupported"))}
            </span>
          </div>
        </div>
      ) : null}

      {showUpdateStatus ? (
        <div className="settings-group">
          <h3 className="settings-group-title">{t("settings.about.update_group")}</h3>
          <p className="settings-group-desc">{t("settings.about.update_group_hint")}</p>

          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.latest_version")}</span>
            <span className="settings-info-value">
              {visibleUpdateState?.latestVersion ? `v${visibleUpdateState.latestVersion}` : "-"}
            </span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.last_checked")}</span>
            <span className="settings-info-value">
              {formatTime(
                visibleUpdateState?.lastCheckedAt ?? null,
                locale,
                t("settings.about.availability_unknown")
              )}
            </span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.availability")}</span>
            <span className="settings-info-value">{availabilityLabel}</span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.update_status")}</span>
            <span className="settings-info-value settings-info-value--with-dot">
              <StatusDot tone={getStatusTone(visibleUpdateState)} size="sm" />
              <span>{statusLabel}</span>
            </span>
          </div>

          {visibleUpdateState?.errorSummary ? (
            <Notice
              tone={visibleUpdateState.updateStatus === "manual_required" ? "warning" : "error"}
              title={t("settings.about.error_summary")}
              message={visibleUpdateState.errorSummary}
            />
          ) : null}

          {visibleUpdateState?.manualCommand ? (
            <Notice
              tone="warning"
              title={t("settings.about.manual_command")}
              message={visibleUpdateState.manualCommand}
            />
          ) : null}

          <div className="settings-actions-row settings-actions-row--end">
            <Button
              onClick={() => {
                void handleCheck();
              }}
              disabled={
                loading !== null ||
                !visibleUpdateState?.supported ||
                visibleUpdateState.updateStatus === "checking" ||
                visibleUpdateState.updateStatus === "installing" ||
                visibleUpdateState.updateStatus === "restarting"
              }
            >
              {loading === "check" ? t("settings.about.checking") : t("settings.about.check_now")}
            </Button>
            <Button
              onClick={() => {
                void handlePrepareInstall();
              }}
              disabled={
                loading !== null ||
                !visibleUpdateState?.supported ||
                visibleUpdateState.availability !== "update_available" ||
                (Boolean(desktopApi) && !desktopUpdateState?.pendingVersion) ||
                visibleUpdateState.updateStatus === "checking" ||
                visibleUpdateState.updateStatus === "installing" ||
                visibleUpdateState.updateStatus === "restarting" ||
                Boolean(visibleUpdateState.manualCommand)
              }
            >
              {loading === "install" || loading === "prepare"
                ? t("settings.about.installing")
                : t("settings.about.update_now")}
            </Button>
          </div>
        </div>
      ) : null}

      {showAutoUpdate ? (
        <div className="settings-group">
          <div className="settings-toggle-row">
            <div className="settings-toggle-info">
              <span className="settings-toggle-label" id={autoCheckLabelId}>
                {t("settings.about.auto_check_enabled")}
              </span>
              <span className="settings-toggle-desc" id={autoCheckDescId}>
                {t("settings.about.auto_check_enabled_hint")}
              </span>
            </div>
            <Switch
              aria-describedby={autoCheckDescId}
              aria-labelledby={autoCheckLabelId}
              checked={autoCheckEnabled}
              className="settings-toggle"
              onCheckedChange={onAutoCheckEnabledChange}
            />
          </div>

          <div className="settings-info-row">
            <span className="settings-info-label" id={checkIntervalLabelId}>
              {t("settings.about.check_interval")}
            </span>
            <SegmentedControl
              aria-labelledby={checkIntervalLabelId}
              onChange={(nextValue) => onCheckIntervalChange(Number(nextValue))}
              options={intervalOptions}
              size="sm"
              value={String(checkIntervalSec)}
            />
          </div>
        </div>
      ) : null}

      {confirmState ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setConfirmState(null);
            }
          }}
          title={t("settings.about.confirm_update_title")}
          description={
            <div className="settings-dialog-copy">
              <p>{t("settings.about.confirm_update_message")}</p>
              <p>
                {t("settings.about.confirm_update_activity", {
                  terminals: confirmState.activity.runningTerminalCount,
                  sessions: confirmState.activity.runningSessionCount,
                  supervisors: confirmState.activity.runningSupervisorCount,
                })}
              </p>
            </div>
          }
          cancelText={t("action.cancel")}
          confirmText={t("settings.about.update_now")}
          tone="danger"
          onConfirm={() => {
            void handleStartInstall(confirmState, true);
          }}
        />
      ) : null}
    </div>
  );
}
