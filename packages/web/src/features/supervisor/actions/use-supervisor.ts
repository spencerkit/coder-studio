import type { Session, Supervisor } from "@coder-studio/core";
import { useSetAtom } from "jotai";
import { useCallback } from "react";
import { supervisorDialogAtom } from "../atoms";
import { formatScheduledAtInput } from "./use-objective-dialog-state";

const EMPTY_SESSION_ID = "__supervisor-empty__";

export function useSupervisor(session: Session | null | undefined) {
  const sessionId = session?.id ?? EMPTY_SESSION_ID;
  const setDialog = useSetAtom(supervisorDialogAtom);

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
