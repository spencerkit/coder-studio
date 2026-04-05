import type { Locale, Translator } from "../../i18n";

export type ConfirmDialogState = {
  visible: boolean;
  title: string;
  message: string;
  details?: {
    content?: string;
    contentLabel?: string;
    timestamp?: string;
    timeLabel?: string;
  };
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

type ConfirmDialogProps = {
  state: ConfirmDialogState;
  locale: Locale;
  t: Translator;
};

export const ConfirmDialog = ({ state, locale, t }: ConfirmDialogProps) => {
  if (!state.visible) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-card confirm-dialog-card" role="dialog" aria-modal="true" data-density="compact">
        <div className="modal-header confirm-dialog-header">
          <h3>{state.title}</h3>
        </div>
        <div className="modal-body confirm-dialog-body">
          <p>{state.message}</p>
          {state.details ? (
            <div className="confirm-dialog-details">
              {state.details.content ? (
                <div className="confirm-dialog-detail-row">
                  <span className="confirm-dialog-detail-label">
                    {state.details.contentLabel ?? t("historyDialogContentLabel")}
                  </span>
                  <p className="confirm-dialog-details-content" title={state.details.content}>
                    {state.details.content}
                  </p>
                </div>
              ) : null}
              {state.details.timestamp ? (
                <div className="confirm-dialog-detail-row">
                  <span className="confirm-dialog-detail-label">
                    {state.details.timeLabel ?? t("historyDialogTimeLabel")}
                  </span>
                  <span className="confirm-dialog-detail-value">{state.details.timestamp}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="modal-footer confirm-dialog-footer">
          <button
            type="button"
            className="btn"
            onClick={state.onCancel}
          >
            {state.cancelLabel ?? t("cancel")}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={state.onConfirm}
          >
            {state.confirmLabel ?? t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
