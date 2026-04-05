import { memo, useCallback, type PointerEventHandler, type ReactNode } from "react";
import type { Locale, Translator } from "../../i18n";
import type {
  AppTheme,
  SessionHistoryRecord,
  TerminalCompatibilityMode,
} from "../../types/app";
import type { Session, SessionPaneNode, Tab } from "../../state/workbench";
import { AgentSplitHorizontalIcon, AgentSplitVerticalIcon, HeaderCloseIcon } from "../../components/icons";
import { ShellTerminal, type XtermBaseHandle } from "../../components/terminal";
import { displaySessionStatus, sessionCompletionRatio, sessionHeaderTag, sessionTone } from "../../shared/utils/session";
import { stripAnsi } from "../../shared/utils/ansi";
import { sanitizeAnsiTranscript } from "../../shared/utils/ansi-transcript";
import { BUILTIN_PROVIDER_MANIFESTS } from "../providers/registry";
import { getProviderDisplayLabel } from "../providers/runtime-helpers";
import { resolveAgentPaneRenderState, resolveAgentPaneTerminalBinding } from "./agent-pane-render";

type AgentWorkspaceFeatureProps = {
  visible: boolean;
  agentInputEnabled: boolean;
  locale: Locale;
  activeTab: Tab;
  activePaneSession: Session;
  showCodePanel: boolean;
  theme: AppTheme;
  terminalFontSize: number;
  terminalCompatibilityMode: TerminalCompatibilityMode;
  draftPaneModes: Record<string, "new" | "restore">;
  historyLoading: boolean;
  restoreCandidates: SessionHistoryRecord[];
  displaySessionTitle: (value: string) => string;
  onRemoveUnavailableSession: (sessionId: string) => void;
  onSetActivePane: (paneId: string, sessionId: string) => void;
  onSplitPane: (paneId: string, axis: "horizontal" | "vertical") => void;
  onCloseAgentPane: (paneId: string, sessionId: string) => void;
  onDraftPaneModeChange: (paneId: string, mode: "new" | "restore") => void;
  onStartDraftSession: (paneId: string, provider: Session["provider"]) => void;
  onRestoreDraftSession: (paneId: string, record: SessionHistoryRecord) => void;
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
  terminals: Tab["terminals"];
  agentInputEnabled: boolean;
  locale: Locale;
  isPaneActive: boolean;
  theme: AppTheme;
  terminalFontSize: number;
  terminalCompatibilityMode: TerminalCompatibilityMode;
  draftPaneMode: "new" | "restore";
  historyLoading: boolean;
  restoreCandidates: SessionHistoryRecord[];
  displaySessionTitle: (value: string) => string;
  onRemoveUnavailableSession: (sessionId: string) => void;
  onSetActivePane: (paneId: string, sessionId: string) => void;
  onSplitPane: (paneId: string, axis: "horizontal" | "vertical") => void;
  onCloseAgentPane: (paneId: string, sessionId: string) => void;
  onDraftPaneModeChange: (paneId: string, mode: "new" | "restore") => void;
  onStartDraftSession: (paneId: string, provider: Session["provider"]) => void;
  onRestoreDraftSession: (paneId: string, record: SessionHistoryRecord) => void;
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
  terminals,
  agentInputEnabled,
  locale,
  isPaneActive,
  theme,
  terminalFontSize,
  terminalCompatibilityMode,
  draftPaneMode,
  historyLoading,
  restoreCandidates,
  displaySessionTitle,
  onRemoveUnavailableSession,
  onSetActivePane,
  onSplitPane,
  onCloseAgentPane,
  onDraftPaneModeChange,
  onStartDraftSession,
  onRestoreDraftSession,
  setAgentTerminalRef,
  onAgentTerminalData,
  onAgentTerminalSize,
  t,
}: AgentPaneLeafProps) => {
  const visibleStatus = displaySessionStatus(session);
  const progress = (() => {
    const ratio = sessionCompletionRatio(session);
    if (ratio > 0) return Math.max(14, ratio);
    if (visibleStatus === "running") return 34;
    return 6;
  })();
  const tone = visibleStatus === "running" ? "live" : "idle";
  const statusTone = sessionTone(visibleStatus);
  const headerTag = sessionHeaderTag(visibleStatus, locale);
  const renderState = resolveAgentPaneRenderState(session, isPaneActive, agentInputEnabled);
  const terminalMode = renderState.kind === "draft" ? "interactive" : renderState.terminalMode;
  const terminalBinding = resolveAgentPaneTerminalBinding(session, terminalMode, terminals);

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

  const handleStartDraftSession = useCallback((provider: Session["provider"]) => {
    onStartDraftSession(paneId, provider);
  }, [onStartDraftSession, paneId]);

  const handleRestoreDraftSession = useCallback((record: SessionHistoryRecord) => {
    onRestoreDraftSession(paneId, record);
  }, [onRestoreDraftSession, paneId]);

  const handleTerminalRef = useCallback((handle: XtermBaseHandle | null) => {
    setAgentTerminalRef(paneId, handle);
  }, [paneId, setAgentTerminalRef]);

  const handleTerminalData = useCallback((data: string) => {
    onAgentTerminalData(paneId, data);
  }, [onAgentTerminalData, paneId]);

  const handleTerminalSize = useCallback((size: { cols: number; rows: number }) => {
    onAgentTerminalSize(paneId, tabId, session.id, size);
  }, [onAgentTerminalSize, paneId, session.id, tabId]);

  const handleRemoveUnavailableSession = useCallback(() => {
    onRemoveUnavailableSession(session.id);
  }, [onRemoveUnavailableSession, session.id]);

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
          <span className="agent-pane-state-tag muted" data-tone="muted">
            {getProviderDisplayLabel(session.provider)}
          </span>
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
                <div className="agent-draft-restore-list">
                  {BUILTIN_PROVIDER_MANIFESTS.map((manifest) => (
                    <button
                      key={manifest.id}
                      type="button"
                      className="agent-draft-restore-item"
                      onClick={() => handleStartDraftSession(manifest.id)}
                      data-testid={`draft-start-${manifest.id}-${paneId}`}
                    >
                      <strong>{manifest.badgeLabel}</strong>
                      <span>{getProviderDisplayLabel(manifest.id)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="agent-draft-restore-list">
                  {historyLoading ? (
                    <div className="agent-draft-launcher-empty">{t("loading")}</div>
                  ) : restoreCandidates.length === 0 ? (
                    <div className="agent-draft-launcher-empty">{t("draftRestoreEmpty")}</div>
                  ) : (
                    restoreCandidates.map((record) => (
                      <button
                        key={`${record.workspaceId}:${record.sessionId}`}
                        type="button"
                        className="agent-draft-restore-item"
                        onClick={() => handleRestoreDraftSession(record)}
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
        ) : session.unavailableReason ? (
          <div className="terminal-empty">
            <strong>{t("sessionUnavailableTitle")}</strong>
            <div>{session.unavailableReason}</div>
            <button type="button" className="btn tiny" onClick={handleRemoveUnavailableSession}>
              {t("historyRemove")}
            </button>
          </div>
        ) : (!terminalBinding.stream.trim() && terminalMode === "readonly") ? (
          <div className="terminal-empty">{t("noAgentOutputYet")}</div>
        ) : terminalBinding.renderMode === "transcript" ? (
          <div className={`agent-pane-transcript-shell ${terminalMode}`}>
            <ShellTerminal
              ref={handleTerminalRef}
              terminalId={session.id}
              outputIdentity={terminalBinding.streamId}
              outputSyncStrategy={terminalBinding.syncStrategy}
              output={terminalBinding.stream}
              theme={theme}
              fontSize={terminalFontSize}
              compatibilityMode={terminalCompatibilityMode}
              mode={terminalMode}
              autoFocus={terminalMode === "interactive"}
              onData={terminalMode === "interactive" ? handleTerminalData : undefined}
              onSize={handleTerminalSize}
            />
            <pre className="agent-pane-transcript-output" aria-hidden="true">
              {sanitizeAnsiTranscript(terminalBinding.stream)}
            </pre>
          </div>
        ) : (
          <ShellTerminal
            ref={handleTerminalRef}
            terminalId={session.id}
            outputIdentity={terminalBinding.streamId}
            outputSyncStrategy={terminalBinding.syncStrategy}
            output={terminalBinding.stream}
            theme={theme}
            fontSize={terminalFontSize}
            compatibilityMode={terminalCompatibilityMode}
            mode={terminalMode}
            autoFocus={terminalMode === "interactive"}
            onData={terminalMode === "interactive" ? handleTerminalData : undefined}
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
  && previous.terminals === next.terminals
  && previous.agentInputEnabled === next.agentInputEnabled
  && previous.locale === next.locale
  && previous.isPaneActive === next.isPaneActive
  && previous.theme === next.theme
  && previous.terminalFontSize === next.terminalFontSize
  && previous.terminalCompatibilityMode === next.terminalCompatibilityMode
  && previous.draftPaneMode === next.draftPaneMode
  && previous.historyLoading === next.historyLoading
  && previous.restoreCandidates === next.restoreCandidates
));

AgentPaneLeaf.displayName = "AgentPaneLeaf";

export const AgentWorkspaceFeature = ({
  visible,
  agentInputEnabled,
  locale,
  activeTab,
  activePaneSession,
  showCodePanel,
  theme,
  terminalFontSize,
  terminalCompatibilityMode,
  draftPaneModes,
  historyLoading,
  restoreCandidates,
  displaySessionTitle,
  onRemoveUnavailableSession,
  onSetActivePane,
  onSplitPane,
  onCloseAgentPane,
  onDraftPaneModeChange,
  onStartDraftSession,
  onRestoreDraftSession,
  setAgentTerminalRef,
  onAgentTerminalData,
  onAgentTerminalSize,
  onPaneSplitResizeStart,
  onCodeResizeStart,
  t,
}: AgentWorkspaceFeatureProps) => {
  if (!visible) return null;

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
        terminals={activeTab.terminals}
        agentInputEnabled={agentInputEnabled}
        locale={locale}
        isPaneActive={isPaneActive}
        theme={theme}
        terminalFontSize={terminalFontSize}
        terminalCompatibilityMode={terminalCompatibilityMode}
        draftPaneMode={draftPaneModes[node.id] ?? "new"}
        historyLoading={historyLoading}
        restoreCandidates={restoreCandidates}
        displaySessionTitle={displaySessionTitle}
        onRemoveUnavailableSession={onRemoveUnavailableSession}
        onSetActivePane={onSetActivePane}
        onSplitPane={onSplitPane}
        onCloseAgentPane={onCloseAgentPane}
        onDraftPaneModeChange={onDraftPaneModeChange}
        onStartDraftSession={onStartDraftSession}
        onRestoreDraftSession={onRestoreDraftSession}
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
        className="panel center-panel workspace-agent-shell studio-panel compact"
        style={{ flex: "1 1 0%" }}
      >
        {renderAgentPane(activeTab.paneLayout)}
      </section>

      {showCodePanel && <div className="v-resizer" data-resize="left" onPointerDown={onCodeResizeStart} />}
    </>
  );
};

export default AgentWorkspaceFeature;
