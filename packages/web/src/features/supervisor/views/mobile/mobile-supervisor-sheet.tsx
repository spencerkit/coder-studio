import { useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { Button, Sheet } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  formatScheduledAtInput,
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
  defaultSupervisorDetailsOpen?: boolean;
}

export function MobileSupervisorSheet({
  sessionId,
  workspaceId,
  onClose,
  defaultSupervisorDetailsOpen = false,
}: MobileSupervisorSheetProps) {
  const t = useTranslation();
  const [detailMode, setDetailMode] = useState<ObjectiveDialogMode | null>(null);
  const setDialog = useSetAtom(supervisorDialogAtom);
  const {
    dialog,
    supervisor,
    mode,
    copy,
    isDisable,
    disableObjective,
    isMaxSupervisionCountValid,
    close,
    updateDraft,
    confirm,
  } = useObjectiveDialogState({ workspaceId, sessionId });

  useEffect(() => {
    if (supervisor || detailMode) {
      return;
    }

    setDialog((current) => {
      if (current.sessionId === sessionId && current.mode === "enable" && !current.open) {
        return current;
      }

      return {
        open: false,
        sessionId,
        mode: "enable",
        draftObjective:
          current.sessionId === sessionId && current.mode === "enable"
            ? current.draftObjective
            : "",
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
      };
    });
  }, [detailMode, sessionId, setDialog, supervisor]);

  useEffect(() => {
    if (!dialog.open || dialog.sessionId !== sessionId) {
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
      draftEvaluatorModel: supervisor?.evaluatorModel ?? "",
      draftMaxSupervisionCount: String(supervisor?.maxSupervisionCount ?? 0),
      draftScheduledAt: formatScheduledAtInput(supervisor?.scheduledAt),
    });
    setDetailMode(nextMode);
  };

  const detailBody = (
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
        draftEvaluatorModel={dialog.draftEvaluatorModel}
        draftMaxSupervisionCount={dialog.draftMaxSupervisionCount}
        draftScheduledAt={dialog.draftScheduledAt}
        isMaxSupervisionCountValid={isMaxSupervisionCountValid}
        disableObjective={disableObjective}
        onDraftObjectiveChange={(draftObjective) => updateDraft({ draftObjective })}
        onDraftEvaluatorProviderChange={(draftEvaluatorProviderId) =>
          updateDraft({ draftEvaluatorProviderId })
        }
        onDraftEvaluatorModelChange={(draftEvaluatorModel) => updateDraft({ draftEvaluatorModel })}
        onDraftMaxSupervisionCountChange={(draftMaxSupervisionCount) =>
          updateDraft({ draftMaxSupervisionCount })
        }
        onDraftScheduledAtChange={(draftScheduledAt) => updateDraft({ draftScheduledAt })}
      />
    </div>
  );

  const detailFooter = (
    <div className="mobile-supervisor-sheet__footer">
      <Button
        onClick={() => {
          close();
          setDetailMode(null);
          if (!supervisor) {
            onClose();
          }
        }}
      >
        {t("action.cancel")}
      </Button>
      <Button
        variant={isDisable ? "danger" : "primary"}
        onClick={() => {
          void (async () => {
            const ok = await confirm();
            if (ok && !supervisor) {
              onClose();
            }
          })();
        }}
        disabled={!isDisable && !dialog.draftObjective.trim()}
      >
        {copy.confirm}
      </Button>
    </div>
  );

  if (detailMode) {
    return (
      <Sheet
        title={copy.title}
        kicker={t("supervisor.title")}
        onBack={() => {
          close();
          setDetailMode(null);
        }}
        onClose={() => {
          close();
          setDetailMode(null);
          onClose();
        }}
        bodyClassName="mobile-sheet__body--supervisor-detail"
        contentClassName="mobile-supervisor-sheet mobile-supervisor-sheet--detail"
        fullscreen
        body={detailBody}
        footer={detailFooter}
      />
    );
  }

  if (!supervisor) {
    return (
      <Sheet
        title={copy.title}
        kicker={t("supervisor.title")}
        onClose={() => {
          close();
          onClose();
        }}
        bodyClassName="mobile-sheet__body--supervisor-detail"
        contentClassName="mobile-supervisor-sheet mobile-supervisor-sheet--detail"
        fullscreen
        body={detailBody}
        footer={detailFooter}
      />
    );
  }

  return (
    <Sheet
      title={t("supervisor.title")}
      kicker={t("supervisor.title")}
      onClose={onClose}
      contentClassName="mobile-supervisor-sheet mobile-supervisor-sheet--root"
      fullscreen
      body={
        <div className="mobile-supervisor-sheet__root">
          {supervisor ? (
            <>
              <SupervisorCard
                sessionId={sessionId}
                workspaceId={workspaceId}
                defaultDetailsOpen={defaultSupervisorDetailsOpen}
              />
              <div className="mobile-supervisor-sheet__actions">
                <Button onClick={() => openDetail("edit")}>
                  {t("supervisor.action.edit_objective")}
                </Button>
                <Button onClick={() => openDetail("disable")}>
                  {t("supervisor.action.disable")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      }
    />
  );
}
