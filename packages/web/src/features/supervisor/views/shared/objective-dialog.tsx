import { X } from 'lucide-react';
import { useViewport } from '../../../../hooks/use-viewport';
import { useTranslation } from '../../../../lib/i18n';
import { useObjectiveDialogState } from '../../actions/use-objective-dialog-state';
import {
  ObjectiveDialogContent,
  ObjectiveDialogModeIcon,
} from './objective-dialog-content';

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
    close,
    updateDraft,
    confirm,
  } = useObjectiveDialogState({ workspaceId, sessionId });

  if (!isVisible || viewport === 'mobile') {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div
        className="modal-card supervisor-dialog"
        data-mode={mode}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="supervisor-dialog-header">
            <span className="supervisor-dialog-header-icon" aria-hidden="true">
              <ObjectiveDialogModeIcon mode={mode} />
            </span>
            <div>
              <h3>{copy.title}</h3>
              <span className="supervisor-dialog-subtitle">{copy.subtitle}</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={close} aria-label={t('action.close')}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
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

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={close}>
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
      </div>
    </div>
  );
}
