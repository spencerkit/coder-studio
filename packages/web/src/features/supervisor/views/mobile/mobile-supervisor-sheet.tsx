import { useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { supervisorDialogAtom } from '../../atoms';
import { useTranslation } from '../../../../lib/i18n';
import { MobileSelectSheet } from '../../../mobile-select';
import {
  ObjectiveDialogContent,
  ObjectiveDialogModeIcon,
} from '../shared/objective-dialog-content';
import { SupervisorCard } from '../shared/supervisor-card';
import {
  OBJECTIVE_DIALOG_EVALUATOR_OPTIONS,
  type ObjectiveDialogEvaluatorProviderId,
  type ObjectiveDialogMode,
  useObjectiveDialogState,
} from '../../actions/use-objective-dialog-state';
import { MobileSheet } from '../../../workspace/views/mobile/mobile-sheet';

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
      setDetailMode(null);
      setEvaluatorPickerOpen(false);
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
    setEvaluatorPickerOpen(false);
    setDetailMode(nextMode);
  };

  if (detailMode && evaluatorPickerOpen) {
    return (
      <MobileSelectSheet
        title={t('supervisor.field.evaluator')}
        sections={[
          {
            kind: 'options',
            id: 'evaluator-providers',
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
    );
  }

  if (detailMode) {
    return (
      <MobileSheet
        title={copy.title}
        kicker={t('supervisor.title')}
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
                onOpen: () => setEvaluatorPickerOpen(true),
                isMobile: true,
              }}
            />
          </div>
        }
        footer={
          <div className="mobile-supervisor-sheet__footer">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setEvaluatorPickerOpen(false);
                close();
                setDetailMode(null);
              }}
            >
              {t('action.cancel')}
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
      title={t('supervisor.title')}
      kicker={t('supervisor.title')}
      onClose={onClose}
      contentClassName="mobile-supervisor-sheet mobile-supervisor-sheet--root"
      body={
        <div className="mobile-supervisor-sheet__root">
          {supervisor ? (
            <>
              <SupervisorCard sessionId={sessionId} workspaceId={workspaceId} />
              <div className="mobile-supervisor-sheet__actions">
                <button className="btn btn-secondary" onClick={() => openDetail('edit')}>
                  {t('supervisor.action.edit_objective')}
                </button>
                <button className="btn btn-secondary" onClick={() => openDetail('disable')}>
                  {t('supervisor.action.disable')}
                </button>
              </div>
            </>
          ) : (
            <div className="mobile-supervisor-sheet__empty">
              <h3>{t('supervisor.title')}</h3>
              <p>{t('supervisor.empty')}</p>
              <button className="btn btn-primary" onClick={() => openDetail('enable')}>
                {t('supervisor.action.enable_objective')}
              </button>
            </div>
          )}
        </div>
      }
    />
  );
}
