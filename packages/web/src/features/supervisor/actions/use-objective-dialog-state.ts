import { useAtom, useAtomValue } from "jotai";
import { useCallback } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import {
  type RecoverableSupervisorTarget,
  type SupervisorDialogRestoreStep,
  supervisorDialogAtom,
  supervisorsAtom,
} from "../atoms";
import { useSupervisorDetails } from "./use-supervisor-details";

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
  restoreStep: "form" as const,
  returnToDetails: false,
  draftObjective: "",
  initialObjective: "",
  draftEvaluatorProviderId: "claude" as const,
  draftEvaluatorModel: "",
  draftMaxSupervisionCount: "0",
  draftScheduledAt: "",
  recoverableTargets: [] as RecoverableSupervisorTarget[],
  selectedRecoverableTargetId: null as string | null,
  isRecoverableTargetsLoading: false,
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
  const { openDetails } = useSupervisorDetails();
  const t = useTranslation();

  const effectiveSessionId = sessionId ?? dialog.sessionId;
  const supervisor = effectiveSessionId ? supervisors.get(effectiveSessionId) : undefined;
  const isVisible = dialog.open && (!sessionId || dialog.sessionId === sessionId);
  const mode = dialog.mode;
  const restoreStep = dialog.restoreStep ?? "form";
  const copy = {
    title:
      restoreStep === "restore"
        ? t("supervisor.dialog.restore.title")
        : t(`supervisor.dialog.${mode}.title`),
    subtitle:
      restoreStep === "restore"
        ? t("supervisor.dialog.restore.subtitle")
        : t(`supervisor.dialog.${mode}.subtitle`),
    confirm:
      restoreStep === "restore"
        ? t("supervisor.dialog.restore.confirm")
        : t(`supervisor.dialog.${mode}.confirm`),
  };
  const isMaxSupervisionCountValid = isValidDraftMaxSupervisionCount(
    dialog.draftMaxSupervisionCount
  );
  const selectedRecoverableTargetId = dialog.selectedRecoverableTargetId ?? null;
  const recoverableTargets = dialog.recoverableTargets ?? [];
  const isRecoverableTargetsLoading = dialog.isRecoverableTargetsLoading ?? false;
  const trimmedDraftObjective = dialog.draftObjective.trim();
  const hasObjectiveChanged = trimmedDraftObjective !== (dialog.initialObjective?.trim() ?? "");
  const normalizedDraftEvaluatorModel = (dialog.draftEvaluatorModel ?? "").trim();
  const normalizedSupervisorEvaluatorModel = supervisor?.evaluatorModel?.trim() ?? "";
  const draftMaxSupervisionCount = parseDraftMaxSupervisionCount(
    dialog.draftMaxSupervisionCount ?? "0"
  );
  const draftScheduledAt = parseDraftScheduledAt(dialog.draftScheduledAt ?? "") ?? null;
  const supervisorScheduledAt = supervisor?.scheduledAt ?? null;
  const hasSettingsChanged = Boolean(
    supervisor &&
      (dialog.draftEvaluatorProviderId !== supervisor.evaluatorProviderId ||
        normalizedDraftEvaluatorModel !== normalizedSupervisorEvaluatorModel ||
        draftMaxSupervisionCount !== supervisor.maxSupervisionCount ||
        draftScheduledAt !== supervisorScheduledAt)
  );
  const hasChanges = hasObjectiveChanged || hasSettingsChanged;

  const close = useCallback(() => {
    const nextSessionId = dialog.returnToDetails ? dialog.sessionId : null;
    setDialog(CLOSED_DIALOG_STATE);
    if (nextSessionId) {
      openDetails(nextSessionId);
    }
  }, [dialog.returnToDetails, dialog.sessionId, openDetails, setDialog]);

  const updateDraft = useCallback(
    (
      patch: Partial<{
        draftObjective: string;
        draftEvaluatorProviderId: ObjectiveDialogEvaluatorProviderId;
        draftEvaluatorModel: string;
        draftMaxSupervisionCount: string;
        draftScheduledAt: string;
        restoreStep: SupervisorDialogRestoreStep;
        recoverableTargets: RecoverableSupervisorTarget[];
        selectedRecoverableTargetId: string | null;
        isRecoverableTargetsLoading: boolean;
      }>
    ) => {
      setDialog((current) => ({ ...current, ...patch }));
    },
    [setDialog]
  );

  const openRestoreStep = useCallback(async () => {
    setDialog((current) => ({
      ...current,
      restoreStep: "restore",
      isRecoverableTargetsLoading: true,
      recoverableTargets: [],
      selectedRecoverableTargetId: null,
    }));

    const result = await dispatch<{ targets: RecoverableSupervisorTarget[] }>(
      "supervisor.listRecoverableTargets",
      { workspaceId }
    );

    setDialog((current) => {
      if (current.sessionId !== effectiveSessionId) {
        return current;
      }

      return {
        ...current,
        restoreStep: "restore",
        isRecoverableTargetsLoading: false,
        recoverableTargets: result.ok ? (result.data?.targets ?? []) : [],
        selectedRecoverableTargetId: null,
      };
    });
  }, [dispatch, effectiveSessionId, mode, setDialog, workspaceId]);

  const closeRestoreStep = useCallback(() => {
    setDialog((current) => ({
      ...current,
      restoreStep: "form",
      isRecoverableTargetsLoading: false,
      selectedRecoverableTargetId: null,
    }));
  }, [setDialog]);

  const selectRecoverableTarget = useCallback(
    (targetId: string) => {
      setDialog((current) => ({
        ...current,
        selectedRecoverableTargetId: targetId,
      }));
    },
    [setDialog]
  );

  const confirm = useCallback(async () => {
    if (!dialog.sessionId) {
      return false;
    }

    if (!isMaxSupervisionCountValid) {
      return false;
    }

    const evaluatorModel = dialog.draftEvaluatorModel.trim();
    const maxSupervisionCount = parseDraftMaxSupervisionCount(dialog.draftMaxSupervisionCount);
    const scheduledAt = parseDraftScheduledAt(dialog.draftScheduledAt);

    if (restoreStep === "restore") {
      if (!selectedRecoverableTargetId) {
        return false;
      }

      const result = await dispatch("supervisor.restore", {
        sessionId: dialog.sessionId,
        workspaceId,
        sourceTargetId: selectedRecoverableTargetId,
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

    const objective = trimmedDraftObjective;
    if (!objective) {
      return false;
    }

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
  }, [
    close,
    dialog,
    dispatch,
    isMaxSupervisionCountValid,
    restoreStep,
    selectedRecoverableTargetId,
    supervisor,
    workspaceId,
  ]);

  return {
    dialog,
    supervisor,
    isVisible,
    mode,
    restoreStep,
    copy,
    isMaxSupervisionCountValid,
    recoverableTargets,
    selectedRecoverableTargetId,
    isRecoverableTargetsLoading,
    hasObjectiveChanged,
    hasSettingsChanged,
    hasChanges,
    close,
    updateDraft,
    openRestoreStep,
    closeRestoreStep,
    selectRecoverableTarget,
    confirm,
    formatScheduledAtInput,
  };
}
