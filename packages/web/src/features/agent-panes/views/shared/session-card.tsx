/**
 * Session Card Component
 *
 * Individual agent session panel with terminal output,
 * status indicators, and control buttons.
 */

import type { SessionState } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { FlipHorizontal, FlipVertical, Square, X } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { pendingFocusSessionAtom } from "../../../../atoms/app-ui";
import { sessionByIdAtomFamily } from "../../../../atoms/sessions";
import { workspaceByIdAtomFamily } from "../../../../atoms/workspaces";
import { IconButton, StatusDot, Tag, Tooltip } from "../../../../components/ui";
import { PanelHeader } from "../../../shared/components/panel-header";
import { useSupervisor } from "../../../supervisor/actions/use-supervisor";
import { SupervisorCard } from "../../../supervisor/views/shared/supervisor-card";
import { XtermHost } from "../../../terminal-panel/views/shared/xterm-host";
import { usePersistWorkspaceLastViewedTarget } from "../../../workspace/actions/use-persist-workspace-last-viewed-target";
import { useWorkspaceUiStatePersistence } from "../../../workspace/actions/use-workspace-ui-state-persistence";

type SessionCardAction = () => void | Promise<void>;

interface SessionCardProps {
  sessionId: string;
  showHeaderActions?: boolean;
  showSupervisorInline?: boolean;
  terminalReadOnlyOverride?: boolean;
  headerAccessory?: ReactNode;
  onClose?: SessionCardAction;
  onSplitHorizontal?: SessionCardAction;
  onSplitVertical?: SessionCardAction;
  onStop?: SessionCardAction;
}

/**
 * Session Card
 *
 * PRD §8.3.1:
 *   - Header: status dot, title, provider badge, status label, actions
 *   - Terminal area (xterm.js)
 */
