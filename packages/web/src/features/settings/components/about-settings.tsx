import type { ProductUpdatePreparation, ProductUpdateState } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useId, useMemo, useState } from "react";
import { serverInfoAtom } from "../../../atoms/connection";
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
import {
  productUpdateStateAtom,
  updateControllerAtom,
  updatePreparationAtom,
} from "../../updates/atoms";
import type { UpdateController } from "../../updates/types";

const UPDATE_INTERVALS = [3600, 21600, 43200, 86400] as const;

export type AboutSettingsView = "all" | "product" | "update-status" | "auto-update";
export type ProductUpdatePrimaryAction = "check" | "download" | "cancel" | "prepare" | "retry";

interface AboutSettingsProps {
  autoCheckEnabled: boolean;
  checkIntervalSec: number;
  onAutoCheckEnabledChange: (value: boolean) => void;
  onCheckIntervalChange: (value: number) => void;
  locale: "zh" | "en";
  view?: AboutSettingsView;
}

export function formatReleaseTime(
  value: string | null,
  locale: "zh" | "en",
  unknownLabel: string
): string {
  if (!value) return unknownLabel;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return unknownLabel;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatCheckTime(value: number | null, locale: "zh" | "en", empty: string): string {
  if (value === null) return empty;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function primaryActionFor(
  state: ProductUpdateState,
  controller: UpdateController
): ProductUpdatePrimaryAction | null {
  if (controller.kind === "readonly" || !state.runtimeContext.supported) return null;
  if (state.status === "idle" || state.status === "succeeded") return "check";
  if (state.status === "available") return controller.kind === "desktop" ? "download" : "prepare";
  if (state.status === "downloading") return controller.kind === "desktop" ? "cancel" : null;
  if (state.status === "ready") return "prepare";
  if (state.status === "failed" && controller.kind === "desktop") return "retry";
  return null;
}

function statusTone(
  status: ProductUpdateState["status"] | undefined
): "neutral" | "info" | "warning" | "success" | "error" {
  if (status === "checking" || status === "downloading" || status === "restarting") return "info";
  if (status === "ready" || status === "manual_required") return "warning";
  if (status === "succeeded") return "success";
  if (status === "failed") return "error";
  return "neutral";
}

function componentLabel(component: ProductUpdateState["components"][number]): string {
  if (component.kind === "shell") return "Shell";
  if (component.kind === "runtime")
    return component.target ? `Runtime (${component.target})` : "Runtime";
  return "CLI";
}

function versionTransition(component: ProductUpdateState["components"][number]): string {
  const target = component.targetVersion ? ` → v${component.targetVersion}` : "";
  return `${componentLabel(component)} v${component.currentVersion}${target}`;
}

function environmentGuidance(
  state: ProductUpdateState,
  controller: UpdateController
): string | null {
  if (state.runtimeContext.environment === "desktop-wsl") return "settings.about.wsl_managed";
  if (controller.kind === "readonly" && state.runtimeContext.environment === "desktop-managed") {
    return "settings.about.managed_in_desktop";
  }
  if (controller.kind === "readonly") return "settings.about.readonly_mismatch";
  return null;
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
  const serverInfo = useAtomValue(serverInfoAtom);
  const updateState = useAtomValue(productUpdateStateAtom);
  const updateController = useAtomValue(updateControllerAtom);
  const setPreparation = useSetAtom(updatePreparationAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const [confirmState, setConfirmState] = useState<ProductUpdatePreparation | null>(null);
  const [loading, setLoading] = useState<ProductUpdatePrimaryAction | "start" | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const autoCheckLabelId = useId();
  const autoCheckDescId = useId();
  const checkIntervalLabelId = useId();
  const showProduct = view === "all" || view === "product";
  const showUpdateStatus = view === "all" || view === "update-status";
  const showAutoUpdate = view === "all" || view === "auto-update";
  const readOnly = !updateController || updateController.kind === "readonly";
  const primaryAction =
    updateState && updateController ? primaryActionFor(updateState, updateController) : null;
  const guidanceKey =
    updateState && updateController ? environmentGuidance(updateState, updateController) : null;

  const intervalOptions = useMemo(
    () =>
      UPDATE_INTERVALS.map((value) => ({
        disabled: !autoCheckEnabled || readOnly,
        label: t(`settings.about.interval_${value}`),
        value: String(value),
      })),
    [autoCheckEnabled, readOnly, t]
  );

  const statusLabel = updateState
    ? t(`settings.about.product_status_${updateState.status}`)
    : t("settings.about.update_status_unknown");
  const targetVersion = updateState?.components.find(
    (component) => component.kind === "runtime" || component.kind === "cli"
  )?.targetVersion;
  const progress = updateState?.components
    .map((component) => component.progressPercent)
    .filter((value): value is number => value !== null)
    .reduce<number | null>((current, value) => Math.max(current ?? 0, value), null);

  const actionLabel = (action: ProductUpdatePrimaryAction): string => {
    if (action === "check") return t("settings.about.check_now");
    if (action === "download") return t("settings.about.download_update");
    if (action === "cancel") return t("settings.about.cancel_download");
    if (action === "retry") return t("settings.about.retry_update");
    return t(
      updateController?.kind === "cli"
        ? "settings.about.update_and_restart"
        : "settings.about.restart_and_update"
    );
  };

  const showError = (title: string, error: unknown) => {
    pushToast({
      kind: "error",
      title,
      body: error instanceof Error ? error.message : String(error),
    });
  };

  const startPrepared = async (prepared: ProductUpdatePreparation, force: boolean) => {
    if (!updateController) return;
    setLoading("start");
    try {
      await updateController.start(prepared, force);
      setConfirmState(null);
    } catch (error) {
      showError(t("settings.about.update_now"), error);
    } finally {
      setLoading(null);
    }
  };

  const runPrimaryAction = async () => {
    if (!primaryAction || !updateController) return;
    setLoading(primaryAction);
    try {
      if (primaryAction === "check") await updateController.check();
      if (primaryAction === "download") await updateController.download();
      if (primaryAction === "cancel") await updateController.cancelDownload();
      if (primaryAction === "retry") await updateController.retry();
      if (primaryAction === "prepare") {
        const prepared = await updateController.prepare();
        setPreparation(prepared);
        if (prepared.activity.hasActiveWork) {
          setConfirmState(prepared);
        } else {
          await updateController.start(prepared, false);
        }
      }
    } catch (error) {
      showError(
        primaryAction === "check"
          ? t("settings.about.check_failed")
          : t("settings.about.update_now"),
        error
      );
    } finally {
      setLoading(null);
    }
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
            <span className="settings-info-value" data-testid="product-version">
              v{updateState?.productVersion ?? serverInfo?.version ?? "0.0.0"}
            </span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.product_release_time")}</span>
            <span className="settings-info-value" data-testid="product-release-time">
              {formatReleaseTime(
                updateState?.productPublishedAt ?? null,
                locale,
                t("settings.about.release_time_unknown")
              )}
            </span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.server_instance_id")}</span>
            <span className="settings-info-value">{serverInfo?.serverInstanceId ?? "-"}</span>
          </div>
          {guidanceKey ? <Notice tone="info" message={t(guidanceKey)} /> : null}
        </div>
      ) : null}

      {showUpdateStatus ? (
        <div className="settings-group">
          <h3 className="settings-group-title">{t("settings.about.update_group")}</h3>
          <p className="settings-group-desc">{t("settings.about.unified_update_group_hint")}</p>
          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.latest_version")}</span>
            <span className="settings-info-value">{targetVersion ? `v${targetVersion}` : "-"}</span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.last_checked")}</span>
            <span className="settings-info-value">
              {formatCheckTime(
                updateState?.lastCheckedAt ?? null,
                locale,
                t("settings.about.availability_unknown")
              )}
            </span>
          </div>
          <div className="settings-info-row">
            <span className="settings-info-label">{t("settings.about.update_status")}</span>
            <span className="settings-info-value settings-info-value--with-dot">
              <StatusDot tone={statusTone(updateState?.status)} size="sm" />
              <span>{statusLabel}</span>
            </span>
          </div>
          {progress !== null ? (
            <div className="settings-info-row">
              <span className="settings-info-label">{t("settings.about.progress")}</span>
              <span className="settings-info-value">{progress}%</span>
            </div>
          ) : null}
          {updateState && !updateState.compatibility.compatible ? (
            <Notice
              tone="error"
              title={t("settings.about.compatibility_error")}
              message={updateState.compatibility.summary ?? updateState.compatibility.code ?? "-"}
            />
          ) : null}
          {updateState?.errorSummary ? (
            <Notice
              tone={updateState.status === "manual_required" ? "warning" : "error"}
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

          {primaryAction ? (
            <div
              className="settings-actions-row settings-actions-row--end"
              data-testid="update-primary-actions"
            >
              <Button
                disabled={loading !== null}
                loading={loading !== null}
                onClick={() => void runPrimaryAction()}
              >
                {actionLabel(primaryAction)}
              </Button>
            </div>
          ) : null}

          {updateState ? (
            <div className="settings-actions-row">
              <Button variant="ghost" onClick={() => setDiagnosticsOpen((open) => !open)}>
                {t("settings.about.component_diagnostics")}
              </Button>
            </div>
          ) : null}
          {updateState && diagnosticsOpen ? (
            <div data-testid="update-component-diagnostics">
              {updateState.components.map((component) => (
                <div className="settings-info-row" key={component.id}>
                  <span className="settings-info-value">
                    {versionTransition(component)}
                    {component.progressPercent !== null ? ` · ${component.progressPercent}%` : ""}
                    {component.errorSummary ? ` · ${component.errorSummary}` : ""}
                  </span>
                </div>
              ))}
              <p>
                {t("settings.about.authority")}: {updateState.runtimeContext.authority}
              </p>
              <p>
                {t("settings.about.environment")}: {updateState.runtimeContext.environment}
              </p>
              <p>
                {t("settings.about.plan_id")}: {updateState.planId ?? "-"}
              </p>
              {updateState.diagnostics.shellBuiltAt ? (
                <p>
                  {t("settings.about.shell_built_at")}: {updateState.diagnostics.shellBuiltAt}
                </p>
              ) : null}
              {updateState.diagnostics.engineVersion ? (
                <p>
                  {t("settings.about.engine_abi")}: {updateState.diagnostics.engineVersion}
                </p>
              ) : null}
              {updateState.diagnostics.nodeVersion ? (
                <p>Node: {updateState.diagnostics.nodeVersion}</p>
              ) : null}
              {updateState.diagnostics.failedPhase ? (
                <p>
                  {t("settings.about.failed_phase")}: {updateState.diagnostics.failedPhase}
                </p>
              ) : null}
              {updateState.diagnostics.recoveryAction ? (
                <p>
                  {t("settings.about.recovery_action")}: {updateState.diagnostics.recoveryAction}
                </p>
              ) : null}
              {updateState.diagnostics.logLocations.map((location) => (
                <p key={location}>{location}</p>
              ))}
            </div>
          ) : null}
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
              disabled={readOnly}
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
            if (!open) setConfirmState(null);
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
          cancelText={t("settings.about.restart_later")}
          confirmDisabled={loading !== null}
          confirmText={t("settings.about.restart_and_update")}
          tone="danger"
          onConfirm={() => void startPrepared(confirmState, true)}
        />
      ) : null}
    </div>
  );
}
