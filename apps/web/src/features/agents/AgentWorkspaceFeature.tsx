import type { PointerEventHandler, ReactNode } from "react";
import type { Locale, Translator } from "../../i18n";
import type { AppTheme, TerminalCompatibilityMode } from "../../types/app";
import type { Session, SessionPaneNode, Tab } from "../../state/workbench";
import { AgentSendIcon, AgentSplitHorizontalIcon, AgentSplitVerticalIcon, HeaderCloseIcon } from "../../components/icons";
import { AgentStreamTerminal, type XtermBaseHandle } from "../../components/terminal";
import { isHiddenDraftPlaceholder, sessionCompletionRatio, sessionHeaderTag, sessionTone } from "../../shared/utils/session";
import { stripAnsi } from "../../shared/utils/ansi";

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
  displaySessionTitle: (value: string) => string;
  onExitArchive: () => void;
  onSetActivePane: (paneId: string, sessionId: string) => void;
  onSplitPane: (paneId: string, axis: "horizontal" | "vertical") => void;
  onCloseAgentPane: (paneId: string, sessionId: string) => void;
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
  displaySessionTitle,
  onExitArchive,
  onSetActivePane,
  onSplitPane,
  onCloseAgentPane,
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
    const progress = (() => {
      const ratio = sessionCompletionRatio(session);
      if (ratio > 0) return Math.max(14, ratio);
      if (session.status === "running" || session.status === "background") return 34;
      if (session.status === "waiting") return 22;
      return 6;
    })();
    const tone = session.status === "running" || session.status === "background"
      ? "live"
      : session.status === "waiting"
        ? "queued"
        : "idle";
    const statusTone = sessionTone(session.status);
    const headerTag = sessionHeaderTag(session.status, locale);
    const showDraftPromptInput = isHiddenDraftPlaceholder(session);

    return (
      <section
        key={node.id}
        className={`agent-pane-card ${isPaneActive ? "active" : ""}`}
        data-session-id={session.id}
        data-session-status={session.status}
        onMouseDown={() => onSetActivePane(node.id, session.id)}
      >
        <div className={`surface-progress ${tone}`} aria-hidden="true">
          <span className="surface-progress-bar" style={{ width: `${progress}%` }} />
        </div>
        <div className="agent-pane-header">
          <div className="agent-pane-header-copy">
            <span className={`session-top-dot ${statusTone} ${statusTone === "active" ? "pulse" : ""}`} />
            <span className="agent-pane-title">{displaySessionTitle(session.title)}</span>
          </div>
          <div className="agent-pane-meta">
            <span className={`agent-pane-state-tag ${headerTag.tone}`}>{headerTag.label}</span>
            <div className="agent-pane-actions">
              <button
                type="button"
                className="pane-action split"
                onClick={() => onSplitPane(node.id, "vertical")}
                title={t("splitVertical")}
                aria-label={t("splitVertical")}
              >
                <AgentSplitHorizontalIcon />
              </button>
              <button
                type="button"
                className="pane-action split"
                onClick={() => onSplitPane(node.id, "horizontal")}
                title={t("splitHorizontal")}
                aria-label={t("splitHorizontal")}
              >
                <AgentSplitVerticalIcon />
              </button>
              <button
                type="button"
                className="pane-action close"
                onClick={() => onCloseAgentPane(node.id, session.id)}
                title={t("close")}
              >
                <HeaderCloseIcon />
              </button>
            </div>
          </div>
        </div>
        <div className="agent-pane-body" data-testid={`agent-pane-${node.id}`}>
          {showDraftPromptInput ? (
            <div className="agent-draft-launcher">
              <div className="agent-draft-launcher-card">
                <div className="agent-draft-launcher-copy">
                  <div className="agent-draft-launcher-title">{t("draftSessionPrompt")}</div>
                  <div className="agent-draft-launcher-hint">{t("draftTaskPlaceholder")}</div>
                </div>
                <form
                  className="agent-pane-input agent-draft-launcher-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSubmitDraftPrompt(node.id);
                  }}
                >
                  <div className="agent-compose">
                    <input
                      ref={(element) => setDraftPromptInputRef(node.id, element)}
                      className="agent-compose-field agent-draft-launcher-field"
                      value={draftPromptInputs[node.id] ?? ""}
                      onChange={(event) => onDraftPromptChange(node.id, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.nativeEvent as KeyboardEvent).isComposing) {
                          event.preventDefault();
                        }
                      }}
                      placeholder={t("draftTaskPlaceholder")}
                      aria-label={t("draftTaskPlaceholder")}
                      data-testid={`agent-draft-input-${node.id}`}
                      autoFocus={isPaneActive}
                    />
                    <button
                      type="submit"
                      className="agent-send-button"
                      disabled={!draftPromptInputs[node.id]?.trim()}
                      title={t("send")}
                      aria-label={t("send")}
                    >
                      <AgentSendIcon />
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <AgentStreamTerminal
              ref={(handle) => setAgentTerminalRef(node.id, handle)}
              streamId={session.id}
              stream={session.stream}
              toneKey={isPaneActive ? "active" : "inactive"}
              theme={theme}
              fontSize={terminalFontSize}
              compatibilityMode={terminalCompatibilityMode}
              mode="interactive"
              autoFocus={isPaneActive}
              onData={(data) => {
                onAgentTerminalData(node.id, data);
              }}
              onSize={(size) => onAgentTerminalSize(node.id, activeTab.id, session.id, size)}
            />
          )}
        </div>
      </section>
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
                <div className="agent-pane-header">
                  <div className="agent-pane-header-copy">
                    <span className={`session-top-dot ${sessionTone(viewedSession.status)} ${sessionTone(viewedSession.status) === "active" ? "pulse" : ""}`} />
                    <span className="agent-pane-title">{displaySessionTitle(viewedSession.title)}</span>
                  </div>
                  <div className="agent-pane-meta">
                    <span className={`agent-pane-state-tag ${viewedHeaderTag.tone}`}>{viewedHeaderTag.label}</span>
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
