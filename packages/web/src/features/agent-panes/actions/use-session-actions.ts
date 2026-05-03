import { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { dispatchCommandAtom, wsClientAtom } from '../../../atoms/connection';

const terminalInputEncoder = new TextEncoder();

export function useSessionActions() {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);

  const stopSession = useCallback(
    async (sessionId: string) => {
      const result = await dispatch<void>('session.stop', { sessionId });
      if (!result.ok) {
        console.error('Failed to stop session:', result.error?.message);
      }
    },
    [dispatch]
  );

  const closeSession = useCallback(
    async (sessionId: string) => {
      await dispatch<void>('session.stop', { sessionId }).catch(() => {});
    },
    [dispatch]
  );

  const submitSessionPrompt = useCallback(
    async (terminalId: string, prompt: string) => {
      const trimmedPrompt = prompt.trim();

      if (!wsClient || !trimmedPrompt) {
        return false;
      }

      try {
        await wsClient.sendTerminalInput(
          terminalId,
          terminalInputEncoder.encode(`${trimmedPrompt}\r`),
          'submit',
          trimmedPrompt
        );
        return true;
      } catch (error) {
        console.error('Failed to submit session prompt:', error);
        return false;
      }
    },
    [wsClient]
  );

  return {
    closeSession,
    submitSessionPrompt,
    stopSession,
  };
}
