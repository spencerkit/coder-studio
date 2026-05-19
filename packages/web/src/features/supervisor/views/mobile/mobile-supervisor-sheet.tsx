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
import { useSupervisorDetails } from "../../actions/use-supervisor-details";
import { supervisorDialogAtom } from "../../atoms";
import { ObjectiveDialogContent } from "../shared/objective-dialog-content";
import { SupervisorCard } from "../shared/supervisor-card";
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
  const [detailMode, setDetailMode] = useState<ObjectiveDialogMode | "details" | null>(null);
  const setDialog = useSetAtom(supervisorDialogAtom);
  const { closeDetails, openDetails } = useSupervisorDetails(sessionId);
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

  const openDetailsView = () => {
    openDetails(sessionId);
    setDetailMode("details");
  };

  const detailBody = (
    <div className="mobile-supervisor-sheet__detail">
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

  const detailsBody =
    supervisor && detailMode === "details" ? (
      <div className="mobile-supervisor-sheet__detail">
        <SupervisorDetailsContent
          sessionId={sessionId}
          workspaceId={workspaceId}
          onEdit={() => {
            closeDetails();
            openDetail("edit");
          }}
        />
      </div>
    ) : null;

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
            if (!ok) {
              return;
            }

            closeDetails();
            setDetailMode(null);

            if (!supervisor) {
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
        title={detailMode === "details" ? t("supervisor.dialog.details.title") : copy.title}
        kicker={t("supervisor.title")}
        onBack={
          detailMode === "details"
            ? () => {
                closeDetails();
                setDetailMode(null);
              }
            : () => {
                close();
                setDetailMode(supervisor ? "details" : null);
              }
        }
        onClose={() => {
          close();
          closeDetails();
          setDetailMode(null);
          onClose();
        }}
        bodyClassName="mobile-sheet__body--supervisor-detail"
        contentClassName="mobile-supervisor-sheet mobile-supervisor-sheet--detail"
        fullscreen
        body={detailMode === "details" ? detailsBody : detailBody}
        footer={detailMode === "details" ? undefined : detailFooter}
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
              <SupervisorCard sessionId={sessionId} workspaceId={workspaceId} />
              <div className="mobile-supervisor-sheet__actions">
                <Button onClick={openDetailsView}>{t("supervisor.action.details")}</Button>
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
