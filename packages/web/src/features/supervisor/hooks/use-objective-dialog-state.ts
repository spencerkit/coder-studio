import { useAtom, useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { supervisorDialogAtom, supervisorsAtom } from '../atoms';

export type ObjectiveDialogMode = 'enable' | 'edit' | 'disable';
export type ObjectiveDialogEvaluatorProviderId = 'claude' | 'codex';

export const OBJECTIVE_DIALOG_EVALUATOR_OPTIONS = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
] as const;

export const OBJECTIVE_DIALOG_MODE_COPY: Record<
  ObjectiveDialogMode,
  { title: string; subtitle: string; confirm: string }
> = {
  enable: {
    title: '启用 Supervisor',
    subtitle: '描述一个目标,Supervisor 会在每轮结束后自动评估并提示下一步',
    confirm: '启用',
  },
  edit: {
    title: '编辑 Supervisor',
    subtitle: '调整目标描述或切换评估方,历史评估不会被清除',
    confirm: '保存',
  },
  disable: {
    title: '禁用 Supervisor',
    subtitle: '停止自动评估。当前会话的监督周期将被移除',
    confirm: '禁用',
  },
};

const CLOSED_DIALOG_STATE = {
  open: false,
  sessionId: null,
  mode: 'enable' as const,
  draftObjective: '',
  draftEvaluatorProviderId: 'claude' as const,
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

  const supervisor = dialog.sessionId ? supervisors.get(dialog.sessionId) : undefined;
  const isVisible = dialog.open && (!sessionId || dialog.sessionId === sessionId);
  const mode = dialog.mode;
  const copy = OBJECTIVE_DIALOG_MODE_COPY[mode];
  const isDisable = mode === 'disable';
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

    if (dialog.mode === 'disable') {
      if (!supervisor) {
        return false;
      }

      const result = await dispatch('supervisor.delete', { id: supervisor.id });
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

    if (dialog.mode === 'enable') {
      const result = await dispatch('supervisor.create', {
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

    const result = await dispatch('supervisor.update', {
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
