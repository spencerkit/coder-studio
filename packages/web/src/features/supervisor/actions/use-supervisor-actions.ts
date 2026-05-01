import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import type { Supervisor, SupervisorCycle, SupervisorState } from '@coder-studio/core';
import { dispatchCommandAtom } from '../../../atoms/connection';
import {
  supervisorCyclesAtom,
  supervisorDialogAtom,
  supervisorsAtom,
} from '../atoms';

const STATE_LABELS: Record<SupervisorState, string> = {
  inactive: '未启用',
  idle: '空闲',
  evaluating: '评估中',
  injecting: '注入中',
  paused: '已暂停',
  error: '错误',
};

const STATE_CLASSES: Record<SupervisorState, string> = {
  inactive: 'supervisor-state-inactive',
  idle: 'supervisor-state-idle',
  evaluating: 'supervisor-state-evaluating',
  injecting: 'supervisor-state-injecting',
  paused: 'supervisor-state-paused',
  error: 'supervisor-state-error',
};

interface UseSupervisorActionsArgs {
  sessionId: string;
}

export function useSupervisorActions({ sessionId }: UseSupervisorActionsArgs) {
  const supervisors = useAtomValue(supervisorsAtom);
  const cyclesBySupervisor = useAtomValue(supervisorCyclesAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setDialog = useSetAtom(supervisorDialogAtom);
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
    (mode: 'enable' | 'edit' | 'disable') => {
      setDialog({
        open: true,
        sessionId,
        mode,
        draftObjective: supervisor?.objective ?? '',
        draftEvaluatorProviderId:
          (supervisor?.evaluatorProviderId as 'claude' | 'codex') ?? 'claude',
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

    await runAction('supervisor.pause', supervisor.id, '暂停失败');
  }, [runAction, supervisor]);

  const handleResume = useCallback(async () => {
    if (!supervisor) {
      return;
    }

    await runAction('supervisor.resume', supervisor.id, '恢复失败');
  }, [runAction, supervisor]);

  const handleTrigger = useCallback(async () => {
    if (!supervisor) {
      return;
    }

    await runAction('supervisor.trigger', supervisor.id, '触发评估失败');
  }, [runAction, supervisor]);

  const cycles = supervisor
    ? [...(cyclesBySupervisor.get(supervisor.id) ?? supervisor.cycles ?? [])].sort(
        (left, right) =>
          (right.completedAt ?? right.createdAt) - (left.completedAt ?? left.createdAt)
      )
    : ([] as SupervisorCycle[]);

  const latestCycle = cycles[0];
  const latestCycleText = latestCycle
    ? latestCycle.result ??
      latestCycle.errorReason ??
      (latestCycle.status === 'completed'
        ? '本轮无需注入 guidance'
        : latestCycle.status === 'evaluating'
          ? '评估中…'
          : '等待评估结果')
    : null;

  return {
    actionError,
    cycles,
    handlePause,
    handleResume,
    handleTrigger,
    isBusy: supervisor?.state === 'evaluating' || supervisor?.state === 'injecting',
    latestCycle,
    latestCycleText,
    openDialog,
    stateClass: supervisor ? STATE_CLASSES[supervisor.state] : STATE_CLASSES.inactive,
    stateLabel: supervisor ? STATE_LABELS[supervisor.state] : STATE_LABELS.inactive,
    supervisor,
  };
}
