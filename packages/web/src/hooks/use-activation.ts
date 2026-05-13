import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import {
  activationGenerationAtom,
  activationReasonAtom,
  activationStatusAtom,
  clientInstanceIdAtom,
} from "../atoms/activation";
import { connectionStatusAtom, wsClientAtom } from "../atoms/connection";

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
  const claimInFlightRef = useRef<Promise<boolean> | null>(null);

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
    return () => {
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
