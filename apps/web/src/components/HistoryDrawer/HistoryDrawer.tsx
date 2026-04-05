import type { Translator } from "../../i18n";
import type {
  SessionHistoryExpansionState,
  SessionHistoryGroup,
  SessionHistoryRecord,
} from "../../types/app";
import { getProviderDisplayLabel } from "../../features/providers/runtime-helpers";
import { ChevronDownIcon, ChevronRightIcon, HeaderCloseIcon } from "../icons";
import { selectHistoryPrimaryActionBadge } from "../../features/workspace/session-history";

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

const recordTestId = (record: SessionHistoryRecord) => (
  `${record.workspaceId}-${record.provider}-${record.resumeId}`
);

const recordMetaLabel = (record: SessionHistoryRecord, t: Translator) => {
  if (record.state === "live") return t("historyLive");
  if (record.state === "detached") return t("historyDetached");
  return t("historyUnavailable");
};

const recordStateClassName = (record: SessionHistoryRecord) => {
  if (record.state === "live") return "live";
  if (record.state === "detached") return "detached";
  return "archived";
};

const primaryActionLabel = (record: SessionHistoryRecord, t: Translator) => {
  const action = selectHistoryPrimaryActionBadge(record);
  if (action === "restore") return t("historyRestore");
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

                      const mainContent = (
                        <>
                          <div className="history-record-title-row">
                            <strong>{record.title}</strong>
                            {actionLabel ? (
                              <span className={`history-record-state ${recordStateClassName(record)}`}>
                                {actionLabel}
                              </span>
                            ) : null}
                          </div>
                          <div className="history-record-meta">
                            <span>{getProviderDisplayLabel(record.provider)}</span>
                            <span>{recordMetaLabel(record, t)}</span>
                            <span>{new Date(record.lastActiveAt).toLocaleString()}</span>
                          </div>
                        </>
                      );

                      return (
                        <div key={recordTestId(record)} className="history-record-row">
                          {record.state === "unavailable" ? (
                            <div
                              className="history-record-main"
                              data-testid={`history-record-${recordTestId(record)}`}
                            >
                              {mainContent}
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="history-record-main"
                              onClick={() => onSelectRecord(record)}
                              data-testid={`history-record-${recordTestId(record)}`}
                            >
                              {mainContent}
                            </button>
                          )}
                          <button
                            type="button"
                            className="history-record-delete"
                            onClick={() => onDeleteRecord(record)}
                            data-testid={`history-delete-${recordTestId(record)}`}
                          >
                            {record.state === "unavailable" ? t("historyRemove") : t("historyDelete")}
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
