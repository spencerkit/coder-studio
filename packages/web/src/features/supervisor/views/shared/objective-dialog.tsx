import { X } from "lucide-react";
import { useState } from "react";
import {
  Button,
  ConfirmDialog,
  DialogHeader,
  IconButton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalTitle,
} from "../../../../components/ui";
import { useViewport } from "../../../../hooks/use-viewport";
import { useTranslation } from "../../../../lib/i18n";
import { useObjectiveDialogState } from "../../actions/use-objective-dialog-state";
import { ObjectiveDialogContent, ObjectiveDialogModeIcon } from "./objective-dialog-content";

interface ObjectiveDialogProps {
  workspaceId: string;
  sessionId?: string;
}

export function ObjectiveDialog({ workspaceId, sessionId }: ObjectiveDialogProps) {
  const viewport = useViewport();
  const t = useTranslation();
  const {
    dialog,
    isVisible,
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
  const [isSaveConfirmOpen, setIsSaveConfirmOpen] = useState(false);

  if (!isVisible || viewport === "mobile") {
    return null;
  }

  const isRestoreMode = restoreStep === "restore";
  const isSaveDisabled =
    mode === "edit"
      ? !hasChanges || !dialog.draftObjective.trim() || !isMaxSupervisionCountValid
      : !dialog.draftObjective.trim() || !isMaxSupervisionCountValid;

  return (
    <>
      <Modal className={`supervisor-dialog supervisor-dialog--${mode}`} onOpenChange={close} open>
        <DialogHeader>
          <div className="dialog-header__leading">
            <span className="dialog-header__icon supervisor-dialog-header-icon" aria-hidden="true">
              <ObjectiveDialogModeIcon mode={mode} />
            </span>
            <div className="dialog-header__copy">
              <ModalTitle>{copy.title}</ModalTitle>
            </div>
          </div>
          <IconButton
            aria-label={t("action.close")}
            className="modal-close"
            icon={<X size={14} />}
            onClick={close}
            size="sm"
          />
        </DialogHeader>

        <ModalBody>
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
            onDraftEvaluatorModelChange={(draftEvaluatorModel) =>
              updateDraft({ draftEvaluatorModel })
            }
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
        </ModalBody>

        <ModalFooter>
          <Button onClick={close}>{t("action.cancel")}</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (mode === "edit" && !isRestoreMode && hasObjectiveChanged) {
                setIsSaveConfirmOpen(true);
                return;
              }
              void confirm();
            }}
            disabled={
              isRestoreMode
                ? !selectedRecoverableTargetId ||
                  isRecoverableTargetsLoading ||
                  !isMaxSupervisionCountValid
                : isSaveDisabled
            }
          >
            {copy.confirm}
          </Button>
        </ModalFooter>
      </Modal>

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
          void confirm();
        }}
      />
    </>
  );
}
