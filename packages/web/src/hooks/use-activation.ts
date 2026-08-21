import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import {
  activationGenerationAtom,
  activationReasonAtom,
  activationStatusAtom,
  clientInstanceIdAtom,
} from "../atoms/activation";
import { connectionStatusAtom, wsClientAtom } from "../atoms/connection";
import { logStartupTraceOnce } from "../startup-trace";

interface ActivationClaimPayload {
  active: true;
  generation: number;
  recoveryMode: "fresh" | "grace_recover" | "takeover";
}

const CLAIM_RETRY_DELAY_MS = 1_000;

export function useActivation() {
  const wsClient = useAtomValue(wsClientAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const clientInstanceId = useAtomValue(clientInstanceIdAtom);
  const [status, setStatus] = useAtom(activationStatusAtom);
  const [generation, setGeneration] = useAtom(activationGenerationAtom);
  const setReason = useSetAtom(activationReasonAtom);
  const claimInFlightRef = useRef<Promise<boolean> | null>(null);
  const claimRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const claim = useCallback(async (): Promise<boolean> => {
    if (!wsClient) {
      return false;
    }

    if (connectionStatus !== "connected") {
      try {
        await wsClient.connect();
      } catch {
        setReason(null);
        setStatus((current) => (current === "gated" ? current : "idle"));
        return false;
      }
    }

    if (claimInFlightRef.current) {
      return claimInFlightRef.current;
    }

    setStatus("claiming");
    logStartupTraceOnce("activation:claim_started");

    const pending = wsClient
      .sendCommand<ActivationClaimPayload>("activation.claim", {
        clientInstanceId,
      })
      .then((result) => {
        logStartupTraceOnce("activation:claim_succeeded", {
          generation: result.generation,
          recoveryMode: result.recoveryMode,
        });
        setGeneration(result.generation);
        setReason(null);
        setStatus("active");
        return true;
      })
      .catch(() => {
        logStartupTraceOnce("activation:claim_failed");
        setReason(null);
        setStatus((current) => (current === "gated" ? current : "idle"));
        return false;
      })
      .finally(() => {
        claimInFlightRef.current = null;
      });

    claimInFlightRef.current = pending;
    return pending;
  }, [clientInstanceId, connectionStatus, setGeneration, setReason, setStatus, wsClient]);

  useEffect(() => {
    if (claimRetryTimerRef.current !== null) {
      clearTimeout(claimRetryTimerRef.current);
      claimRetryTimerRef.current = null;
    }

    if (!wsClient || connectionStatus !== "connected" || status !== "idle") {
      return;
    }

    claimRetryTimerRef.current = setTimeout(() => {
      claimRetryTimerRef.current = null;
      if (!claimInFlightRef.current) {
        void claim();
      }
    }, CLAIM_RETRY_DELAY_MS);

    return () => {
      if (claimRetryTimerRef.current !== null) {
        clearTimeout(claimRetryTimerRef.current);
        claimRetryTimerRef.current = null;
      }
    };
  }, [claim, connectionStatus, status, wsClient]);

  useEffect(() => {
    return () => {
      if (claimRetryTimerRef.current !== null) {
        clearTimeout(claimRetryTimerRef.current);
        claimRetryTimerRef.current = null;
      }

      if (!wsClient || generation === null) {
        return;
      }

      void wsClient
        .sendCommand("activation.release", {
          clientInstanceId,
          generation,
        })
        .catch(() => {});
    };
  }, [clientInstanceId, generation, wsClient]);

  return {
    status,
    generation,
    claim,
  };
}
