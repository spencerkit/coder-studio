import { useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { Button, ConfirmDialog, Sheet } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  formatScheduledAtInput,
  type ObjectiveDialogEvaluatorProviderId,
  useObjectiveDialogState,
} from "../../actions/use-objective-dialog-state";
import { useSupervisorDetails } from "../../actions/use-supervisor-details";
import { supervisorDialogAtom } from "../../atoms";
import { ObjectiveDialogContent } from "../shared/objective-dialog-content";
import { SupervisorDetailsContent } from "../shared/supervisor-details-content";

interface MobileSupervisorSheetProps {
  sessionId: string;
  workspaceId: string;
  onClose: () => void;
}

export function MobileSupervisorSheet({
  sessionId,
  workspaceId,
  onClose,
}: MobileSupervisorSheetProps) {
  const t = useTranslation();
  const setDialog = useSetAtom(supervisorDialogAtom);
  const { closeDetails } = useSupervisorDetails(sessionId);
  const {
    dialog,
    supervisor,
    mode,
    restoreStep,
    copy,
    isMaxSupervisionCountValid,
    recoverableTargets,
    selectedRecoverableTargetId,
    isRecoverableTargetsLoading,
    hasObjectiveChanged,
    hasChanges,
    close,
    updateDraft,
    openRestoreStep,
    closeRestoreStep,
    selectRecoverableTarget,
    confirm,
  } = useObjectiveDialogState({ workspaceId, sessionId });
  const [detailMode, setDetailMode] = useState<"details" | "edit" | null>(() =>
    supervisor ? "details" : null
  );
  const [isSaveConfirmOpen, setIsSaveConfirmOpen] = useState(false);

  useEffect(() => {
    if (supervisor) {
      setDetailMode((current) => current ?? "details");
      return;
    }

    setDetailMode((current) => (current === "details" ? null : current));

    setDialog((current) => {
      if (current.sessionId === sessionId && current.mode === "enable" && !current.open) {
        return current;
      }

      return {
        open: false,
        sessionId,
        mode: "enable",
        restoreStep: "form",
        returnToDetails: false,
        draftObjective:
          current.sessionId === sessionId && current.mode === "enable"
            ? current.draftObjective
            : "",
        initialObjective: "",
        draftEvaluatorProviderId:
          current.sessionId === sessionId && current.mode === "enable"
            ? current.draftEvaluatorProviderId
            : "claude",
        draftEvaluatorModel:
          current.sessionId === sessionId && current.mode === "enable"
            ? current.draftEvaluatorModel
            : "",
        draftMaxSupervisionCount:
          current.sessionId === sessionId && current.mode === "enable"
            ? current.draftMaxSupervisionCount
            : "0",
        draftScheduledAt:
          current.sessionId === sessionId && current.mode === "enable"
            ? current.draftScheduledAt
            : "",
        recoverableTargets: [],
        selectedRecoverableTargetId: null,
        isRecoverableTargetsLoading: false,
      };
    });
  }, [sessionId, setDialog, supervisor]);

  useEffect(() => {
    if (!dialog.open || dialog.sessionId !== sessionId) {
      return;
    }

    if (dialog.mode === "edit") {
      setDetailMode("edit");
    }
  }, [dialog.mode, dialog.open, dialog.sessionId, sessionId]);

  const openEdit = () => {
    setDialog({
      open: true,
      sessionId,
      mode: "edit",
      restoreStep: "form",
      returnToDetails: true,
      draftObjective: supervisor?.objective ?? "",
      initialObjective: supervisor?.objective ?? "",
      draftEvaluatorProviderId:
        (supervisor?.evaluatorProviderId as ObjectiveDialogEvaluatorProviderId) ?? "claude",
      draftEvaluatorModel: supervisor?.evaluatorModel ?? "",
      draftMaxSupervisionCount: String(supervisor?.maxSupervisionCount ?? 0),
      draftScheduledAt: formatScheduledAtInput(supervisor?.scheduledAt),
      recoverableTargets: [],
      selectedRecoverableTargetId: null,
      isRecoverableTargetsLoading: false,
    });
    setDetailMode("edit");
  };

  const detailBody = (
    <div className="mobile-supervisor-sheet__detail">
      <ObjectiveDialogContent
        mode={mode}
        restoreStep={restoreStep}
        draftObjective={dialog.draftObjective}
        draftEvaluatorProviderId={dialog.draftEvaluatorProviderId}
        draftEvaluatorModel={dialog.draftEvaluatorModel}
        draftMaxSupervisionCount={dialog.draftMaxSupervisionCount}
        draftScheduledAt={dialog.draftScheduledAt}
        isMaxSupervisionCountValid={isMaxSupervisionCountValid}
        recoverableTargets={recoverableTargets}
        selectedRecoverableTargetId={selectedRecoverableTargetId}
        isRecoverableTargetsLoading={isRecoverableTargetsLoading}
        onDraftObjectiveChange={(draftObjective) => updateDraft({ draftObjective })}
        onDraftEvaluatorProviderChange={(draftEvaluatorProviderId) =>
          updateDraft({ draftEvaluatorProviderId })
        }
        onDraftEvaluatorModelChange={(draftEvaluatorModel) => updateDraft({ draftEvaluatorModel })}
        onDraftMaxSupervisionCountChange={(draftMaxSupervisionCount) =>
          updateDraft({ draftMaxSupervisionCount })
        }
        onDraftScheduledAtChange={(draftScheduledAt) => updateDraft({ draftScheduledAt })}
        onOpenRestoreStep={() => {
          void openRestoreStep();
        }}
        onCloseRestoreStep={closeRestoreStep}
        onSelectRecoverableTarget={selectRecoverableTarget}
      />
    </div>
  );

  const detailsBody =
    supervisor && detailMode === "details" ? (
      <div className="mobile-supervisor-sheet__detail">
        <SupervisorDetailsContent
          sessionId={sessionId}
          workspaceId={workspaceId}
          onEdit={() => {
            closeDetails();
            openEdit();
          }}
        />
      </div>
    ) : null;

  const detailFooter = (
    <div className="mobile-supervisor-sheet__footer">
      <Button
        onClick={() => {
          close();
          if (supervisor) {
            setDetailMode("details");
          } else {
            setDetailMode(null);
            onClose();
          }
        }}
      >
        {t("action.cancel")}
      </Button>
      <Button
        variant="primary"
        onClick={() => {
          if (mode === "edit" && restoreStep !== "restore" && hasObjectiveChanged) {
            setIsSaveConfirmOpen(true);
            return;
          }

          void (async () => {
            const ok = await confirm();
            if (!ok) {
              return;
            }

            closeDetails();
            setDetailMode(supervisor ? "details" : null);
            onClose();
          })();
        }}
        disabled={
          restoreStep === "restore"
            ? !selectedRecoverableTargetId ||
              isRecoverableTargetsLoading ||
              !isMaxSupervisionCountValid
            : mode === "edit"
              ? !hasChanges || !dialog.draftObjective.trim() || !isMaxSupervisionCountValid
              : !dialog.draftObjective.trim() || !isMaxSupervisionCountValid
        }
      >
        {copy.confirm}
      </Button>
    </div>
  );

  if (supervisor && detailMode === "details") {
    return (
      <Sheet
        title={t("supervisor.dialog.details.title")}
        kicker={t("supervisor.title")}
        onClose={() => {
          close();
          closeDetails();
          setDetailMode("details");
          onClose();
        }}
        bodyClassName="mobile-sheet__body--supervisor-detail"
        contentClassName="mobile-supervisor-sheet mobile-supervisor-sheet--detail"
        fullscreen
        body={detailsBody}
      />
    );
  }

  return (
    <>
      <Sheet
        title={copy.title}
        kicker={t("supervisor.title")}
        onBack={
          supervisor && detailMode === "edit"
            ? () => {
                close();
                closeDetails();
                setDetailMode("details");
              }
            : undefined
        }
        onClose={() => {
          close();
          closeDetails();
          setDetailMode(supervisor ? "details" : null);
          onClose();
        }}
        bodyClassName="mobile-sheet__body--supervisor-detail"
        contentClassName="mobile-supervisor-sheet mobile-supervisor-sheet--detail"
        fullscreen
        body={detailBody}
        footer={detailFooter}
      />

      <ConfirmDialog
        open={isSaveConfirmOpen}
        onOpenChange={setIsSaveConfirmOpen}
        title={t("supervisor.dialog.edit.reset_confirm_title")}
        description={t("supervisor.dialog.edit.reset_confirm_description")}
        cancelText={t("action.cancel")}
        confirmText={t("supervisor.dialog.edit.confirm")}
        tone="danger"
        onConfirm={() => {
          setIsSaveConfirmOpen(false);
          void (async () => {
            const ok = await confirm();
            if (!ok) {
              return;
            }

            closeDetails();
            setDetailMode(supervisor ? "details" : null);
            onClose();
          })();
        }}
      />
    </>
  );
}
