import type { FC } from "react";
import { useTranslation } from "../../../../lib/i18n";

interface XtermPlaceholderProps {
  state: "queued" | "granting";
  queuePosition?: number;
}

export const XtermPlaceholder: FC<XtermPlaceholderProps> = ({ state, queuePosition }) => {
  const t = useTranslation();
  const message =
    state === "granting"
      ? t("terminal.replay.loading_title")
      : queuePosition === 0
        ? t("terminal.replay.up_next")
        : t("terminal.replay.queued_title", { count: queuePosition ?? 0 });

  return (
    <div
      className="xterm-replay-overlay xterm-replay-overlay--placeholder"
      role="status"
      aria-live="polite"
    >
      <div className="xterm-replay-overlay__card">
        {state === "granting" ? (
          <div className="xterm-replay-overlay__spinner" aria-hidden="true" />
        ) : null}
        <div className="xterm-replay-overlay__title">{message}</div>
      </div>
    </div>
  );
};
