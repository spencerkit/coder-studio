import { memo, useCallback, type FormEvent, type PointerEventHandler, type ReactNode } from "react";
import type { Locale, Translator } from "../../i18n";
import type {
  AppTheme,
  SessionHistoryRecord,
  TerminalCompatibilityMode,
} from "../../types/app";
import type { Session, SessionPaneNode, Tab } from "../../state/workbench";
import { AgentSendIcon, AgentSplitHorizontalIcon, AgentSplitVerticalIcon, HeaderCloseIcon } from "../../components/icons";
import { AgentStreamTerminal, type XtermBaseHandle } from "../../components/terminal";
import { displaySessionStatus, sessionCompletionRatio, sessionHeaderTag, sessionTone } from "../../shared/utils/session";
import { stripAnsi } from "../../shared/utils/ansi";
import { resolveAgentPaneRenderState } from "./agent-pane-render";

type AgentWorkspaceFeatureProps = {
  visible: boolean;
  locale: Locale;
  activeTab: Tab;
  activePaneSession: Session;
  viewedSession: Session;
  isArchiveView: boolean;
  showCodePanel: boolean;
  theme: AppTheme;
  terminalFontSize: number;
  terminalCompatibilityMode: TerminalCompatibilityMode;
  draftPromptInputs: Record<string, string>;
  draftPaneModes: Record<string, "new" | "restore">;
  restoreCandidates: SessionHistoryRecord[];
  displaySessionTitle: (value: string) => string;
  onExitArchive: () => void;
  onSetActivePane: (paneId: string, sessionId: string) => void;
  onSplitPane: (paneId: string, axis: "horizontal" | "vertical") => void;
  onCloseAgentPane: (paneId: string, sessionId: string) => void;
  onDraftPaneModeChange: (paneId: string, mode: "new" | "restore") => void;
  onRestoreDraftSession: (paneId: string, sessionId: string) => void;
  onSubmitDraftPrompt: (paneId: string) => void;
  onDraftPromptChange: (paneId: string, value: string) => void;
  setDraftPromptInputRef: (paneId: string, element: HTMLInputElement | null) => void;
  setAgentTerminalRef: (paneId: string, handle: XtermBaseHandle | null) => void;
  onAgentTerminalData: (paneId: string, data: string) => void;
  onAgentTerminalSize: (paneId: string, tabId: string, sessionId: string, size: { cols: number; rows: number }) => void;
  onPaneSplitResizeStart: (splitId: string, axis: "horizontal" | "vertical") => PointerEventHandler<HTMLDivElement>;
  onCodeResizeStart: PointerEventHandler<HTMLDivElement>;
  t: Translator;
};

type AgentPaneLeafProps = {
  paneId: string;
  session: Session;
  activeSessionId: string;
  tabId: string;
  locale: Locale;
  isPaneActive: boolean;
  theme: AppTheme;
  terminalFontSize: number;
  terminalCompatibilityMode: TerminalCompatibilityMode;
  draftPromptValue: string;
  draftPaneMode: "new" | "restore";
  restoreCandidates: SessionHistoryRecord[];
  displaySessionTitle: (value: string) => string;
  onSetActivePane: (paneId: string, sessionId: string) => void;
  onSplitPane: (paneId: string, axis: "horizontal" | "vertical") => void;
  onCloseAgentPane: (paneId: string, sessionId: string) => void;
  onDraftPaneModeChange: (paneId: string, mode: "new" | "restore") => void;
  onRestoreDraftSession: (paneId: string, sessionId: string) => void;
  onSubmitDraftPrompt: (paneId: string) => void;
  onDraftPromptChange: (paneId: string, value: string) => void;
  setDraftPromptInputRef: (paneId: string, element: HTMLInputElement | null) => void;
  setAgentTerminalRef: (paneId: string, handle: XtermBaseHandle | null) => void;
  onAgentTerminalData: (paneId: string, data: string) => void;
  onAgentTerminalSize: (paneId: string, tabId: string, sessionId: string, size: { cols: number; rows: number }) => void;
  t: Translator;
};

