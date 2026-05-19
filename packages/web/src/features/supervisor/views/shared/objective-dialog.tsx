import { X } from "lucide-react";
import {
  Button,
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
  const { dialog, isVisible, mode, copy, isMaxSupervisionCountValid, close, updateDraft, confirm } =
    useObjectiveDialogState({ workspaceId, sessionId });

  if (!isVisible || viewport === "mobile") {
    return null;
  }

  return (
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
          draftObjective={dialog.draftObjective}
          draftEvaluatorProviderId={dialog.draftEvaluatorProviderId}
          draftEvaluatorModel={dialog.draftEvaluatorModel}
          draftMaxSupervisionCount={dialog.draftMaxSupervisionCount}
          draftScheduledAt={dialog.draftScheduledAt}
          isMaxSupervisionCountValid={isMaxSupervisionCountValid}
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
        />
      </ModalBody>

      <ModalFooter>
        <Button onClick={close}>{t("action.cancel")}</Button>
        <Button
          variant="primary"
          onClick={() => {
            void confirm();
          }}
          disabled={!dialog.draftObjective.trim() || !isMaxSupervisionCountValid}
        >
          {copy.confirm}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
