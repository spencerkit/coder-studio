import type { Translator } from "../../i18n";
import { composeSupervisorObjectivePreview } from "./supervisor-objective";

type SupervisorObjectiveDialogMode = "enable" | "edit" | "disable";

type SupervisorObjectiveDialogProps = {
  visible: boolean;
  mode: SupervisorObjectiveDialogMode;
  t: Translator;
  objectiveText: string;
  submitting?: boolean;
  onObjectiveTextChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export const SupervisorObjectiveDialog = ({
  visible,
  mode,
  t,
  objectiveText,
  submitting = false,
  onObjectiveTextChange,
  onCancel,
  onConfirm,
}: SupervisorObjectiveDialogProps) => {
  if (!visible) return null;

  const isDisableMode = mode === "disable";
  const title = isDisableMode
    ? t("supervisorDisableTitle")
    : mode === "edit"
      ? t("supervisorEditTitle")
      : t("supervisorEnableTitle");
  const message = isDisableMode
    ? t("supervisorDisableMessage")
    : t("supervisorEnableMessage");
  const confirmLabel = isDisableMode
    ? t("supervisorDisableTitle")
    : mode === "edit"
      ? t("supervisorEditConfirm")
      : t("supervisorEnableConfirm");
  const contextPreview = isDisableMode ? "" : composeSupervisorObjectivePreview(objectiveText);

  return (
    <div className="modal-overlay">
      <div
        className="modal-card supervisor-objective-dialog-card"
        role="dialog"
        aria-modal="true"
        data-density="compact"
      >
        <div className="modal-header supervisor-objective-dialog-header">
          <h3>{title}</h3>
        </div>
        <div className="modal-body supervisor-objective-dialog-body">
          <p>{message}</p>
          {isDisableMode ? null : (
            <>
              <textarea
                className="supervisor-objective-dialog-textarea"
                value={objectiveText}
                onChange={(event) => onObjectiveTextChange(event.target.value)}
                autoFocus
                rows={5}
                placeholder={t("supervisorObjectivePlaceholder")}
              />
              <div className="supervisor-objective-dialog-preview">
                <div className="supervisor-objective-dialog-preview-label">{t("supervisorContextPreview")}</div>
                <pre className="supervisor-objective-dialog-preview-code">{contextPreview || t("supervisorContextPreviewEmpty")}</pre>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer supervisor-objective-dialog-footer">
          <button type="button" className="btn" onClick={onCancel} disabled={submitting}>
            {t("cancel")}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={submitting}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export type { SupervisorObjectiveDialogMode, SupervisorObjectiveDialogProps };
