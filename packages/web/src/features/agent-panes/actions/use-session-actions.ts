import { useAtomValue, useStore } from "jotai";
import { useCallback } from "react";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import { sessionByIdAtomFamily } from "../../../atoms/sessions";

const terminalInputEncoder = new TextEncoder();
const SESSION_REMOVAL_POLL_INTERVAL_MS = 100;
const SESSION_REMOVAL_TIMEOUT_MS = 5_000;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export function useSessionActions() {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const store = useStore();

  const stopSession = useCallback(
    async (sessionId: string) => {
      const result = await dispatch<void>("session.stop", { sessionId });
      if (!result.ok) {
        console.error("Failed to stop session:", result.error?.message);
      }
    },
    [dispatch]
  );

  const closeSession = useCallback(
    async (sessionId: string) => {
      const session = store.get(sessionByIdAtomFamily(sessionId));
      if (!session) {
        return;
      }

      if (session.state === "ended") {
        const removeResult = await dispatch<void>("session.remove", { sessionId });
        if (!removeResult.ok) {
          console.error("Failed to remove ended session:", removeResult.error?.message);
        }
        return;
      }

      const stopResult = await dispatch<void>("session.stop", { sessionId });
      if (!stopResult.ok && stopResult.error?.code !== "invalid_state") {
        console.error("Failed to stop session before removal:", stopResult.error?.message);
        return;
      }

      const deadline = Date.now() + SESSION_REMOVAL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const current = store.get(sessionByIdAtomFamily(sessionId));
        if (!current) {
          return;
        }
        if (current.state === "ended") {
          const removeResult = await dispatch<void>("session.remove", { sessionId });
          if (!removeResult.ok) {
            console.error("Failed to remove ended session:", removeResult.error?.message);
          }
          return;
        }
        await delay(SESSION_REMOVAL_POLL_INTERVAL_MS);
      }

      console.error("Timed out waiting for session to end before removal:", sessionId);
    },
    [dispatch, store]
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
          "submit",
          trimmedPrompt
        );
        return true;
      } catch (error) {
        console.error("Failed to submit session prompt:", error);
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
