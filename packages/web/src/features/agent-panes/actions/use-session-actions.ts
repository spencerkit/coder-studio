import { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { dispatchCommandAtom } from '../../../atoms/connection';

export function useSessionActions() {
  const dispatch = useAtomValue(dispatchCommandAtom);

  const resumeSession = useCallback(
    async (sessionId: string) => {
      const result = await dispatch<{ sessionId: string }>('session.resume', { sessionId });
      if (!result.ok) {
        console.error('Failed to resume session:', result.error?.message);
      }
    },
    [dispatch]
  );

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

  return {
    closeSession,
    resumeSession,
    stopSession,
  };
}
