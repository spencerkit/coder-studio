import { AlertTriangle, Eye, Pencil, PowerOff } from 'lucide-react';
import { useTranslation } from '../../../../lib/i18n';
import {
  OBJECTIVE_DIALOG_EVALUATOR_OPTIONS,
  type ObjectiveDialogEvaluatorProviderId,
  type ObjectiveDialogMode,
} from '../../actions/use-objective-dialog-state';

interface ObjectiveDialogContentProps {
  mode: ObjectiveDialogMode;
  draftObjective: string;
  draftEvaluatorProviderId: ObjectiveDialogEvaluatorProviderId;
  disableObjective: string;
  onDraftObjectiveChange: (value: string) => void;
  onDraftEvaluatorProviderChange: (value: ObjectiveDialogEvaluatorProviderId) => void;
}

export function ObjectiveDialogModeIcon({ mode }: { mode: ObjectiveDialogMode }) {
  if (mode === 'enable') return <Eye size={14} />;
  if (mode === 'edit') return <Pencil size={14} />;
  return <PowerOff size={14} />;
}

export function ObjectiveDialogContent({
  mode,
  draftObjective,
  draftEvaluatorProviderId,
  disableObjective,
  onDraftObjectiveChange,
  onDraftEvaluatorProviderChange,
}: ObjectiveDialogContentProps) {
  const t = useTranslation();

  if (mode === 'disable') {
    return (
      <>
        <div className="supervisor-danger-callout" role="alert">
          <AlertTriangle
            size={16}
            className="supervisor-danger-callout-icon"
            aria-hidden="true"
          />
          <div className="supervisor-danger-callout-copy">
            <strong>{t('supervisor.dialog.disable.warning_title')}</strong>
            <small>
              {t('supervisor.dialog.disable.warning_body')}
            </small>
          </div>
        </div>
        <div className="form-group">
          <label>{t('supervisor.field.current_objective')}</label>
          <pre className="objective-preview">{disableObjective}</pre>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="form-group">
        <label htmlFor="objective">{t('supervisor.field.objective')}</label>
        <textarea
          id="objective"
          className="input textarea"
          rows={5}
          value={draftObjective}
          onChange={(event) => onDraftObjectiveChange(event.target.value)}
          placeholder={t('supervisor.field.objective_placeholder')}
          autoFocus
        />
        <span className="dialog-helper">
          {t('supervisor.field.objective_helper')}
        </span>
      </div>

      <div className="form-group">
        <label htmlFor="evaluator-provider">{t('supervisor.field.evaluator')}</label>
        <select
          id="evaluator-provider"
          className="input"
          value={draftEvaluatorProviderId}
          onChange={(event) =>
            onDraftEvaluatorProviderChange(
              event.target.value as ObjectiveDialogEvaluatorProviderId
            )
          }
        >
          {OBJECTIVE_DIALOG_EVALUATOR_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="dialog-helper">
          {t('supervisor.field.evaluator_helper')}
        </span>
      </div>
    </>
  );
}
