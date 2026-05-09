import { useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { Button, Sheet } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { MobileSelectSheet } from "../../../mobile-select";
import {
  OBJECTIVE_DIALOG_EVALUATOR_OPTIONS,
  type ObjectiveDialogEvaluatorProviderId,
  type ObjectiveDialogMode,
  useObjectiveDialogState,
} from "../../actions/use-objective-dialog-state";
import { supervisorDialogAtom } from "../../atoms";
import {
  ObjectiveDialogContent,
  ObjectiveDialogModeIcon,
} from "../shared/objective-dialog-content";
import { SupervisorCard } from "../shared/supervisor-card";

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
  const [detailMode, setDetailMode] = useState<ObjectiveDialogMode | null>(null);
  const [evaluatorPickerOpen, setEvaluatorPickerOpen] = useState(false);
  const setDialog = useSetAtom(supervisorDialogAtom);
  const {
    dialog,
    supervisor,
    mode,
    copy,
    isDisable,
    disableObjective,
    close,
    updateDraft,
    confirm,
  } = useObjectiveDialogState({ workspaceId, sessionId });

  useEffect(() => {
    if (!dialog.open || dialog.sessionId !== sessionId) {
      setEvaluatorPickerOpen(false);
      setDetailMode(null);
      return;
    }

    setDetailMode(dialog.mode);
  }, [dialog.mode, dialog.open, dialog.sessionId, sessionId]);

  const openDetail = (nextMode: ObjectiveDialogMode) => {
    setDialog({
      open: true,
      sessionId,
      mode: nextMode,
      draftObjective: supervisor?.objective ?? "",
      draftEvaluatorProviderId:
        (supervisor?.evaluatorProviderId as ObjectiveDialogEvaluatorProviderId) ?? "claude",
    });
    setDetailMode(nextMode);
  };

  if (detailMode) {
    return (
      <Sheet
        title={copy.title}
        kicker={t("supervisor.title")}
        onBack={() => {
          setEvaluatorPickerOpen(false);
          close();
          setDetailMode(null);
        }}
        onClose={() => {
          setEvaluatorPickerOpen(false);
          close();
          setDetailMode(null);
          onClose();
        }}
        bodyClassName="mobile-sheet__body--supervisor-detail"
        contentClassName="mobile-supervisor-sheet mobile-supervisor-sheet--detail"
        body={
          <div className="mobile-supervisor-sheet__detail">
            <div className="mobile-supervisor-sheet__detail-header">
              <span className="supervisor-dialog-header-icon" aria-hidden="true">
                <ObjectiveDialogModeIcon mode={mode} />
              </span>
              <div>
                <h3>{copy.title}</h3>
                <p>{copy.subtitle}</p>
              </div>
            </div>
            <ObjectiveDialogContent
              mode={mode}
              draftObjective={dialog.draftObjective}
              draftEvaluatorProviderId={dialog.draftEvaluatorProviderId}
              disableObjective={disableObjective}
              onDraftObjectiveChange={(draftObjective) => updateDraft({ draftObjective })}
              onDraftEvaluatorProviderChange={(draftEvaluatorProviderId) =>
                updateDraft({ draftEvaluatorProviderId })
              }
              mobileEvaluatorPicker={{
                isMobile: true,
                onOpen: () => setEvaluatorPickerOpen(true),
              }}
            />
            {evaluatorPickerOpen ? (
              <MobileSelectSheet
                title={t("supervisor.field.evaluator")}
                presentation="inline"
                sections={[
                  {
                    kind: "options",
                    id: "evaluator-providers",
                    items: OBJECTIVE_DIALOG_EVALUATOR_OPTIONS.map((option) => ({
                      id: option.id,
                      label: option.label,
                    })),
                  },
                ]}
                selectedId={dialog.draftEvaluatorProviderId}
                onBack={() => setEvaluatorPickerOpen(false)}
                onClose={() => setEvaluatorPickerOpen(false)}
                onSelect={(id) => {
                  updateDraft({
                    draftEvaluatorProviderId: id as ObjectiveDialogEvaluatorProviderId,
                  });
                  setEvaluatorPickerOpen(false);
                }}
              />
            ) : null}
          </div>
        }
        footer={
          <div className="mobile-supervisor-sheet__footer">
            <Button
              onClick={() => {
                setEvaluatorPickerOpen(false);
                close();
                setDetailMode(null);
              }}
            >
              {t("action.cancel")}
            </Button>
            <Button
              variant={isDisable ? "danger" : "primary"}
              onClick={() => {
                void confirm();
              }}
              disabled={!isDisable && !dialog.draftObjective.trim()}
            >
              {copy.confirm}
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <Sheet
      title={t("supervisor.title")}
      kicker={t("supervisor.title")}
      onClose={onClose}
      contentClassName="mobile-supervisor-sheet mobile-supervisor-sheet--root"
      body={
        <div className="mobile-supervisor-sheet__root">
          {supervisor ? (
            <>
              <SupervisorCard sessionId={sessionId} workspaceId={workspaceId} />
              <div className="mobile-supervisor-sheet__actions">
                <Button onClick={() => openDetail("edit")}>
                  {t("supervisor.action.edit_objective")}
                </Button>
                <Button onClick={() => openDetail("disable")}>
                  {t("supervisor.action.disable")}
                </Button>
              </div>
            </>
          ) : (
            <div className="mobile-supervisor-sheet__empty">
              <h3>{t("supervisor.title")}</h3>
              <p>{t("supervisor.empty")}</p>
              <Button variant="primary" onClick={() => openDetail("enable")}>
                {t("supervisor.action.enable_objective")}
              </Button>
            </div>
          )}
        </div>
      }
    />
  );
}
