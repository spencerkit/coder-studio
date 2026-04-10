import { memo, useCallback, type PointerEventHandler, type ReactNode } from "react";
import type { Locale, Translator } from "../../i18n";
import type {
  AppTheme,
  TerminalCompatibilityMode,
} from "../../types/app";
import type { Session, SessionPaneNode, Tab } from "../../state/workbench";
import { AgentSplitHorizontalIcon, AgentSplitVerticalIcon, BadgeCheckIcon, CirclePauseIcon, HeaderCloseIcon, MessageSquareIcon, PlayIcon, RefreshIcon, SquareIcon } from "../../components/icons";
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
  displaySessionTitle: (value: string) => string;
  onRemoveUnavailableSession: (sessionId: string) => void;
  onSetActivePane: (paneId: string, sessionId: string) => void;
  onSplitPane: (paneId: string, axis: "horizontal" | "vertical") => void;
  onCloseAgentPane: (paneId: string, sessionId: string) => void;
  onStartDraftSession: (paneId: string, provider: Session["provider"]) => void;
  onEnableSupervisor: (sessionId: string, provider: Session["provider"]) => void;
  onEditSupervisorObjective: (sessionId: string, currentObjective: string) => void;
  onPauseSupervisor: (sessionId: string) => void;
  onResumeSupervisor: (sessionId: string) => void;
  onDisableSupervisor: (sessionId: string) => void;
  onRetrySupervisor: (sessionId: string) => void;
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
  displaySessionTitle: (value: string) => string;
  onRemoveUnavailableSession: (sessionId: string) => void;
  onSetActivePane: (paneId: string, sessionId: string) => void;
  onSplitPane: (paneId: string, axis: "horizontal" | "vertical") => void;
  onCloseAgentPane: (paneId: string, sessionId: string) => void;
  onStartDraftSession: (paneId: string, provider: Session["provider"]) => void;
  onEnableSupervisor: (sessionId: string, provider: Session["provider"]) => void;
  onEditSupervisorObjective: (sessionId: string, currentObjective: string) => void;
  onPauseSupervisor: (sessionId: string) => void;
  onResumeSupervisor: (sessionId: string) => void;
  onDisableSupervisor: (sessionId: string) => void;
  onRetrySupervisor: (sessionId: string) => void;
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
  displaySessionTitle,
  onRemoveUnavailableSession,
  onSetActivePane,
  onSplitPane,
  onCloseAgentPane,
  onStartDraftSession,
  onEnableSupervisor,
  onEditSupervisorObjective,
  onPauseSupervisor,
  onResumeSupervisor,
  onDisableSupervisor,
  onRetrySupervisor,
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

  const handleStartDraftSession = useCallback((provider: Session["provider"]) => {
    onStartDraftSession(paneId, provider);
  }, [onStartDraftSession, paneId]);

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

  const supervisor = session.supervisor;
  const supervisorStatusTone = (() => {
    switch (supervisor?.status) {
      case "evaluating":
      case "injecting":
        return "active";
      case "paused":
        return "muted";
      case "error":
        return "queue";
      default:
        return "info";
    }
  })();
  const supervisorStatusLabel = supervisor ? `Supervisor ${supervisor.status}` : "Supervisor off";
  const latestCycle = supervisor?.latestCycle;
  const latestCycleSummary = latestCycle?.error
    ?? latestCycle?.supervisorReply
    ?? latestCycle?.supervisorInput
    ?? "";
  const handleEnableSupervisor = useCallback(() => {
    onEnableSupervisor(session.id, session.provider);
  }, [onEnableSupervisor, session.id, session.provider]);
  const handleEditSupervisorObjective = useCallback(() => {
    if (!supervisor) return;
    onEditSupervisorObjective(session.id, supervisor.objectiveText);
  }, [onEditSupervisorObjective, session.id, supervisor]);
  const handlePauseSupervisor = useCallback(() => {
    onPauseSupervisor(session.id);
  }, [onPauseSupervisor, session.id]);
  const handleResumeSupervisor = useCallback(() => {
    onResumeSupervisor(session.id);
  }, [onResumeSupervisor, session.id]);
  const handleDisableSupervisor = useCallback(() => {
    onDisableSupervisor(session.id);
  }, [onDisableSupervisor, session.id]);

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
          <div className="agent-pane-supervisor">
            <div className="agent-pane-supervisor-card" data-state={supervisor ? supervisor.status : "off"}>
              <div className="agent-pane-supervisor-copy">
                <div className="agent-pane-supervisor-label-row">
                  <BadgeCheckIcon />
                  <span className="agent-pane-supervisor-label">Supervisor</span>
                  <span className={`agent-pane-state-tag ${supervisorStatusTone}`} data-tone={supervisorStatusTone}>
                    {supervisorStatusLabel}
                  </span>
                </div>
              </div>
              <div className="agent-pane-supervisor-actions">
                {supervisor ? (
                  <>
                    <button
                      type="button"
                      className="pane-action split"
                      onClick={handleEditSupervisorObjective}
                      title="Edit supervisor objective"
                      aria-label="Edit supervisor objective"
                    >
                      <MessageSquareIcon />
                    </button>
                    {supervisor.status === "paused" ? (
                      <button
                        type="button"
                        className="pane-action split"
                        onClick={handleResumeSupervisor}
                        title="Resume supervisor"
                        aria-label="Resume supervisor"
                      >
                        <PlayIcon />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="pane-action split"
                        onClick={handlePauseSupervisor}
                        title="Pause supervisor"
                        aria-label="Pause supervisor"
                      >
                        <CirclePauseIcon />
                      </button>
                    )}
                    {latestCycle?.status === "failed" ? (
                      <button
                        type="button"
                        className="pane-action split"
                        onClick={handleRetrySupervisor}
                        title="Retry supervisor"
                        aria-label="Retry supervisor"
                      >
                        <RefreshIcon />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="pane-action close"
                      onClick={handleDisableSupervisor}
                      title="Disable supervisor"
                      aria-label="Disable supervisor"
                    >
                      <SquareIcon />
                    </button>
                  </>
                ) : !session.isDraft ? (
                  <button
                    type="button"
                    className="pane-action split"
                    onClick={handleEnableSupervisor}
                    title={t("supervisorEnableTitle")}
                    aria-label={t("supervisorEnableTitle")}
                  >
                    <PlayIcon />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
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
  displaySessionTitle,
  onRemoveUnavailableSession,
  onSetActivePane,
  onSplitPane,
  onCloseAgentPane,
  onStartDraftSession,
  onEnableSupervisor,
  onEditSupervisorObjective,
  onPauseSupervisor,
  onResumeSupervisor,
  onDisableSupervisor,
  onRetrySupervisor,
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
        displaySessionTitle={displaySessionTitle}
        onRemoveUnavailableSession={onRemoveUnavailableSession}
        onSetActivePane={onSetActivePane}
        onSplitPane={onSplitPane}
        onCloseAgentPane={onCloseAgentPane}
        onStartDraftSession={onStartDraftSession}
        onEnableSupervisor={onEnableSupervisor}
        onEditSupervisorObjective={onEditSupervisorObjective}
        onPauseSupervisor={onPauseSupervisor}
        onResumeSupervisor={onResumeSupervisor}
        onDisableSupervisor={onDisableSupervisor}
        onRetrySupervisor={onRetrySupervisor}
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
  const handleRetrySupervisor = useCallback(() => {
    onRetrySupervisor(session.id);
  }, [onRetrySupervisor, session.id]);
