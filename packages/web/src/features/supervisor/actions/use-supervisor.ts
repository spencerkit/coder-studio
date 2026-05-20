import type { Session, Supervisor } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import {
  supervisorCyclesAtom,
  supervisorDialogAtom,
  supervisorHydratedAtomFamily,
  supervisorsAtom,
} from "../atoms";
import { formatScheduledAtInput } from "./use-objective-dialog-state";

const EMPTY_SESSION_ID = "__supervisor-empty__";

export function useSupervisor(session: Session | null | undefined) {
  const sessionId = session?.id ?? EMPTY_SESSION_ID;
  const dispatch = useAtomValue(dispatchCommandAtom);
  const hydrated = useAtomValue(supervisorHydratedAtomFamily(sessionId));
  const setHydrated = useSetAtom(supervisorHydratedAtomFamily(sessionId));
  const setSupervisors = useSetAtom(supervisorsAtom);
  const setCycles = useSetAtom(supervisorCyclesAtom);
  const setDialog = useSetAtom(supervisorDialogAtom);

  useEffect(() => {
    if (!session) {
      return;
    }

    if (
      hydrated ||
      session.capability !== "full" ||
      session.state === "draft" ||
      session.state === "ended"
    ) {
      return;
    }

    let cancelled = false;

    void dispatch<{ supervisor: Supervisor | null }>("supervisor.get", {
      sessionId: session.id,
    }).then((result) => {
      if (cancelled || !result.ok) {
        return;
      }

      const supervisor = result.data?.supervisor ?? null;

      if (supervisor) {
        setSupervisors((prev) => {
          const next = new Map(prev);
          next.set(session.id, supervisor);
          return next;
        });
        setCycles((prev) => {
          const next = new Map(prev);
          next.set(supervisor.id, supervisor.cycles ?? []);
          return next;
        });
      } else {
        setSupervisors((prev) => {
          const next = new Map(prev);
          next.delete(session.id);
          return next;
        });
      }

      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [dispatch, hydrated, session, setCycles, setHydrated, setSupervisors]);

  const openDialog = useCallback(
    (mode: "enable" | "edit", supervisor?: Supervisor) => {
      setDialog({
        open: true,
        sessionId,
        mode,
        restoreStep: "form",
        draftObjective: supervisor?.objective ?? "",
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
