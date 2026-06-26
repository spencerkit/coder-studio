import type { UpdatePrepareInstallResponse, UpdateStateView } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { Button, ConfirmDialog } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { pushToastAtom } from "../../../notifications";
import { updatePrepareInstallAtom, updateStateAtom } from "../../../updates/atoms";

function getSuccessVersion(state: UpdateStateView | null): string | null {
  if (!state || state.updateStatus !== "succeeded") {
    return null;
  }

  return state.targetVersion ?? state.latestVersion ?? state.currentVersion ?? null;
}

export function FooterUpdateRail() {
  const t = useTranslation();
  const navigate = useNavigate();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const updateState = useAtomValue(updateStateAtom);
  const setUpdateState = useSetAtom(updateStateAtom);
  const setUpdatePrepareInstall = useSetAtom(updatePrepareInstallAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const [confirmState, setConfirmState] = useState<UpdatePrepareInstallResponse | null>(null);
  const [loading, setLoading] = useState<false | "prepare" | "install">(false);
  const [successHidden, setSuccessHidden] = useState(false);

  const successVersion = getSuccessVersion(updateState);

  useEffect(() => {
    if (updateState?.updateStatus !== "succeeded") {
      setSuccessHidden(false);
      return;
    }

    setSuccessHidden(false);
    const timer = window.setTimeout(() => {
      setSuccessHidden(true);
    }, 3000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [successVersion, updateState?.updateStatus]);

  const handleStartInstall = async (prepared: UpdatePrepareInstallResponse, force: boolean) => {
    setLoading("install");
    const result = await dispatch<UpdateStateView>("updates.startInstall", {
      targetVersion: prepared.latestVersion ?? prepared.targetVersion ?? undefined,
      force,
    });
    setLoading(false);
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

  const handlePrepareInstall = async () => {
    setLoading("prepare");
    const result = await dispatch<UpdatePrepareInstallResponse>("updates.prepareInstall", {});
    setLoading(false);
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

  const openDetails = () => {
    navigate("/more/about/update-status");
  };

  if (!updateState) {
    return null;
  }

  const isDiscovery =
    updateState.availability === "update_available" && updateState.updateStatus === "idle";
  const isVisibleStatus =
    updateState.updateStatus === "installing" ||
    updateState.updateStatus === "restarting" ||
    updateState.updateStatus === "failed" ||
    updateState.updateStatus === "manual_required" ||
    (updateState.updateStatus === "succeeded" && !successHidden);

  if (!isDiscovery && !isVisibleStatus) {
    return null;
  }

  return (
    <>
      <div className="footer-update-rail" data-testid="footer-update-rail">
        {isDiscovery ? (
          <>
            <span className="footer-update-rail__text">
              {t("settings.about.footer_update_available", {
                version: updateState.latestVersion ? `v${updateState.latestVersion}` : "",
              })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="footer-update-rail__action"
              onClick={() => {
                void handlePrepareInstall();
              }}
              disabled={loading !== false}
            >
              {t("settings.about.update_now")}
            </Button>
          </>
        ) : null}

        {updateState.updateStatus === "installing" ? (
          <span className="footer-update-rail__text">{t("settings.about.footer_installing")}</span>
        ) : null}

        {updateState.updateStatus === "restarting" ? (
          <span className="footer-update-rail__text">{t("settings.about.footer_restarting")}</span>
        ) : null}

        {updateState.updateStatus === "failed" ? (
          <>
            <span className="footer-update-rail__text">{t("settings.about.footer_failed")}</span>
            <Button
              size="sm"
              variant="ghost"
              className="footer-update-rail__action"
              onClick={openDetails}
            >
              {t("settings.about.footer_view_details")}
            </Button>
          </>
        ) : null}

        {updateState.updateStatus === "manual_required" ? (
          <>
            <span className="footer-update-rail__text">
              {t("settings.about.footer_manual_required")}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="footer-update-rail__action"
              onClick={openDetails}
            >
              {t("settings.about.footer_view_details")}
            </Button>
          </>
        ) : null}

        {updateState.updateStatus === "succeeded" && !successHidden && successVersion ? (
          <span className="footer-update-rail__text">
            {t("settings.about.footer_succeeded", { version: `v${successVersion}` })}
          </span>
        ) : null}
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
    </>
  );
}
