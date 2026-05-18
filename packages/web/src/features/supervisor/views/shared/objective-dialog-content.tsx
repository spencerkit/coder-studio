import { useId } from "react";
import {
  DateTimePicker,
  Input,
  Select,
  type SelectOption,
  Textarea,
  ThemedIcon,
} from "../../../../components/ui";
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
  draftEvaluatorModel: string;
  draftMaxSupervisionCount: string;
  draftScheduledAt: string;
  isMaxSupervisionCountValid: boolean;
  disableObjective: string;
  onDraftObjectiveChange: (value: string) => void;
  onDraftEvaluatorProviderChange: (value: ObjectiveDialogEvaluatorProviderId) => void;
  onDraftEvaluatorModelChange: (value: string) => void;
  onDraftMaxSupervisionCountChange: (value: string) => void;
  onDraftScheduledAtChange: (value: string) => void;
}

export function ObjectiveDialogModeIcon({ mode }: { mode: ObjectiveDialogMode }) {
  if (mode === "enable") return <ThemedIcon semantic="supervisor.mode.enable" size={14} />;
  if (mode === "edit") return <ThemedIcon semantic="supervisor.mode.edit" size={14} />;
  return <ThemedIcon semantic="supervisor.mode.disable" size={14} />;
}

export function ObjectiveDialogContent({
  mode,
  draftObjective,
  draftEvaluatorProviderId,
  draftEvaluatorModel,
  draftMaxSupervisionCount,
  draftScheduledAt,
  isMaxSupervisionCountValid,
  disableObjective,
  onDraftObjectiveChange,
  onDraftEvaluatorProviderChange,
  onDraftEvaluatorModelChange,
  onDraftMaxSupervisionCountChange,
  onDraftScheduledAtChange,
}: ObjectiveDialogContentProps) {
  const t = useTranslation();
  const objectiveHelperId = useId();
  const evaluatorLabelId = useId();
  const evaluatorHelperId = useId();
  const evaluatorModelHelperId = useId();
  const maxSupervisionCountHelperId = useId();
  const scheduledAtHelperId = useId();
  const introTitle = t(`supervisor.dialog.${mode}.title`);
  const introDescription = t(`supervisor.dialog.${mode}.subtitle`);

  if (mode === "disable") {
    return (
      <>
        <div className="supervisor-danger-callout" role="alert">
          <ThemedIcon
            aria-hidden="true"
            className="supervisor-danger-callout-icon"
            semantic="state.warning"
            size={16}
          />
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
      <div className="supervisor-dialog-intro">
        <div className="supervisor-dialog-intro__icon" aria-hidden="true">
          <ObjectiveDialogModeIcon mode={mode} />
        </div>
        <div className="supervisor-dialog-intro__copy">
          <p className="supervisor-dialog-intro__title">{introTitle}</p>
          <p className="supervisor-dialog-intro__description">{introDescription}</p>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="objective">{t("supervisor.field.objective")}</label>
        <Textarea
          id="objective"
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
        <label id={evaluatorLabelId} htmlFor="evaluator-provider">
          {t("supervisor.field.evaluator")}
        </label>
        <Select
          id="evaluator-provider"
          size="sm"
          desktopMode="listbox"
          mobileSheetTitle={t("supervisor.field.evaluator")}
          mobileSheetPresentation="inline"
          options={evaluatorOptions}
          value={draftEvaluatorProviderId}
          aria-labelledby={evaluatorLabelId}
          aria-describedby={evaluatorHelperId}
          onValueChange={onDraftEvaluatorProviderChange}
        />
        <span id={evaluatorHelperId} className="dialog-helper">
          {t("supervisor.field.evaluator_helper")}
        </span>
      </div>

      <div className="form-group">
        <label htmlFor="evaluator-model">{t("supervisor.field.evaluator_model")}</label>
        <Input
          id="evaluator-model"
          size="sm"
          value={draftEvaluatorModel}
          onChange={(event) => onDraftEvaluatorModelChange(event.target.value)}
          aria-describedby={evaluatorModelHelperId}
          placeholder={t("supervisor.field.evaluator_model_placeholder")}
        />
        <span id={evaluatorModelHelperId} className="dialog-helper">
          {t("supervisor.field.evaluator_model_helper")}
        </span>
      </div>

      <div className="form-group">
        <label htmlFor="max-supervision-count">{t("supervisor.field.max_supervision_count")}</label>
        <Input
          id="max-supervision-count"
          size="sm"
          type="number"
          min={0}
          step={1}
          value={draftMaxSupervisionCount}
          onChange={(event) => onDraftMaxSupervisionCountChange(event.target.value)}
          invalid={!isMaxSupervisionCountValid}
          aria-invalid={!isMaxSupervisionCountValid}
          aria-describedby={maxSupervisionCountHelperId}
        />
        <span id={maxSupervisionCountHelperId} className="dialog-helper">
          {t("supervisor.field.max_supervision_count_helper")}
        </span>
      </div>

      <div className="form-group">
        <label htmlFor="scheduled-at">{t("supervisor.field.scheduled_at")}</label>
        <DateTimePicker
          label={t("supervisor.field.scheduled_at")}
          size="sm"
          value={draftScheduledAt}
          onValueChange={onDraftScheduledAtChange}
          placeholder={t("supervisor.field.scheduled_at_placeholder")}
          clearable
          minDate={new Date()}
          aria-describedby={scheduledAtHelperId}
        />
        <span id={scheduledAtHelperId} className="dialog-helper">
          {t("supervisor.field.scheduled_at_helper")}
        </span>
      </div>
    </>
  );
}
