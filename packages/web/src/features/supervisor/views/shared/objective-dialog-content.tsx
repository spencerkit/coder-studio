import { AlertTriangle, ChevronDown, Eye, Pencil, PowerOff } from "lucide-react";
import { useId } from "react";
import { Textarea } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  OBJECTIVE_DIALOG_EVALUATOR_OPTIONS,
  type ObjectiveDialogEvaluatorProviderId,
  type ObjectiveDialogMode,
} from "../../actions/use-objective-dialog-state";

interface ObjectiveDialogContentProps {
  mode: ObjectiveDialogMode;
  draftObjective: string;
  draftEvaluatorProviderId: ObjectiveDialogEvaluatorProviderId;
  disableObjective: string;
  onDraftObjectiveChange: (value: string) => void;
  onDraftEvaluatorProviderChange: (value: ObjectiveDialogEvaluatorProviderId) => void;
  mobileEvaluatorPicker?: {
    onOpen: () => void;
    isMobile: boolean;
  };
}

export function ObjectiveDialogModeIcon({ mode }: { mode: ObjectiveDialogMode }) {
  if (mode === "enable") return <Eye size={14} />;
  if (mode === "edit") return <Pencil size={14} />;
  return <PowerOff size={14} />;
}

export function ObjectiveDialogContent({
  mode,
  draftObjective,
  draftEvaluatorProviderId,
  disableObjective,
  onDraftObjectiveChange,
  onDraftEvaluatorProviderChange,
  mobileEvaluatorPicker,
}: ObjectiveDialogContentProps) {
  const t = useTranslation();
  const evaluatorLabelId = useId();
  const evaluatorHelperId = useId();
  const evaluatorValueId = useId();
  const selectedEvaluatorLabel =
    OBJECTIVE_DIALOG_EVALUATOR_OPTIONS.find((option) => option.id === draftEvaluatorProviderId)
      ?.label ?? draftEvaluatorProviderId;

  if (mode === "disable") {
    return (
      <>
        <div className="supervisor-danger-callout" role="alert">
          <AlertTriangle size={16} className="supervisor-danger-callout-icon" aria-hidden="true" />
          <div className="supervisor-danger-callout-copy">
            <strong>{t("supervisor.dialog.disable.warning_title")}</strong>
            <small>{t("supervisor.dialog.disable.warning_body")}</small>
          </div>
        </div>
        <div className="form-group">
          <label>{t("supervisor.field.current_objective")}</label>
          <pre className="objective-preview">{disableObjective}</pre>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="form-group">
        <label htmlFor="objective">{t("supervisor.field.objective")}</label>
        <Textarea
          id="objective"
          rows={5}
          value={draftObjective}
          onChange={(event) => onDraftObjectiveChange(event.target.value)}
          placeholder={t("supervisor.field.objective_placeholder")}
          autoFocus
        />
        <span className="dialog-helper">{t("supervisor.field.objective_helper")}</span>
      </div>

      <div className="form-group">
        <label
          id={evaluatorLabelId}
          htmlFor={
            mobileEvaluatorPicker?.isMobile ? "evaluator-provider-trigger" : "evaluator-provider"
          }
        >
          {t("supervisor.field.evaluator")}
        </label>
        {mobileEvaluatorPicker?.isMobile ? (
          <>
            <button
              id="evaluator-provider-trigger"
              type="button"
              className="input mobile-select-trigger"
              aria-labelledby={`${evaluatorLabelId} ${evaluatorValueId}`}
              aria-describedby={evaluatorHelperId}
              aria-haspopup="dialog"
              onClick={mobileEvaluatorPicker.onOpen}
            >
              <span id={evaluatorValueId} className="mobile-select-trigger__value">
                {selectedEvaluatorLabel}
              </span>
              <ChevronDown size={16} className="mobile-select-trigger__icon" aria-hidden="true" />
            </button>
          </>
        ) : (
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
        )}
        <span id={evaluatorHelperId} className="dialog-helper">
          {t("supervisor.field.evaluator_helper")}
        </span>
      </div>
    </>
  );
}