const AgentPaneLeaf = memo(({
  paneId,
  session,
  activeSessionId,
  tabId,
  locale,
  isPaneActive,
  theme,
  terminalFontSize,
  terminalCompatibilityMode,
  draftPromptValue,
  draftPaneMode,
  restoreCandidates,
  displaySessionTitle,
  onSetActivePane,
  onSplitPane,
  onCloseAgentPane,
  onDraftPaneModeChange,
  onRestoreDraftSession,
  onSubmitDraftPrompt,
  onDraftPromptChange,
  setDraftPromptInputRef,
  setAgentTerminalRef,
  onAgentTerminalData,
  onAgentTerminalSize,
  t,
}: AgentPaneLeafProps) => {
  const visibleStatus = displaySessionStatus({ activeSessionId }, session);
  const progress = (() => {
    const ratio = sessionCompletionRatio(session);
    if (ratio > 0) return Math.max(14, ratio);
    if (visibleStatus === "running" || visibleStatus === "background") return 34;
    if (visibleStatus === "waiting") return 22;
    return 6;
  })();
  const tone = visibleStatus === "running" || visibleStatus === "background"
    ? "live"
    : visibleStatus === "waiting"
      ? "queued"
      : "idle";
  const statusTone = sessionTone(visibleStatus);
  const headerTag = sessionHeaderTag(visibleStatus, locale);
  const renderState = resolveAgentPaneRenderState(session, isPaneActive);

  const handleSetActivePane = useCallback(() => {
    onSetActivePane(paneId, session.id);
  }, [onSetActivePane, paneId, session.id]);

  const handleSplitVertical = useCallback(() => {
    onSplitPane(paneId, "vertical");
  }, [onSplitPane, paneId]);

  const handleSplitHorizontal = useCallback(() => {
    onSplitPane(paneId, "horizontal");
  }, [onSplitPane, paneId]);

  const handleClosePane = useCallback(() => {
    onCloseAgentPane(paneId, session.id);
  }, [onCloseAgentPane, paneId, session.id]);

  const handleSetDraftModeNew = useCallback(() => {
    onDraftPaneModeChange(paneId, "new");
  }, [onDraftPaneModeChange, paneId]);

  const handleSetDraftModeRestore = useCallback(() => {
    onDraftPaneModeChange(paneId, "restore");
  }, [onDraftPaneModeChange, paneId]);

  const handleRestoreDraftSession = useCallback((sessionId: string) => {
    onRestoreDraftSession(paneId, sessionId);
  }, [onRestoreDraftSession, paneId]);

  const handleSubmitDraftPrompt = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmitDraftPrompt(paneId);
  }, [onSubmitDraftPrompt, paneId]);

  const handleDraftPromptRef = useCallback((element: HTMLInputElement | null) => {
    setDraftPromptInputRef(paneId, element);
  }, [paneId, setDraftPromptInputRef]);

  const handleTerminalRef = useCallback((handle: XtermBaseHandle | null) => {
    setAgentTerminalRef(paneId, handle);
  }, [paneId, setAgentTerminalRef]);

  const handleTerminalData = useCallback((data: string) => {
    onAgentTerminalData(paneId, data);
  }, [onAgentTerminalData, paneId]);

  const handleTerminalSize = useCallback((size: { cols: number; rows: number }) => {
    onAgentTerminalSize(paneId, tabId, session.id, size);
  }, [onAgentTerminalSize, paneId, session.id, tabId]);

  return (
    <section
      className={`agent-pane-card ${isPaneActive ? "active" : ""}`}
      data-session-id={session.id}
      data-session-status={visibleStatus}
      onMouseDown={handleSetActivePane}
    >
      <div className={`surface-progress ${tone}`} aria-hidden="true">
        <span className="surface-progress-bar" style={{ width: `${progress}%` }} />
      </div>
      <div className="agent-pane-header" data-density="compact" data-active={isPaneActive ? "true" : "false"}>
        <div className="agent-pane-header-copy">
          <span className={`session-top-dot ${statusTone} ${statusTone === "active" ? "pulse" : ""}`} />
          <span className="agent-pane-title">{displaySessionTitle(session.title)}</span>
        </div>
        <div className="agent-pane-meta">
          <span className={`agent-pane-state-tag ${headerTag.tone}`} data-tone={headerTag.tone}>
            {headerTag.label}
          </span>
          <div className="agent-pane-actions">
            <button
              type="button"
              className="pane-action split"
              onClick={handleSplitVertical}
              title={t("splitVertical")}
              aria-label={t("splitVertical")}
            >
              <AgentSplitHorizontalIcon />
            </button>
            <button
              type="button"
              className="pane-action split"
              onClick={handleSplitHorizontal}
              title={t("splitHorizontal")}
              aria-label={t("splitHorizontal")}
            >
              <AgentSplitVerticalIcon />
            </button>
            <button
              type="button"
              className="pane-action close"
              onClick={handleClosePane}
              title={t("close")}
            >
              <HeaderCloseIcon />
            </button>
          </div>
        </div>
      </div>
      <div className="agent-pane-body" data-testid={`agent-pane-${paneId}`}>
        {renderState.kind === "draft" ? (
          <div className="agent-draft-launcher">
            <div className="agent-draft-launcher-card">
              <div className="agent-draft-launcher-copy">
                <div className="agent-draft-launcher-title">{t("draftSessionPrompt")}</div>
                <div className="agent-draft-launcher-hint">{t("draftChooserHint")}</div>
              </div>
              <div className="agent-draft-launcher-tabs">
                <button
                  type="button"
                  className={`agent-draft-launcher-tab ${draftPaneMode === "new" ? "active" : ""}`}
                  onClick={handleSetDraftModeNew}
                  data-testid={`draft-mode-new-${paneId}`}
                >
                  {t("draftModeNew")}
                </button>
                <button
                  type="button"
                  className={`agent-draft-launcher-tab ${draftPaneMode === "restore" ? "active" : ""}`}
                  onClick={handleSetDraftModeRestore}
                  data-testid={`draft-mode-restore-${paneId}`}
                >
                  {t("draftModeRestore")}
                </button>
              </div>
              {draftPaneMode === "new" ? (
                <form
                  className="agent-pane-input agent-draft-launcher-form"
                  onSubmit={handleSubmitDraftPrompt}
                >
                  <div className="agent-compose">
                    <input
                      ref={handleDraftPromptRef}
                      className="agent-compose-field agent-draft-launcher-field"
                      value={draftPromptValue}
                      onChange={(event) => onDraftPromptChange(paneId, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.nativeEvent as KeyboardEvent).isComposing) {
                          event.preventDefault();
                        }
                      }}
                      placeholder={t("draftTaskPlaceholder")}
                      aria-label={t("draftTaskPlaceholder")}
                      data-testid={`agent-draft-input-${paneId}`}
                      autoFocus={isPaneActive}
                    />
                    <button
                      type="submit"
                      className="agent-send-button"
                      disabled={!draftPromptValue.trim()}
                      title={t("send")}
                      aria-label={t("send")}
                    >
                      <AgentSendIcon />
                    </button>
                  </div>
                </form>
              ) : (
                <div className="agent-draft-restore-list">
                  {restoreCandidates.length === 0 ? (
                    <div className="agent-draft-launcher-empty">{t("draftRestoreEmpty")}</div>
                  ) : (
                    restoreCandidates.map((record) => (
                      <button
                        key={`${record.workspaceId}:${record.sessionId}`}
                        type="button"
                        className="agent-draft-restore-item"
                        onClick={() => handleRestoreDraftSession(record.sessionId)}
                        data-testid={`restore-candidate-${record.sessionId}`}
                      >
                        <strong>{record.title}</strong>
                        <span>{record.archived ? t("historyArchived") : t("historyDetached")}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (!session.stream.trim() && renderState.terminalMode === "readonly") ? (
          <div className="terminal-empty">{t("noAgentOutputYet")}</div>
        ) : (
          <AgentStreamTerminal
            ref={handleTerminalRef}
            streamId={session.id}
            stream={session.stream}
            toneKey={isPaneActive ? "active" : "inactive"}
            theme={theme}
            fontSize={terminalFontSize}
            compatibilityMode={terminalCompatibilityMode}
            mode={renderState.terminalMode}
            autoFocus={renderState.terminalMode === "interactive"}
            onData={renderState.terminalMode === "interactive" ? handleTerminalData : undefined}
            onSize={handleTerminalSize}
          />
        )}
      </div>
    </section>
  );
}, (previous, next) => (
  previous.paneId === next.paneId
  && previous.session === next.session
  && previous.tabId === next.tabId
  && previous.locale === next.locale
  && previous.isPaneActive === next.isPaneActive
  && previous.theme === next.theme
  && previous.terminalFontSize === next.terminalFontSize
  && previous.terminalCompatibilityMode === next.terminalCompatibilityMode
  && previous.draftPromptValue === next.draftPromptValue
  && previous.draftPaneMode === next.draftPaneMode
  && previous.restoreCandidates === next.restoreCandidates
));

AgentPaneLeaf.displayName = "AgentPaneLeaf";

export const AgentWorkspaceFeature = ({
  visible,
  locale,
  activeTab,
  activePaneSession,
  viewedSession,
  isArchiveView,
  showCodePanel,
  theme,
  terminalFontSize,
  terminalCompatibilityMode,
  draftPromptInputs,
  draftPaneModes,
  restoreCandidates,
  displaySessionTitle,
  onExitArchive,
  onSetActivePane,
  onSplitPane,
  onCloseAgentPane,
  onDraftPaneModeChange,
  onRestoreDraftSession,
  onSubmitDraftPrompt,
  onDraftPromptChange,
  setDraftPromptInputRef,
  setAgentTerminalRef,
  onAgentTerminalData,
  onAgentTerminalSize,
  onPaneSplitResizeStart,
  onCodeResizeStart,
  t,
}: AgentWorkspaceFeatureProps) => {
  if (!visible) return null;

  const viewedSessionPlainStream = stripAnsi(viewedSession.stream);
  const viewedHeaderTag = sessionHeaderTag(viewedSession.status, locale);

  const renderAgentPane = (node: SessionPaneNode): ReactNode => {
    if (node.type === "split") {
      return (
        <div key={node.id} className={`agent-split-pane ${node.axis}`}>
          <div className="agent-split-child" style={{ flex: `${node.ratio} 1 0%` }}>{renderAgentPane(node.first)}</div>
          <div className={`agent-split-divider ${node.axis}`} onPointerDown={onPaneSplitResizeStart(node.id, node.axis)} />
          <div className="agent-split-child" style={{ flex: `${1 - node.ratio} 1 0%` }}>{renderAgentPane(node.second)}</div>
        </div>
      );
    }

    const session = activeTab.sessions.find((item) => item.id === node.sessionId) ?? activePaneSession;
    const isPaneActive = activeTab.activePaneId === node.id;

    return (
      <AgentPaneLeaf
        key={node.id}
        paneId={node.id}
        session={session}
        activeSessionId={activeTab.activeSessionId}
        tabId={activeTab.id}
        locale={locale}
        isPaneActive={isPaneActive}
        theme={theme}
        terminalFontSize={terminalFontSize}
        terminalCompatibilityMode={terminalCompatibilityMode}
        draftPromptValue={draftPromptInputs[node.id] ?? ""}
        draftPaneMode={draftPaneModes[node.id] ?? "new"}
        restoreCandidates={restoreCandidates}
        displaySessionTitle={displaySessionTitle}
        onSetActivePane={onSetActivePane}
        onSplitPane={onSplitPane}
        onCloseAgentPane={onCloseAgentPane}
        onDraftPaneModeChange={onDraftPaneModeChange}
        onRestoreDraftSession={onRestoreDraftSession}
        onSubmitDraftPrompt={onSubmitDraftPrompt}
        onDraftPromptChange={onDraftPromptChange}
        setDraftPromptInputRef={setDraftPromptInputRef}
        setAgentTerminalRef={setAgentTerminalRef}
        onAgentTerminalData={onAgentTerminalData}
        onAgentTerminalSize={onAgentTerminalSize}
        t={t}
      />
    );
  };

  return (
    <>
      <section
        className="panel center-panel workspace-agent-shell"
        style={{ flex: "1 1 0%" }}
      >
        <div className="panel-inner studio-panel compact">
          {isArchiveView && (
            <div className="archive-banner">
              <div>
                {t("viewingArchivedSession")}
                <div className="hint">{t("exitArchiveHint")}</div>
              </div>
              <button className="btn tiny" onClick={onExitArchive}>{t("exit")}</button>
            </div>
          )}
          <div className="agent-pane-workspace">
            {isArchiveView ? (
              <section
                className="agent-pane-card archive-only"
                data-session-id={viewedSession.id}
                data-session-status={viewedSession.status}
              >
                <div className="agent-pane-header" data-density="compact" data-active="true">
                  <div className="agent-pane-header-copy">
                    <span className={`session-top-dot ${sessionTone(viewedSession.status)} ${sessionTone(viewedSession.status) === "active" ? "pulse" : ""}`} />
                    <span className="agent-pane-title">{displaySessionTitle(viewedSession.title)}</span>
                  </div>
                  <div className="agent-pane-meta">
                    <span className={`agent-pane-state-tag ${viewedHeaderTag.tone}`} data-tone={viewedHeaderTag.tone}>
                      {viewedHeaderTag.label}
                    </span>
                  </div>
                </div>
                <div className="agent-pane-body">
                  {viewedSessionPlainStream.trim() ? (
                    <AgentStreamTerminal
                      streamId={viewedSession.id}
                      stream={viewedSession.stream}
                      toneKey="active"
                      theme={theme}
                      fontSize={terminalFontSize}
                      compatibilityMode={terminalCompatibilityMode}
                    />
                  ) : (
                    <div className="terminal-empty">{t("archiveViewReadonly")}</div>
                  )}
                </div>
              </section>
            ) : (
              renderAgentPane(activeTab.paneLayout)
            )}
          </div>
        </div>
      </section>

      {showCodePanel && <div className="v-resizer" data-resize="left" onPointerDown={onCodeResizeStart} />}
    </>
  );
};

export default AgentWorkspaceFeature;
