import type { UpdatePrepareInstallResponse, UpdateStateView } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { dispatchCommandAtom, serverInfoAtom } from "../../../atoms/connection";
import { Button, ConfirmDialog, Notice, StatusDot } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import { pushToastAtom } from "../../notifications";
import { updatePrepareInstallAtom, updateStateAtom } from "../../updates/atoms";

function formatTime(timestamp: number | null, locale: "zh" | "en"): string {
  if (!timestamp) {
    return locale === "zh" ? "未检查" : "Not checked";
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

const UPDATE_INTERVALS = [3600, 21600, 43200, 86400] as const;

interface AboutSettingsProps {
  autoCheckEnabled: boolean;
  checkIntervalSec: number;
  onAutoCheckEnabledChange: (value: boolean) => void;
  onCheckIntervalChange: (value: number) => void;
  locale: "zh" | "en";
}

export function AboutSettings({
  autoCheckEnabled,
  checkIntervalSec,
  onAutoCheckEnabledChange,
  onCheckIntervalChange,
  locale,
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

  const statusLabel = useMemo(() => {
    if (!updateState) {
      return t("settings.about.update_status_unknown");
    }
    switch (updateState.updateStatus) {
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
  }, [t, updateState]);

  const availabilityLabel = useMemo(() => {
    if (!updateState) {
      return t("settings.about.availability_unknown");
    }
    switch (updateState.availability) {
      case "unknown":
        return t("settings.about.availability_unknown");
      case "up_to_date":
        return t("settings.about.availability_up_to_date");
      case "update_available":
        return t("settings.about.availability_update_available");
      case "check_failed":
        return t("settings.about.availability_check_failed");
    }
  }, [t, updateState]);

  const handleCheck = async () => {
    setLoading("check");
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
      <div className="settings-group">
        <h3 className="settings-group-title">{t("settings.about.title")}</h3>
        <p className="settings-group-desc">{t("settings.about.description")}</p>

        <div className="settings-info-row">
          <span className="settings-info-label">{t("settings.about.product_name")}</span>
          <span className="settings-info-value">Coder Studio</span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">{t("settings.about.current_version")}</span>
          <span className="settings-info-value">v{serverInfo?.version ?? "0.0.0"}</span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">{t("settings.about.server_instance_id")}</span>
          <span className="settings-info-value">{serverInfo?.serverInstanceId ?? "-"}</span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">{t("settings.about.install_support")}</span>
          <span className="settings-info-value">
            {updateState?.supported
              ? t("settings.about.install_supported")
              : (updateState?.unsupportedReason ?? t("settings.about.install_unsupported"))}
          </span>
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">{t("settings.about.update_group")}</h3>
        <p className="settings-group-desc">{t("settings.about.update_group_hint")}</p>

        <div className="settings-info-row">
          <span className="settings-info-label">{t("settings.about.latest_version")}</span>
          <span className="settings-info-value">
            {updateState?.latestVersion ? `v${updateState.latestVersion}` : "-"}
          </span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">{t("settings.about.last_checked")}</span>
          <span className="settings-info-value">
            {formatTime(updateState?.lastCheckedAt ?? null, locale)}
          </span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">{t("settings.about.availability")}</span>
          <span className="settings-info-value">{availabilityLabel}</span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">{t("settings.about.update_status")}</span>
          <span className="settings-info-value settings-info-value--with-dot">
            <StatusDot tone={getStatusTone(updateState)} size="sm" />
            <span>{statusLabel}</span>
          </span>
        </div>

        {updateState?.errorSummary ? (
          <Notice
            tone={updateState.updateStatus === "manual_required" ? "warning" : "error"}
            title={t("settings.about.error_summary")}
            message={updateState.errorSummary}
          />
        ) : null}

        {updateState?.manualCommand ? (
          <Notice
            tone="warning"
            title={t("settings.about.manual_command")}
            message={updateState.manualCommand}
          />
        ) : null}

        <div className="settings-actions-row">
          <Button
            onClick={() => {
              void handleCheck();
            }}
            disabled={
              loading !== null ||
              updateState?.updateStatus === "installing" ||
              updateState?.updateStatus === "restarting"
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
              !updateState?.supported ||
              updateState?.availability !== "update_available" ||
              updateState.updateStatus === "installing" ||
              updateState.updateStatus === "restarting" ||
              Boolean(updateState.manualCommand)
            }
          >
            {loading === "install" || loading === "prepare"
              ? t("settings.about.installing")
              : t("settings.about.update_now")}
          </Button>
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">{t("settings.about.auto_check_group")}</h3>
        <p className="settings-group-desc">{t("settings.about.auto_check_group_hint")}</p>

        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label">{t("settings.about.auto_check_enabled")}</span>
            <span className="settings-toggle-desc">
              {t("settings.about.auto_check_enabled_hint")}
            </span>
          </div>
          <Button
            variant={autoCheckEnabled ? "secondary" : "ghost"}
            onClick={() => onAutoCheckEnabledChange(!autoCheckEnabled)}
          >
            {autoCheckEnabled ? t("common.enabled") : t("common.disabled")}
          </Button>
        </div>

        <div className="settings-info-row">
          <span className="settings-info-label">{t("settings.about.check_interval")}</span>
          <div className="settings-actions-row">
            {UPDATE_INTERVALS.map((value) => (
              <Button
                key={value}
                variant={checkIntervalSec === value ? "secondary" : "ghost"}
                onClick={() => onCheckIntervalChange(value)}
                disabled={!autoCheckEnabled}
              >
                {t(`settings.about.interval_${value}`)}
              </Button>
            ))}
          </div>
        </div>
      </div>

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
