import type { Session, Supervisor } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect } from "react";
import { connectionStatusAtom, dispatchCommandAtom } from "../../../atoms/connection";
import { supervisorDialogAtom, supervisorHydratedAtomFamily, supervisorsAtom } from "../atoms";
import { formatScheduledAtInput } from "./use-objective-dialog-state";

const EMPTY_SESSION_ID = "__supervisor-empty__";

export function useSupervisor(session: Session | null | undefined) {
  const sessionId = session?.id ?? EMPTY_SESSION_ID;
  const store = useStore();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setDialog = useSetAtom(supervisorDialogAtom);
  const setSupervisors = useSetAtom(supervisorsAtom);
  const setHydrated = useSetAtom(supervisorHydratedAtomFamily(sessionId));

  useEffect(() => {
    if (!session?.id) {
      return;
    }

    const hydratedAtom = supervisorHydratedAtomFamily(session.id);
    if (connectionStatus !== "connected") {
      if (store.get(hydratedAtom)) {
        setHydrated(false);
      }
      return;
    }

    if (session.capability !== "full" || session.state === "draft" || session.state === "ended") {
      return;
    }

    if (store.get(hydratedAtom)) {
      return;
    }

    setHydrated(true);
    let cancelled = false;

    void dispatch<{ supervisor: Supervisor | null }>("supervisor.get", {
      sessionId: session.id,
    }).then((result) => {
      if (cancelled || !result.ok) {
        return;
      }

      const supervisor = result.data?.supervisor ?? null;
      setSupervisors((prev) => {
        const next = new Map(prev);
        if (supervisor) {
          next.set(session.id, supervisor);
        } else {
          next.delete(session.id);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, dispatch, session, setHydrated, setSupervisors, store]);

  const openDialog = useCallback(
    (mode: "enable" | "edit", supervisor?: Supervisor) => {
      setDialog({
        open: true,
        sessionId,
        mode,
        restoreStep: "form",
        returnToDetails: mode === "edit",
        draftObjective: supervisor?.objective ?? "",
        initialObjective: supervisor?.objective ?? "",
        draftEvaluatorProviderId:
          (supervisor?.evaluatorProviderId as "claude" | "codex") ?? "claude",
        draftEvaluatorModel: supervisor?.evaluatorModel ?? "",
        draftMaxSupervisionCount: String(supervisor?.maxSupervisionCount ?? 0),
        draftScheduledAt: formatScheduledAtInput(supervisor?.scheduledAt),
        recoverableTargets: [],
        selectedRecoverableTargetId: null,
        isRecoverableTargetsLoading: false,
      });
    },
    [sessionId, setDialog]
  );

  return { openDialog };
}