export const SessionCard: FC<SessionCardProps> = ({
  sessionId,
  showHeaderActions = true,
  showSupervisorInline = true,
  terminalReadOnlyOverride,
  headerAccessory,
  onClose,
  onSplitHorizontal,
  onSplitVertical,
  onStop,
}) => {
  const session = useAtomValue(sessionByIdAtomFamily(sessionId));
  const workspace = useAtomValue(
    workspaceByIdAtomFamily(session?.workspaceId ?? "__workspace_empty__")
  );
  const pendingFocus = useAtomValue(pendingFocusSessionAtom);
  const setPendingFocus = useSetAtom(pendingFocusSessionAtom);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [highlight, setHighlight] = useState(false);
  useSupervisor(session);
  const { persistUiState } = useWorkspaceUiStatePersistence(
    session?.workspaceId ?? "__workspace_empty__"
  );
  const persistLastViewedTarget = usePersistWorkspaceLastViewedTarget();

  useEffect(() => {
    if (pendingFocus !== sessionId) {
      return;
    }
    const node = cardRef.current;
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
    setHighlight(true);
    setPendingFocus(null);
    const timer = setTimeout(() => setHighlight(false), 1_400);
    return () => clearTimeout(timer);
  }, [pendingFocus, sessionId, setPendingFocus]);

  if (!session) {
    return null;
  }

  const sessionTitle = session.title?.trim() || formatSessionLabel(session.id);
  const providerLabel = formatProviderLabel(session.providerId);
  const sessionStateLabel = formatSessionStateLabel(session.state);
  const terminalReadOnly = terminalReadOnlyOverride ?? !isSessionInteractive(session.state);
  const isActiveSession = workspace?.uiState.activeSessionId === session.id;
  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest('button, a, input, textarea, select, [role="button"]')) {
      return;
    }

    if (workspace?.uiState.activeSessionId === session.id) {
      return;
    }

    void persistLastViewedTarget({
      workspaceId: session.workspaceId,
      sessionId: session.id,
    });
    void persistUiState({ activeSessionId: session.id });
  };

  return (
    <div
      ref={cardRef}
      className={`session-card agent-pane${isActiveSession ? " session-card--active" : ""}${highlight ? " session-card--focus-pulse" : ""}`}
      data-session-id={sessionId}
      onClick={handleCardClick}
    >
      <PanelHeader
        title={sessionTitle}
        metaPlacement="inline"
        status={
          <StatusDot
            tone={getSessionDotTone(session.state)}
            pulse={shouldPulseSessionDot(session.state)}
            className={`session-dot ${getSessionDotClass(session.state)}`}
          />
        }
        meta={
          <div className="session-title-row">
            <Tag color="blue" className="session-provider-badge">
              {providerLabel}
            </Tag>
            <Tag
              color={getSessionTagColor(session.state)}
              className="session-state-badge"
              caps={false}
            >
              {sessionStateLabel}
            </Tag>
          </div>
        }
        actions={
          showHeaderActions || headerAccessory ? (
            <div className="session-header-right">
              {headerAccessory ? (
                <div className="session-header-accessory">{headerAccessory}</div>
              ) : null}

              {showHeaderActions ? (
                <div className="session-header-actions">
                  {session.state === "running" ? (
                    <Tooltip content="Stop">
                      <IconButton
                        aria-label="Stop"
                        className="session-action-btn"
                        icon={<Square size={13} />}
                        onClick={() => void onStop?.()}
                        size="sm"
                      />
                    </Tooltip>
                  ) : null}
                  <Tooltip content="Split horizontal">
                    <IconButton
                      aria-label="Split horizontal"
                      className="session-action-btn"
                      icon={<FlipHorizontal size={13} />}
                      onClick={() => onSplitHorizontal?.()}
                      size="sm"
                    />
                  </Tooltip>
                  <Tooltip content="Split vertical">
                    <IconButton
                      aria-label="Split vertical"
                      className="session-action-btn"
                      icon={<FlipVertical size={13} />}
                      onClick={() => onSplitVertical?.()}
                      size="sm"
                    />
                  </Tooltip>
                  <Tooltip content="Close">
                    <IconButton
                      aria-label="Close"
                      className="session-action-btn session-action-btn-close"
                      icon={<X size={14} />}
                      onClick={() => void onClose?.()}
                      size="sm"
                    />
                  </Tooltip>
                </div>
              ) : null}
            </div>
          ) : null
        }
      />

      {showSupervisorInline &&
      session.capability === "full" &&
      session.state !== "draft" &&
      session.state !== "ended" ? (
        <>
          <SupervisorCard sessionId={session.id} workspaceId={session.workspaceId} />
        </>
      ) : null}

      <div className="session-terminal">
        <XtermHost
          terminalId={session.terminalId}
          workspaceId={session.workspaceId}
          readOnly={terminalReadOnly}
          isActiveSession={isActiveSession}
          terminalKind="agent"
        />
      </div>
    </div>
  );
};

function getSessionDotClass(state: SessionState) {
  switch (state) {
    case "starting":
      return "session-dot-starting";
    case "running":
      return "session-dot-running";
    case "ended":
      return "session-dot-complete";
    default:
      return "session-dot-idle";
  }
}

function getSessionDotTone(state: SessionState): "success" | "warning" | "info" | "neutral" {
  switch (state) {
    case "starting":
      return "warning";
    case "running":
      return "info";
    case "ended":
      return "success";
    default:
      return "neutral";
  }
}

function shouldPulseSessionDot(state: SessionState) {
  switch (state) {
    case "starting":
      return true;
    default:
      return false;
  }
}

function getSessionTagColor(state: SessionState): "amber" | "green" | "blue" | "neutral" {
  switch (state) {
    case "starting":
      return "amber";
    case "running":
      return "green";
    case "ended":
      return "blue";
    default:
      return "neutral";
  }
}

function formatSessionLabel(sessionId: string) {
  const numericId = sessionId.match(/(\d+)/)?.[1];

  if (numericId) {
    return `SESSION-${numericId.slice(-2).padStart(2, "0")}`;
  }

  return sessionId.replace(/[_-]/g, " ").toUpperCase();
}

function formatSessionStateLabel(state: SessionState) {
  return state.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatProviderLabel(providerId: string) {
  return providerId.replace(/\b\w/g, (char) => char.toUpperCase());
}

function isSessionInteractive(state: SessionState) {
  return state === "running" || state === "idle" || state === "starting";
}

export default SessionCard;
