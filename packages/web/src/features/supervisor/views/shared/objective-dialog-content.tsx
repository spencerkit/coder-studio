import { AlertTriangle, Eye, Pencil, PowerOff } from "lucide-react";
import { useId } from "react";
import { Select, type SelectOption, Textarea } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  OBJECTIVE_DIALOG_EVALUATOR_OPTIONS,
  type ObjectiveDialogEvaluatorProviderId,
  type ObjectiveDialogMode,
} from "../../actions/use-objective-dialog-state";

const evaluatorOptions: ReadonlyArray<SelectOption<ObjectiveDialogEvaluatorProviderId>> =
  OBJECTIVE_DIALOG_EVALUATOR_OPTIONS.map((option) => ({
    value: option.id,
    label: option.label,
  }));

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
  const objectiveHelperId = useId();
  const evaluatorLabelId = useId();
  const evaluatorHelperId = useId();

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
          size="lg"
          rows={5}
          value={draftObjective}
          onChange={(event) => onDraftObjectiveChange(event.target.value)}
          aria-describedby={objectiveHelperId}
          placeholder={t("supervisor.field.objective_placeholder")}
          autoFocus
        />
        <span id={objectiveHelperId} className="dialog-helper">
          {t("supervisor.field.objective_helper")}
        </span>
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
          <Select
            mobile
            id="evaluator-provider-trigger"
            options={evaluatorOptions}
            value={draftEvaluatorProviderId}
            aria-labelledby={evaluatorLabelId}
            aria-describedby={evaluatorHelperId}
            onOpen={mobileEvaluatorPicker.onOpen}
          />
        ) : (
          <Select
            id="evaluator-provider"
            options={evaluatorOptions}
            value={draftEvaluatorProviderId}
            aria-labelledby={evaluatorLabelId}
            aria-describedby={evaluatorHelperId}
            onValueChange={onDraftEvaluatorProviderChange}
          />
        )}
        <span id={evaluatorHelperId} className="dialog-helper">
          {t("supervisor.field.evaluator_helper")}
        </span>
      </div>
    </>
  );
}
