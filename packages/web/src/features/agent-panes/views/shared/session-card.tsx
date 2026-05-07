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
import { StatusDot, Tag } from "../../../../components/ui";
import { useSupervisor } from "../../../supervisor/actions/use-supervisor";
import { ObjectiveDialog } from "../../../supervisor/views/shared/objective-dialog";
import { SupervisorCard } from "../../../supervisor/views/shared/supervisor-card";
import { XtermHost } from "../../../terminal-panel/views/shared/xterm-host";
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
 *   - Progress bar (top)
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

  const progressWidth = getProgressWidth(session.state);
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

    void persistUiState({ activeSessionId: session.id });
  };

  return (
    <div
      ref={cardRef}
      className={`session-card agent-pane${highlight ? " session-card--focus-pulse" : ""}`}
      data-session-id={sessionId}
      onClick={handleCardClick}
    >
      <div className="session-progress">
        <div
          className={`session-progress-bar ${getSessionProgressClass(session.state)}`}
          style={{ width: `${progressWidth}%` }}
        />
      </div>

      <div className="session-header">
        <div className="session-header-left">
          <StatusDot
            tone={getSessionDotTone(session.state)}
            pulse={shouldPulseSessionDot(session.state)}
            className={`session-dot ${getSessionDotClass(session.state)}`}
          />
          <div className="session-header-copy">
            <div className="session-title-row">
              <span className="session-title">{sessionTitle}</span>
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
          </div>
        </div>

        {showHeaderActions || headerAccessory ? (
          <div className="session-header-right">
            {headerAccessory ? (
              <div className="session-header-accessory">{headerAccessory}</div>
            ) : null}

            {showHeaderActions ? (
              <div className="session-header-actions">
                {session.state === "running" ? (
                  <button
                    className="session-action-btn"
                    onClick={() => void onStop?.()}
                    title="Stop"
                    aria-label="Stop"
                  >
                    <Square size={13} />
                  </button>
                ) : null}
                <button
                  className="session-action-btn"
                  onClick={() => onSplitHorizontal?.()}
                  title="Split horizontal"
                  aria-label="Split horizontal"
                >
                  <FlipHorizontal size={13} />
                </button>
                <button
                  className="session-action-btn"
                  onClick={() => onSplitVertical?.()}
                  title="Split vertical"
                  aria-label="Split vertical"
                >
                  <FlipVertical size={13} />
                </button>
                <button
                  className="session-action-btn session-action-btn-close"
                  onClick={() => void onClose?.()}
                  title="Close"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {showSupervisorInline &&
      session.capability === "full" &&
      session.state !== "draft" &&
      session.state !== "ended" ? (
        <>
          <SupervisorCard sessionId={session.id} workspaceId={session.workspaceId} />
          <ObjectiveDialog workspaceId={session.workspaceId} sessionId={session.id} />
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

function getProgressWidth(state: SessionState): number {
  switch (state) {
    case "starting":
      return 18;
    case "running":
      return 42;
    case "ended":
      return 100;
    default:
      return 8;
  }
}

function getSessionProgressClass(state: SessionState) {
  switch (state) {
    case "starting":
      return "session-progress-starting";
    case "running":
      return "session-progress-running";
    case "idle":
      return "session-progress-idle";
    case "ended":
      return "session-progress-complete";
    default:
      return "session-progress-idle";
  }
}

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
