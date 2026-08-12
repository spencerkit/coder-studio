import type { ProductUpdatePreparation } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, ConfirmDialog } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { pushToastAtom } from "../../../notifications";
import {
  productUpdateStateAtom,
  updateControllerAtom,
  updatePreparationAtom,
} from "../../../updates/atoms";

export function FooterUpdateRail() {
  const t = useTranslation();
  const navigate = useNavigate();
  const updateState = useAtomValue(productUpdateStateAtom);
  const updateController = useAtomValue(updateControllerAtom);
  const setPreparation = useSetAtom(updatePreparationAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const [confirmState, setConfirmState] = useState<ProductUpdatePreparation | null>(null);
  const [loading, setLoading] = useState(false);

  if (!updateState || !updateController || updateController.kind === "readonly") return null;
  if (
    updateState.status !== "available" &&
    updateState.status !== "ready" &&
    updateState.status !== "failed" &&
    updateState.status !== "manual_required"
  ) {
    return null;
  }

  const showError = (error: unknown) => {
    pushToast({
      kind: "error",
      title: t("settings.about.update_now"),
      body: error instanceof Error ? error.message : String(error),
    });
  };

  const start = async (prepared: ProductUpdatePreparation, force: boolean) => {
    setLoading(true);
    try {
      await updateController.start(prepared, force);
      setConfirmState(null);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  const prepare = async () => {
    setLoading(true);
    try {
      const prepared = await updateController.prepare();
      setPreparation(prepared);
      if (prepared.activity.hasActiveWork) setConfirmState(prepared);
      else await updateController.start(prepared, false);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  const runAction = async () => {
    if (updateState.status === "manual_required") {
      navigate("/more/about/update-status");
      return;
    }
    setLoading(true);
    try {
      if (updateState.status === "available") {
        if (updateController.kind === "desktop") await updateController.download();
        else await prepare();
      } else if (updateState.status === "ready") {
        await prepare();
      } else if (updateState.status === "failed") {
        if (updateController.kind === "desktop") await updateController.retry();
        else navigate("/more/about/update-status");
      }
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  const actionLabel =
    updateState.status === "manual_required"
      ? t("settings.about.footer_view_details")
      : updateState.status === "available"
        ? t(
            updateController.kind === "desktop"
              ? "settings.about.download_update"
              : "settings.about.update_and_restart"
          )
        : updateState.status === "ready"
          ? t("settings.about.restart_and_update")
          : updateController.kind === "desktop"
            ? t("settings.about.retry_update")
            : t("settings.about.footer_view_details");

  const targetVersion = updateState.components.find(
    (component) => component.targetVersion
  )?.targetVersion;

  return (
    <>
      <div className="footer-update-rail" data-testid="footer-update-rail">
        <span className="footer-update-rail__text">
          {updateState.status === "available"
            ? t("settings.about.footer_update_available", {
                version: targetVersion ? `v${targetVersion}` : "",
              })
            : t(`settings.about.product_status_${updateState.status}`)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="footer-update-rail__action"
          disabled={loading}
          onClick={() => void runAction()}
        >
          {actionLabel}
        </Button>
      </div>
      {confirmState ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmState(null);
          }}
          title={t("settings.about.confirm_update_title")}
          description={t("settings.about.confirm_update_activity", {
            terminals: confirmState.activity.runningTerminalCount,
            sessions: confirmState.activity.runningSessionCount,
            supervisors: confirmState.activity.runningSupervisorCount,
          })}
          cancelText={t("settings.about.restart_later")}
          confirmText={t("settings.about.restart_and_update")}
          tone="danger"
          onConfirm={() => void start(confirmState, true)}
        />
      ) : null}
    </>
  );
}
