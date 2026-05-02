import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import type { Supervisor, SupervisorCycle, SupervisorState } from '@coder-studio/core';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { useTranslation } from '../../../lib/i18n';
import {
  supervisorCyclesAtom,
  supervisorDialogAtom,
  supervisorsAtom,
} from '../atoms';

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

    await runAction('supervisor.pause', supervisor.id, t('supervisor.action.pause_failed'));
  }, [runAction, supervisor, t]);

  const handleResume = useCallback(async () => {
    if (!supervisor) {
      return;
    }

    await runAction('supervisor.resume', supervisor.id, t('supervisor.action.resume_failed'));
  }, [runAction, supervisor, t]);

  const handleTrigger = useCallback(async () => {
    if (!supervisor) {
      return;
    }

    await runAction('supervisor.trigger', supervisor.id, t('supervisor.action.trigger_failed'));
  }, [runAction, supervisor, t]);

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
        ? t('supervisor.cycle.no_guidance')
        : latestCycle.status === 'evaluating'
          ? t('supervisor.cycle.evaluating')
          : t('supervisor.cycle.waiting'))
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
    stateLabel: t(
      `supervisor.state.${supervisor ? supervisor.state : ('inactive' as SupervisorState)}`
    ),
    supervisor,
  };
}
