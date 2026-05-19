import { useAtom, useAtomValue } from "jotai";
import { useCallback } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import { supervisorDialogAtom, supervisorsAtom } from "../atoms";

export type ObjectiveDialogMode = "enable" | "edit";
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
  draftEvaluatorModel: "",
  draftMaxSupervisionCount: "0",
  draftScheduledAt: "",
};

export function formatScheduledAtInput(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }

  const date = new Date(value);
  const offsetMinutes = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offsetMinutes * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function parseDraftMaxSupervisionCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function isValidDraftMaxSupervisionCount(value: string | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return false;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0;
}

function parseDraftScheduledAt(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

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
  const isMaxSupervisionCountValid = isValidDraftMaxSupervisionCount(
    dialog.draftMaxSupervisionCount
  );

  const close = useCallback(() => {
    setDialog(CLOSED_DIALOG_STATE);
  }, [setDialog]);

  const updateDraft = useCallback(
    (
      patch: Partial<{
        draftObjective: string;
        draftEvaluatorProviderId: ObjectiveDialogEvaluatorProviderId;
        draftEvaluatorModel: string;
        draftMaxSupervisionCount: string;
        draftScheduledAt: string;
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

    const objective = dialog.draftObjective.trim();
    if (!objective) {
      return false;
    }

    if (!isMaxSupervisionCountValid) {
      return false;
    }

    const evaluatorModel = dialog.draftEvaluatorModel.trim();
    const maxSupervisionCount = parseDraftMaxSupervisionCount(dialog.draftMaxSupervisionCount);
    const scheduledAt = parseDraftScheduledAt(dialog.draftScheduledAt);

    if (dialog.mode === "enable") {
      const result = await dispatch("supervisor.create", {
        sessionId: dialog.sessionId,
        workspaceId,
        objective,
        evaluatorProviderId: dialog.draftEvaluatorProviderId,
        evaluatorModel: evaluatorModel || undefined,
        maxSupervisionCount,
        scheduledAt,
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
      evaluatorModel: evaluatorModel || null,
      maxSupervisionCount,
      scheduledAt: scheduledAt ?? null,
    });

    if (result.ok) {
      close();
      return true;
    }

    return false;
  }, [close, dialog, dispatch, isMaxSupervisionCountValid, supervisor, workspaceId]);

  return {
    dialog,
    supervisor,
    isVisible,
    mode,
    copy,
    isMaxSupervisionCountValid,
    close,
    updateDraft,
    confirm,
    formatScheduledAtInput,
  };
}
