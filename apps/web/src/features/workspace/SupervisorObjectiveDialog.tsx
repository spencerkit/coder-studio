import { composeSupervisorObjectivePreview } from "./supervisor-objective";

type SupervisorObjectiveDialogMode = "enable" | "edit" | "disable";

type SupervisorObjectiveDialogProps = {
  visible: boolean;
  mode: SupervisorObjectiveDialogMode;
  objectiveText: string;
  submitting?: boolean;
  onObjectiveTextChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

const SUPERVISOR_DISABLE_COPY = "Disable supervisor";

export const SupervisorObjectiveDialog = ({
  visible,
  mode,
  objectiveText,
  submitting = false,
  onObjectiveTextChange,
  onCancel,
  onConfirm,
}: SupervisorObjectiveDialogProps) => {
  if (!visible) return null;

  const isDisableMode = mode === "disable";
  const title = isDisableMode
    ? SUPERVISOR_DISABLE_COPY
    : mode === "edit"
      ? "Edit supervisor objective"
      : "Enable supervisor";
  const message = isDisableMode
    ? "Disable supervisor mode for this session?"
    : "Describe how the supervisor should guide this session.";
  const confirmLabel = isDisableMode
    ? SUPERVISOR_DISABLE_COPY
    : mode === "edit"
      ? "Save objective"
      : "Enable supervisor";
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
                placeholder="Keep the business agent focused on the current task."
              />
              <div className="supervisor-objective-dialog-preview">
                <div className="supervisor-objective-dialog-preview-label">Context preview</div>
                <pre className="supervisor-objective-dialog-preview-code">{contextPreview || "No context will be sent until an objective is provided."}</pre>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer supervisor-objective-dialog-footer">
          <button type="button" className="btn" onClick={onCancel} disabled={submitting}>
            Cancel
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
