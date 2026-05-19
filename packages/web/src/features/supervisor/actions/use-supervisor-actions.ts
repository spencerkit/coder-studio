import type { SupervisorState } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import { supervisorCyclesAtom, supervisorDialogAtom, supervisorsAtom } from "../atoms";
import { formatScheduledAtInput } from "./use-objective-dialog-state";

const STATE_CLASSES: Record<SupervisorState, string> = {
  inactive: "supervisor-state-inactive",
  idle: "supervisor-state-idle",
  evaluating: "supervisor-state-evaluating",
  injecting: "supervisor-state-injecting",
  paused: "supervisor-state-paused",
  error: "supervisor-state-error",
  stopped: "supervisor-state-stopped",
};

interface UseSupervisorActionsArgs {
  sessionId: string;
}

export function useSupervisorActions({ sessionId }: UseSupervisorActionsArgs) {
  const supervisors = useAtomValue(supervisorsAtom);
  const cyclesBySupervisor = useAtomValue(supervisorCyclesAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setDialog = useSetAtom(supervisorDialogAtom);
  const t = useTranslation();
  const supervisor = supervisors.get(sessionId);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!actionError) {
      return;
    }

    const timer = window.setTimeout(() => setActionError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [actionError]);

  const openDialog = useCallback(
    (mode: "enable" | "edit" | "disable") => {
      setDialog({
        open: true,
        sessionId,
        mode,
        draftObjective: supervisor?.objective ?? "",
        draftEvaluatorProviderId:
          (supervisor?.evaluatorProviderId as "claude" | "codex") ?? "claude",
        draftEvaluatorModel: supervisor?.evaluatorModel ?? "",
        draftMaxSupervisionCount: String(supervisor?.maxSupervisionCount ?? 0),
        draftScheduledAt: formatScheduledAtInput(supervisor?.scheduledAt),
      });
    },
    [sessionId, setDialog, supervisor]
  );

  const runAction = useCallback(
    async (op: string, id: string, failureLabel: string) => {
      setActionError(null);
      const result = await dispatch(op, { id });
      if (!result.ok) {
        setActionError(
          result.error?.message ? `${failureLabel}: ${result.error.message}` : failureLabel
        );
      }
    },
    [dispatch]
  );

  const handlePause = useCallback(async () => {
    if (!supervisor) {
      return;
    }

    await runAction("supervisor.pause", supervisor.id, t("supervisor.action.pause_failed"));
  }, [runAction, supervisor, t]);

  const handleResume = useCallback(async () => {
    if (!supervisor) {
      return;
    }

    await runAction("supervisor.resume", supervisor.id, t("supervisor.action.resume_failed"));
  }, [runAction, supervisor, t]);

  const handleTrigger = useCallback(async () => {
    if (!supervisor) {
      return;
    }

    await runAction("supervisor.trigger", supervisor.id, t("supervisor.action.trigger_failed"));
  }, [runAction, supervisor, t]);

  const hasInFlightCycle = [
    ...(cyclesBySupervisor.get(supervisor?.id ?? "") ?? supervisor?.cycles ?? []),
  ].some((cycle) => cycle.status === "evaluating" || cycle.status === "queued");

  const stopReasonLabel = supervisor?.stopReason
    ? t(`supervisor.stop_reason.${supervisor.stopReason}`)
    : null;

  return {
    actionError,
    handlePause,
    handleResume,
    handleTrigger,
    isBusy:
      supervisor?.state === "evaluating" || supervisor?.state === "injecting" || hasInFlightCycle,
    openDialog,
    stopReasonLabel,
    stateClass: supervisor ? STATE_CLASSES[supervisor.state] : STATE_CLASSES.inactive,
    stateLabel: t(
      `supervisor.state.${supervisor ? supervisor.state : ("inactive" as SupervisorState)}`
    ),
    supervisor,
  };
}
