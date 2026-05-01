import { useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import type { Session } from '@coder-studio/core';
import { wsClientAtom } from '../../atoms/connection';

const terminalInputEncoder = new TextEncoder();

interface MobileComposerProps {
  activeSession: Session | null;
}

export function MobileComposer({ activeSession }: MobileComposerProps) {
  const wsClient = useAtomValue(wsClientAtom);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const trimmedDraft = draft.trim();

  const canSend = Boolean(activeSession && wsClient && trimmedDraft && !submitting);

  const handleSubmit = async () => {
    const rawDraft = textareaRef.current?.value ?? draft;
    const trimmedDraft = rawDraft.trim();

    if (!activeSession || !wsClient || !trimmedDraft || submitting) {
      return;
    }

    setSubmitting(true);

    try {
      await wsClient.sendTerminalInput(
        activeSession.terminalId,
        terminalInputEncoder.encode(`${trimmedDraft}\r`),
        'submit',
        trimmedDraft
      );
      setDraft('');
    } catch (error) {
      console.error('Failed to send mobile composer input:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mobile-composer">
      <button
        type="button"
        className="mobile-composer__icon-button"
        aria-label="Open attachments"
        disabled
      >
        ＋
      </button>

      <textarea
        ref={textareaRef}
        className="mobile-composer__input"
        aria-label="Agent composer"
        placeholder={activeSession ? '给当前 agent 发一条指令' : '先打开或创建一个 agent'}
        rows={1}
        maxLength={2000}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void handleSubmit();
          }
        }}
      />

      <button
        type="button"
        className="mobile-composer__send"
        aria-label="Send prompt"
        disabled={!canSend}
        onClick={() => {
          void handleSubmit();
        }}
      >
        {submitting ? '...' : '发送'}
      </button>
    </div>
  );
}
