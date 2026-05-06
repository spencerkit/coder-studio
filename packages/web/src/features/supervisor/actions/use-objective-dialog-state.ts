import { useAtom, useAtomValue } from "jotai";
import { useCallback } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import { supervisorDialogAtom, supervisorsAtom } from "../atoms";

export type ObjectiveDialogMode = "enable" | "edit" | "disable";
export type ObjectiveDialogEvaluatorProviderId = "claude" | "codex";

export const OBJECTIVE_DIALOG_EVALUATOR_OPTIONS = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
] as const;

const CLOSED_DIALOG_STATE = {
  open: false,
  sessionId: null,
  mode: "enable" as const,
  draftObjective: "",
  draftEvaluatorProviderId: "claude" as const,
};

interface UseObjectiveDialogStateOptions {
  workspaceId: string;
  sessionId?: string;
}

export function useObjectiveDialogState({
  workspaceId,
  sessionId,
}: UseObjectiveDialogStateOptions) {
  const [dialog, setDialog] = useAtom(supervisorDialogAtom);
  const supervisors = useAtomValue(supervisorsAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const t = useTranslation();

  const effectiveSessionId = sessionId ?? dialog.sessionId;
  const supervisor = effectiveSessionId ? supervisors.get(effectiveSessionId) : undefined;
  const isVisible = dialog.open && (!sessionId || dialog.sessionId === sessionId);
  const mode = dialog.mode;
  const copy = {
    title: t(`supervisor.dialog.${mode}.title`),
    subtitle: t(`supervisor.dialog.${mode}.subtitle`),
    confirm: t(`supervisor.dialog.${mode}.confirm`),
  };
  const isDisable = mode === "disable";
  const disableObjective = supervisor?.objective ?? dialog.draftObjective;

  const close = useCallback(() => {
    setDialog(CLOSED_DIALOG_STATE);
  }, [setDialog]);

  const updateDraft = useCallback(
    (
      patch: Partial<{
        draftObjective: string;
        draftEvaluatorProviderId: ObjectiveDialogEvaluatorProviderId;
      }>
    ) => {
      setDialog((current) => ({ ...current, ...patch }));
    },
    [setDialog]
  );

  const confirm = useCallback(async () => {
    if (!dialog.sessionId) {
      return false;
    }

    if (dialog.mode === "disable") {
      if (!supervisor) {
        return false;
      }

      const result = await dispatch("supervisor.delete", { id: supervisor.id });
      if (result.ok) {
        close();
        return true;
      }
      return false;
    }

    const objective = dialog.draftObjective.trim();
    if (!objective) {
      return false;
    }

    if (dialog.mode === "enable") {
      const result = await dispatch("supervisor.create", {
        sessionId: dialog.sessionId,
        workspaceId,
        objective,
        evaluatorProviderId: dialog.draftEvaluatorProviderId,
      });

      if (result.ok) {
        close();
        return true;
      }
      return false;
    }

    if (!supervisor) {
      return false;
    }

    const result = await dispatch("supervisor.update", {
      id: supervisor.id,
      objective,
      evaluatorProviderId: dialog.draftEvaluatorProviderId,
    });

    if (result.ok) {
      close();
      return true;
    }

    return false;
  }, [close, dialog, dispatch, supervisor, workspaceId]);

  return {
    dialog,
    supervisor,
    isVisible,
    mode,
    copy,
    isDisable,
    disableObjective,
    close,
    updateDraft,
    confirm,
  };
}
