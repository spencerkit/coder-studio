import type { Translator } from "../../i18n.ts";
import type {
  SessionHistoryExpansionState,
  SessionHistoryGroup,
  SessionHistoryRecord,
} from "../../types/app.ts";
import { ChevronDownIcon, ChevronRightIcon, HeaderCloseIcon } from "../icons.tsx";
import { selectHistoryPrimaryActionBadge } from "../../features/workspace/session-history.ts";

type HistoryDrawerProps = {
  open: boolean;
  loading?: boolean;
  groups: SessionHistoryGroup[];
  expandedGroups: SessionHistoryExpansionState;
  onClose: () => void;
  onToggleGroup: (workspaceId: string) => void;
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
  const action = selectHistoryPrimaryActionBadge(record);
  if (action === "restore") return t("historyRestore");
  if (action === "open") return t("historyOpen");
  return null;
};

export const HistoryDrawer = ({
  open,
  loading = false,
  groups,
  expandedGroups,
  onClose,
  onToggleGroup,
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
          groups.map((group) => {
            const expanded = expandedGroups[group.workspaceId] ?? false;

            return (
              <section
                key={group.workspaceId}
                className={`history-group ${expanded ? "expanded" : ""}`}
                data-testid={`history-group-${group.workspaceId}`}
              >
                <button
                  type="button"
                  className="history-group-header"
                  aria-expanded={expanded}
                  onClick={() => onToggleGroup(group.workspaceId)}
                  data-testid={`history-group-toggle-${group.workspaceId}`}
                >
                  <div className="history-group-heading">
                    <span className="history-group-chevron" aria-hidden="true">
                      {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                    </span>
                    <div className="history-group-copy">
                      <strong>{group.workspaceTitle}</strong>
                      <span>{group.workspacePath}</span>
                    </div>
                  </div>
                  <span className="history-group-count">{t("historyCount", { count: group.records.length })}</span>
                </button>
                {expanded ? (
                  <div className="history-record-list" role="region" aria-label={group.workspaceTitle}>
                    {group.records.map((record) => {
                      const actionLabel = primaryActionLabel(record, t);

                      return (
                        <div key={`${record.workspaceId}:${record.sessionId}`} className="history-record-row">
                          <button
                            type="button"
                            className="history-record-main"
                            onClick={() => onSelectRecord(record)}
                            data-testid={`history-record-${record.workspaceId}-${record.sessionId}`}
                          >
                            <div className="history-record-title-row">
                              <strong>{record.title}</strong>
                              {actionLabel ? (
                                <span className={`history-record-state ${recordStateClassName(record)}`}>
                                  {actionLabel}
                                </span>
                              ) : null}
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
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>
    </aside>
  </div>
);

export default HistoryDrawer;
