import { useAtomValue, useSetAtom } from 'jotai';
import { Bot, Plus, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import type { Session } from '@coder-studio/core';
import { dispatchCommandAtom } from '../../../../atoms/connection';
import { sessionsAtom } from '../../../../atoms/sessions';
import { useTranslation } from '../../../../lib/i18n';
import { MobileInlineSheet } from '../../../../shells/shared/mobile-inline-sheet';
import { useProviderLauncher } from '../../../agent-panes/actions/use-provider-launcher';

interface MobileAgentSheetProps {
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  className?: string;
  defaultMode?: 'list' | 'create';
  sessions: Session[];
  onClose: () => void;
  onCloseSession: (sessionId: string) => Promise<void>;
  onSelectSession: (sessionId: string) => void;
  onSessionCreated: (sessionId: string) => void;
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

export function MobileAgentSheet({
  activeSessionId,
  activeWorkspaceId,
  className,
  defaultMode = 'list',
  sessions,
  onClose,
  onCloseSession,
  onSelectSession,
  onSessionCreated,
}: MobileAgentSheetProps) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setSessions = useSetAtom(sessionsAtom);
  const t = useTranslation();
  const [providerSheetOpen, setProviderSheetOpen] = useState(defaultMode === 'create');

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  const canLaunchSession = Boolean(activeWorkspaceId);
  const providerButtons = [
    {
      id: 'claude' as const,
      title: 'Claude',
      icon: <Sparkles size={16} />,
    },
    {
      id: 'codex' as const,
      title: 'Codex',
      icon: <Bot size={16} />,
    },
  ];

  const closeSheet = () => {
    setProviderSheetOpen(false);
    onClose();
  };

  const { states, launch } = useProviderLauncher(
    dispatch,
    activeWorkspaceId ?? '__workspace_placeholder__',
    (session, _providerId) => {
      setSessions((previous) => ({
        ...previous,
        [session.id]: session,
      }));
      onSessionCreated(session.id);
      closeSheet();
    }
  );

  return (
    <MobileInlineSheet title={t('mobile.agent.title')} className={className} onClose={closeSheet}>
      <div className="mobile-inline-sheet__actions">
        <button
          type="button"
          className={`mobile-inline-sheet__action${providerSheetOpen ? ' mobile-inline-sheet__action--active' : ''}`}
          aria-label={t('action.create_session')}
          disabled={!canLaunchSession}
          onClick={() => {
            setProviderSheetOpen((value) => !value);
          }}
        >
          <Plus size={15} />
          <span>{t('action.create_session')}</span>
        </button>
        {activeSession ? (
          <button
            type="button"
            className="mobile-inline-sheet__action mobile-inline-sheet__action--danger"
            aria-label={t('mobile.agent.close_current_session')}
            onClick={() => {
              void onCloseSession(activeSession.id);
              closeSheet();
            }}
          >
            <X size={15} />
            <span>{t('mobile.agent.close_current_session')}</span>
          </button>
        ) : null}
      </div>

      {providerSheetOpen ? (
        <div className="mobile-inline-sheet__providers" aria-label={t('mobile.agent.providers')}>
          {providerButtons.map((provider) => {
            const state = states[provider.id];
            const isBusy =
              state.loading ||
              state.installJob?.status === 'queued' ||
              state.installJob?.status === 'running';
            return (
              <button
                key={provider.id}
                type="button"
                className="mobile-inline-sheet__provider"
                aria-label={t('mobile.agent.start_session', { provider: provider.title })}
                disabled={!canLaunchSession || isBusy}
                onClick={() => {
                  void launch(provider.id);
                }}
              >
                <span className="mobile-inline-sheet__provider-icon" aria-hidden="true">
                  {provider.icon}
                </span>
                <span className="mobile-inline-sheet__provider-copy">
                  <span className="mobile-inline-sheet__provider-title">{provider.title}</span>
                  <span className="mobile-inline-sheet__provider-meta">
                    {isBusy ? t('mobile.agent.starting') : t('mobile.agent.start_new_session')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {sessions.length > 0 ? (
        <div className="mobile-inline-sheet__list" role="menu" aria-label={t('mobile.agent.active_agents')}>
          {sessions.map((session) => {
            const active = session.id === activeSession?.id;
            const label = formatSessionLabel(session);
            return (
              <button
                key={session.id}
                type="button"
                className={`mobile-inline-sheet__option${active ? ' mobile-inline-sheet__option--active' : ''}`}
                aria-label={t('mobile.agent.switch_to_agent', { name: label })}
                onClick={() => {
                  onSelectSession(session.id);
                  closeSheet();
                }}
              >
                <span className={`mobile-topbar__session-dot mobile-topbar__session-dot--${session.state}`} />
                <span className="mobile-inline-sheet__option-copy">
                  <span className="mobile-inline-sheet__option-title">{label}</span>
                  <span className="mobile-inline-sheet__option-meta">
                    {session.providerId.toUpperCase()}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mobile-inline-sheet__empty">{t('mobile.agent.empty')}</div>
      )}
    </MobileInlineSheet>
  );
}

export default MobileAgentSheet;
