import { useSetAtom } from 'jotai';
import { MoreHorizontal, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { commandPaletteOpenAtom } from '../../../../atoms/app-ui';
import type { Session, Workspace } from '@coder-studio/core';

interface MobileTopBarProps {
  activeWorkspace: Workspace | null;
  activeSessionId: string | null;
  drawerOpen: boolean;
  sessions: Session[];
  onSelectSession: (sessionId: string) => void;
  onToggleDrawer: () => void;
}

function formatSessionLabel(session: Session) {
  if (session.title?.trim()) {
    return session.title.trim();
  }

  if (session.providerId) {
    return session.providerId.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  const numericId = session.id.match(/(\d+)/)?.[1];
  if (numericId) {
    return `SESSION-${numericId.slice(-2).padStart(2, '0')}`;
  }

  return session.id.replace(/[_-]/g, ' ').toUpperCase();
}

export function MobileTopBar({
  activeWorkspace,
  activeSessionId,
  drawerOpen,
  sessions,
  onSelectSession,
  onToggleDrawer,
}: MobileTopBarProps) {
  const navigate = useNavigate();
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenAtom);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);

  const workspaceLabel =
    activeWorkspace?.name ??
    activeWorkspace?.path?.split('/').filter(Boolean).pop() ??
    activeWorkspace?.path ??
    '选择工作区';
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  const activeSessionLabel = activeSession ? formatSessionLabel(activeSession) : 'No active agent';

  return (
    <header className="mobile-topbar">
      <button
        type="button"
        className="mobile-topbar__workspace-button"
        onClick={() => {
          setActionsOpen(false);
          setSessionMenuOpen(false);
          onToggleDrawer();
        }}
        aria-label="Switch workspace"
        aria-expanded={drawerOpen}
      >
        <span className="mobile-topbar__workspace-leading">☰</span>
        <span className="mobile-topbar__workspace-copy">
          <span className="mobile-topbar__workspace-name">{workspaceLabel}</span>
          <span className="mobile-topbar__workspace-chevron">▾</span>
        </span>
      </button>

      {sessions.length > 0 ? (
        <div className="mobile-topbar__session-switcher">
          <button
            type="button"
            className="mobile-topbar__session-button"
            aria-label="Switch active agent"
            aria-expanded={sessionMenuOpen}
            onClick={() => {
              setActionsOpen(false);
              setSessionMenuOpen((value) => !value);
            }}
          >
            <span className="mobile-topbar__session-copy">
              <span className="mobile-topbar__session-label">Agent</span>
              <span className="mobile-topbar__session-name">{activeSessionLabel}</span>
            </span>
            <span className="mobile-topbar__workspace-chevron">▾</span>
          </button>

          {sessionMenuOpen ? (
            <div className="mobile-topbar__session-menu" role="menu" aria-label="Active agents">
              {sessions.map((session) => {
                const active = session.id === activeSession?.id;
                const label = formatSessionLabel(session);
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`mobile-topbar__session-option${active ? ' mobile-topbar__session-option--active' : ''}`}
                    aria-label={`Switch to agent ${label}`}
                    onClick={() => {
                      onSelectSession(session.id);
                      setSessionMenuOpen(false);
                    }}
                  >
                    <span className={`mobile-topbar__session-dot mobile-topbar__session-dot--${session.state}`} />
                    <span className="mobile-topbar__session-option-label">{label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mobile-topbar__session-switcher mobile-topbar__session-switcher--empty">
          <span className="mobile-topbar__session-empty">No active agent</span>
        </div>
      )}

      <div className="mobile-topbar__actions">
        <button
          type="button"
          className="mobile-topbar__icon-button"
          aria-label="Open more actions"
          aria-expanded={actionsOpen}
          onClick={() => {
            setSessionMenuOpen(false);
            setActionsOpen((value) => !value);
          }}
        >
          <MoreHorizontal size={18} />
        </button>

        {actionsOpen ? (
          <div className="mobile-topbar__menu" role="menu" aria-label="Mobile actions">
            <button
              type="button"
              className="mobile-topbar__menu-item"
              onClick={() => {
                setCommandPaletteOpen(true);
                setActionsOpen(false);
                setSessionMenuOpen(false);
              }}
              aria-label="Open quick actions"
            >
              <Search size={16} />
              <span>Quick Actions</span>
            </button>
            <button
              type="button"
              className="mobile-topbar__menu-item"
              onClick={() => {
                navigate('/settings');
                setActionsOpen(false);
                setSessionMenuOpen(false);
              }}
              aria-label="Open settings"
            >
              <span>Settings</span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
