import type { Translator } from "../../i18n.ts";
import type { SessionHistoryGroup, SessionHistoryRecord } from "../../types/app.ts";
import { HeaderCloseIcon } from "../icons.tsx";
import { selectHistoryPrimaryAction } from "../../features/workspace/session-history.ts";

type HistoryDrawerProps = {
  open: boolean;
  loading?: boolean;
  groups: SessionHistoryGroup[];
  onClose: () => void;
  onSelectRecord: (record: SessionHistoryRecord) => void;
  onDeleteRecord: (record: SessionHistoryRecord) => void;
  t: Translator;
};

const recordMetaLabel = (record: SessionHistoryRecord, t: Translator) => {
  if (record.archived) return t("historyArchived");
  if (record.mounted) return t("historyLive");
  return t("historyDetached");
};

const recordStateClassName = (record: SessionHistoryRecord) => {
  if (record.archived) return "archived";
  if (record.mounted) return "live";
  return "detached";
};

const primaryActionLabel = (record: SessionHistoryRecord, t: Translator) => {
  const action = selectHistoryPrimaryAction(record);
  if (action === "focus") return t("historyFocus");
  if (action === "restore") return t("historyRestore");
  return t("historyOpen");
};

export const HistoryDrawer = ({
  open,
  loading = false,
  groups,
  onClose,
  onSelectRecord,
  onDeleteRecord,
  t,
}: HistoryDrawerProps) => (
  <div className={`history-drawer-shell ${open ? "open" : ""}`} aria-hidden={!open}>
    <button
      type="button"
      className={`history-drawer-backdrop ${open ? "open" : ""}`}
      onClick={onClose}
      aria-label={t("close")}
      tabIndex={open ? 0 : -1}
    />
    <aside className={`history-drawer ${open ? "open" : ""}`} data-testid="history-drawer">
      <div className="history-drawer-header">
        <div className="history-drawer-copy">
          <div className="history-drawer-kicker">{t("history")}</div>
          <strong>{t("historyTitle")}</strong>
          <p>{t("historyDescription")}</p>
        </div>
        <button type="button" className="history-drawer-close" onClick={onClose} aria-label={t("close")} data-testid="history-drawer-close">
          <HeaderCloseIcon />
        </button>
      </div>
      <div className="history-drawer-body">
        {loading ? (
          <div className="history-empty-state">{t("loading")}</div>
        ) : groups.length === 0 ? (
          <div className="history-empty-state">{t("historyEmpty")}</div>
        ) : (
          groups.map((group) => (
            <section key={group.workspaceId} className="history-group">
              <header className="history-group-header">
                <div>
                  <strong>{group.workspaceTitle}</strong>
                  <span>{group.workspacePath}</span>
                </div>
                <span>{t("historyCount", { count: group.records.length })}</span>
              </header>
              <div className="history-record-list">
                {group.records.map((record) => (
                  <div key={`${record.workspaceId}:${record.sessionId}`} className="history-record-row">
                    <button
                      type="button"
                      className="history-record-main"
                      onClick={() => onSelectRecord(record)}
                      data-testid={`history-record-${record.workspaceId}-${record.sessionId}`}
                    >
                      <div className="history-record-title-row">
                        <strong>{record.title}</strong>
                        <span className={`history-record-state ${recordStateClassName(record)}`}>
                          {primaryActionLabel(record, t)}
                        </span>
                      </div>
                      <div className="history-record-meta">
                        <span>{recordMetaLabel(record, t)}</span>
                        <span>{record.status}</span>
                        <span>{new Date(record.lastActiveAt).toLocaleString()}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="history-record-delete"
                      onClick={() => onDeleteRecord(record)}
                      data-testid={`history-delete-${record.workspaceId}-${record.sessionId}`}
                    >
                      {t("historyDelete")}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </aside>
  </div>
);

export default HistoryDrawer;
