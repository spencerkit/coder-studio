import { useAtomValue } from "jotai";
import { useId } from "react";
import { localeAtom } from "../../../../atoms/app-ui";
import {
  DateTimePicker,
  EmptyState,
  Input,
  Select,
  type SelectOption,
  Spinner,
  Textarea,
  ThemedIcon,
} from "../../../../components/ui";
import { formatDate, useTranslation } from "../../../../lib/i18n";
import {
  OBJECTIVE_DIALOG_EVALUATOR_OPTIONS,
  type ObjectiveDialogEvaluatorProviderId,
  type ObjectiveDialogMode,
} from "../../actions/use-objective-dialog-state";
import type { RecoverableSupervisorTarget, SupervisorDialogRestoreStep } from "../../atoms";

const evaluatorOptions: ReadonlyArray<SelectOption<ObjectiveDialogEvaluatorProviderId>> =
  OBJECTIVE_DIALOG_EVALUATOR_OPTIONS.map((option) => ({
    value: option.id,
    label: option.label,
  }));

interface ObjectiveDialogContentProps {
  mode: ObjectiveDialogMode;
  showIntro?: boolean;
  restoreStep: SupervisorDialogRestoreStep;
  draftObjective: string;
  draftEvaluatorProviderId: ObjectiveDialogEvaluatorProviderId;
  draftEvaluatorModel: string;
  draftMaxSupervisionCount: string;
  draftScheduledAt: string;
  isMaxSupervisionCountValid: boolean;
  recoverableTargets: RecoverableSupervisorTarget[];
  selectedRecoverableTargetId: string | null;
  isRecoverableTargetsLoading: boolean;
  onDraftObjectiveChange: (value: string) => void;
  onDraftEvaluatorProviderChange: (value: ObjectiveDialogEvaluatorProviderId) => void;
  onDraftEvaluatorModelChange: (value: string) => void;
  onDraftMaxSupervisionCountChange: (value: string) => void;
  onDraftScheduledAtChange: (value: string) => void;
  onOpenRestoreStep: () => void;
  onCloseRestoreStep: () => void;
  onSelectRecoverableTarget: (value: string) => void;
}

export function ObjectiveDialogModeIcon({ mode }: { mode: ObjectiveDialogMode }) {
  if (mode === "enable") return <ThemedIcon semantic="supervisor.mode.enable" size={14} />;
  return <ThemedIcon semantic="supervisor.mode.edit" size={14} />;
}

export function ObjectiveDialogContent({
  mode,
  showIntro = false,
  restoreStep,
  draftObjective,
  draftEvaluatorProviderId,
  draftEvaluatorModel,
  draftMaxSupervisionCount,
  draftScheduledAt,
  isMaxSupervisionCountValid,
  recoverableTargets,
  selectedRecoverableTargetId,
  isRecoverableTargetsLoading,
  onDraftObjectiveChange,
  onDraftEvaluatorProviderChange,
  onDraftEvaluatorModelChange,
  onDraftMaxSupervisionCountChange,
  onDraftScheduledAtChange,
  onOpenRestoreStep,
  onCloseRestoreStep,
  onSelectRecoverableTarget,
}: ObjectiveDialogContentProps) {
  const t = useTranslation();
  const locale = useAtomValue(localeAtom);
  const objectiveHelperId = useId();
  const evaluatorLabelId = useId();
  const evaluatorHelperId = useId();
  const evaluatorModelHelperId = useId();
  const maxSupervisionCountHelperId = useId();
  const scheduledAtHelperId = useId();
  const introTitle = t(`supervisor.dialog.${mode}.title`);
  const introDescription = t(`supervisor.dialog.${mode}.subtitle`);
  const isRestoreView = restoreStep === "restore";

  if (isRestoreView) {
    return (
      <div className="supervisor-restore-view">
        <div className="supervisor-dialog-intro">
          <div className="supervisor-dialog-intro__icon" aria-hidden="true">
            <ObjectiveDialogModeIcon mode={mode} />
          </div>
          <div className="supervisor-dialog-intro__copy">
            <p className="supervisor-dialog-intro__title">{t("supervisor.dialog.restore.title")}</p>
            <p className="supervisor-dialog-intro__description">
              {t("supervisor.dialog.restore.subtitle")}
            </p>
          </div>
        </div>

        <div className="supervisor-restore-actions">
          <button type="button" className="supervisor-restore-link" onClick={onCloseRestoreStep}>
            {t("supervisor.dialog.restore.back")}
          </button>
        </div>

        {isRecoverableTargetsLoading ? (
          <div className="supervisor-restore-loading">
            <Spinner label={t("common.loading")} size="md" />
          </div>
        ) : recoverableTargets.length === 0 ? (
          <EmptyState
            className="supervisor-restore-empty"
            title={t("supervisor.dialog.restore.empty")}
            description={t("supervisor.dialog.restore.empty_hint")}
          />
        ) : (
          <div className="supervisor-restore-list" role="radiogroup">
            {recoverableTargets.map((target) => {
              const checked = target.targetId === selectedRecoverableTargetId;

              return (
                <button
                  key={target.targetId}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  className={`supervisor-restore-card${checked ? " supervisor-restore-card--selected" : ""}`}
                  onClick={() => onSelectRecoverableTarget(target.targetId)}
                >
                  <span className="supervisor-restore-card__header">
                    <span className="supervisor-restore-card__title">{target.objective}</span>
                    <span className="supervisor-restore-card__meta">
                      {t("supervisor.dialog.restore.cycle_count", {
                        count: target.cycleCount,
                      })}
                    </span>
                  </span>
                  {target.progressSummary ? (
                    <span className="supervisor-restore-card__summary">
                      {target.progressSummary}
                    </span>
                  ) : null}
                  <span className="supervisor-restore-card__footer">
                    {t("supervisor.dialog.restore.updated_at", {
                      time: formatDate(target.updatedAt, locale, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      }),
                    })}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {showIntro ? (
        <div className="supervisor-dialog-intro">
          <div className="supervisor-dialog-intro__icon" aria-hidden="true">
            <ObjectiveDialogModeIcon mode={mode} />
          </div>
          <div className="supervisor-dialog-intro__copy">
            <p className="supervisor-dialog-intro__title">{introTitle}</p>
            <p className="supervisor-dialog-intro__description">{introDescription}</p>
          </div>
        </div>
      ) : null}

      <div className="form-group supervisor-dialog-section supervisor-dialog-section--objective">
        <div className="supervisor-dialog-section__head supervisor-objective-label-row">
          <label className="supervisor-dialog-section__label" htmlFor="objective">
            {t("supervisor.field.objective")}
          </label>
          <button type="button" className="supervisor-restore-link" onClick={onOpenRestoreStep}>
            {t("supervisor.dialog.restore.open")}
          </button>
        </div>
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

      <div className="supervisor-dialog-section supervisor-dialog-section--evaluator">
        <div className="supervisor-dialog-section__head">
          <span className="supervisor-dialog-section__label">
            {t("supervisor.field.evaluator")}
          </span>
        </div>
        <div className="supervisor-dialog-field-grid">
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
        </div>
      </div>

      <div className="supervisor-dialog-section supervisor-dialog-section--guardrails">
        <div className="supervisor-dialog-section__head">
          <span className="supervisor-dialog-section__label">
            {t("supervisor.dialog.guardrails_schedule")}
          </span>
        </div>
        <div className="supervisor-dialog-field-grid">
          <div className="form-group">
            <label htmlFor="max-supervision-count">
              {t("supervisor.field.max_supervision_count")}
            </label>
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
        </div>
      </div>
    </>
  );
}
