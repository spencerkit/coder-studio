import type { Session } from '@coder-studio/core';

interface MobileAgentStripProps {
  activeSessionId: string | null;
  sessions: Session[];
  onSelect: (sessionId: string) => void;
}

export function MobileAgentStrip({
  activeSessionId,
  sessions,
  onSelect,
}: MobileAgentStripProps) {
  return (
    <div className="mobile-agent-strip" role="tablist" aria-label="Mobile agents">
      {sessions.map((session) => {
        const label = formatMobileSessionLabel(session);
        const active = session.id === activeSessionId;

        return (
          <button
            key={session.id}
            type="button"
            className={`mobile-agent-strip__chip${active ? ' mobile-agent-strip__chip--active' : ''}`}
            aria-pressed={active}
            aria-label={`Switch to agent ${label}`}
            onClick={() => onSelect(session.id)}
          >
            <span className={`mobile-agent-strip__dot mobile-agent-strip__dot--${session.state}`} />
            <span className="mobile-agent-strip__label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function formatMobileSessionLabel(session: Session) {
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
