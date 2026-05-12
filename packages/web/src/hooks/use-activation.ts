import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import {
  activationGenerationAtom,
  activationReasonAtom,
  activationStatusAtom,
  clientInstanceIdAtom,
} from "../atoms/activation";
import { connectionStatusAtom, wsClientAtom } from "../atoms/connection";

const HEARTBEAT_INTERVAL_MS = 10_000;

interface ActivationClaimPayload {
  active: true;
  generation: number;
  recoveryMode: "fresh" | "grace_recover" | "takeover";
}

export function useActivation() {
  const wsClient = useAtomValue(wsClientAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const clientInstanceId = useAtomValue(clientInstanceIdAtom);
  const [status, setStatus] = useAtom(activationStatusAtom);
  const [generation, setGeneration] = useAtom(activationGenerationAtom);
  const setReason = useSetAtom(activationReasonAtom);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const claimInFlightRef = useRef<Promise<boolean> | null>(null);

  const stopHeartbeat = () => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  };

  const claim = useCallback(async (): Promise<boolean> => {
    if (!wsClient) {
      return false;
    }

    if (connectionStatus !== "connected") {
      try {
        await wsClient.connect();
      } catch {
        setStatus("gated");
        setReason("reconnect_failed");
        return false;
      }
    }

    if (claimInFlightRef.current) {
      return claimInFlightRef.current;
    }

    setStatus("claiming");

    const pending = wsClient
      .sendCommand<ActivationClaimPayload>("activation.claim", {
        clientInstanceId,
      })
      .then((result) => {
        setGeneration(result.generation);
        setReason(null);
        setStatus("active");
        return true;
      })
      .catch((error) => {
        setStatus("gated");
        setReason(error instanceof Error ? error.message : "claim_failed");
        return false;
      })
      .finally(() => {
        claimInFlightRef.current = null;
      });

    claimInFlightRef.current = pending;
    return pending;
  }, [clientInstanceId, connectionStatus, setGeneration, setReason, setStatus, wsClient]);

  useEffect(() => {
    stopHeartbeat();

    if (!wsClient || status !== "active" || generation === null) {
      return;
    }

    heartbeatTimerRef.current = setInterval(() => {
      void wsClient
        .sendCommand<{ ok: boolean }>("activation.heartbeat", {
          clientInstanceId,
          generation,
        })
        .then((result) => {
          if (!result.ok) {
            stopHeartbeat();
            setStatus("gated");
            setReason("heartbeat_rejected");
          }
        })
        .catch(() => {
          stopHeartbeat();
        });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      stopHeartbeat();
    };
  }, [clientInstanceId, generation, setReason, setStatus, status, wsClient]);

  useEffect(() => {
    return () => {
      stopHeartbeat();
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
