import { X } from "lucide-react";
import {
  Button,
  IconButton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
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
    copy,
    isDisable,
    disableObjective,
    isMaxSupervisionCountValid,
    close,
    updateDraft,
    confirm,
  } = useObjectiveDialogState({ workspaceId, sessionId });

  if (!isVisible || viewport === "mobile") {
    return null;
  }

  return (
    <Modal className={`supervisor-dialog supervisor-dialog--${mode}`} onOpenChange={close} open>
      <ModalHeader>
        <div className="supervisor-dialog-header">
          <span className="supervisor-dialog-header-icon" aria-hidden="true">
            <ObjectiveDialogModeIcon mode={mode} />
          </span>
          <div>
            <ModalTitle>{copy.title}</ModalTitle>
            <span className="supervisor-dialog-subtitle">{copy.subtitle}</span>
          </div>
        </div>
        <IconButton
          aria-label={t("action.close")}
          icon={<X size={14} />}
          onClick={close}
          size="sm"
        />
      </ModalHeader>

      <ModalBody>
        <ObjectiveDialogContent
          mode={mode}
          draftObjective={dialog.draftObjective}
          draftEvaluatorProviderId={dialog.draftEvaluatorProviderId}
          draftEvaluatorModel={dialog.draftEvaluatorModel}
          draftMaxSupervisionCount={dialog.draftMaxSupervisionCount}
          draftScheduledAt={dialog.draftScheduledAt}
          isMaxSupervisionCountValid={isMaxSupervisionCountValid}
          disableObjective={disableObjective}
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
          variant={isDisable ? "danger" : "primary"}
          onClick={() => {
            void confirm();
          }}
          disabled={!isDisable && (!dialog.draftObjective.trim() || !isMaxSupervisionCountValid)}
        >
          {copy.confirm}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
