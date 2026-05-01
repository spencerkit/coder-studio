import { useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import {
  supervisorDialogAtom,
} from '../../features/supervisor/atoms';
import {
  ObjectiveDialogContent,
  ObjectiveDialogModeIcon,
} from '../../features/supervisor/components/objective-dialog-content';
import { SupervisorCard } from '../../features/supervisor/components/supervisor-card';
import {
  type ObjectiveDialogEvaluatorProviderId,
  type ObjectiveDialogMode,
  useObjectiveDialogState,
} from '../../features/supervisor/hooks/use-objective-dialog-state';
import { MobileSheet } from './mobile-sheet';

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
  const [detailMode, setDetailMode] = useState<ObjectiveDialogMode | null>(null);
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
      draftObjective: supervisor?.objective ?? '',
      draftEvaluatorProviderId:
        (supervisor?.evaluatorProviderId as ObjectiveDialogEvaluatorProviderId) ??
        'claude',
    });
    setDetailMode(nextMode);
  };

  if (detailMode) {
    return (
      <MobileSheet
        title={copy.title}
        kicker="Supervisor"
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
            />
          </div>
        }
        footer={
          <div className="mobile-supervisor-sheet__footer">
            <button
              className="btn btn-secondary"
              onClick={() => {
                close();
                setDetailMode(null);
              }}
            >
              取消
            </button>
            <button
              className={`btn ${isDisable ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => {
                void confirm();
              }}
              disabled={!isDisable && !dialog.draftObjective.trim()}
            >
              {copy.confirm}
            </button>
          </div>
        }
      />
    );
  }

  return (
    <MobileSheet
      title="Supervisor"
      kicker="Supervisor"
      onClose={onClose}
      contentClassName="mobile-supervisor-sheet mobile-supervisor-sheet--root"
      body={
        <div className="mobile-supervisor-sheet__root">
          {supervisor ? (
            <>
              <SupervisorCard sessionId={sessionId} workspaceId={workspaceId} />
              <div className="mobile-supervisor-sheet__actions">
                <button className="btn btn-secondary" onClick={() => openDetail('edit')}>
                  编辑目标
                </button>
                <button className="btn btn-secondary" onClick={() => openDetail('disable')}>
                  禁用 Supervisor
                </button>
              </div>
            </>
          ) : (
            <div className="mobile-supervisor-sheet__empty">
              <h3>Supervisor</h3>
              <p>Supervisor 未启用</p>
              <button className="btn btn-primary" onClick={() => openDetail('enable')}>
                启用目标
              </button>
            </div>
          )}
        </div>
      }
    />
  );
}
