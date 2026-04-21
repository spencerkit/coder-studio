/**
 * Supervisor Card Component (Phase 3)
 *
 * Displays supervisor state, recent evaluation history, and actions.
 */

import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo } from 'react';
import type { SupervisorCycle, SupervisorState } from '@coder-studio/core';
import {
  supervisorCyclesAtom,
  supervisorDialogAtom,
  supervisorsAtom,
} from '../atoms';
import { dispatchCommandAtom } from '../../../atoms/connection';

interface SupervisorCardProps {
  sessionId: string;
  workspaceId: string;
}

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

export function SupervisorCard({ sessionId, workspaceId }: SupervisorCardProps) {
  const supervisors = useAtomValue(supervisorsAtom);
  const cyclesBySupervisor = useAtomValue(supervisorCyclesAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setDialog = useSetAtom(supervisorDialogAtom);
  const supervisor = supervisors.get(sessionId);

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

  const cycles = useMemo(() => {
    if (!supervisor) {
      return [] as SupervisorCycle[];
    }

    return [...(cyclesBySupervisor.get(supervisor.id) ?? supervisor.cycles ?? [])].sort(
      (left, right) =>
        (right.completedAt ?? right.createdAt) - (left.completedAt ?? left.createdAt)
    );
  }, [cyclesBySupervisor, supervisor]);

  const latestCycle = cycles[0];
  const progress = Math.max(0, Math.min(latestCycle?.progress ?? 0, 100));

  const handlePause = useCallback(async () => {
    if (!supervisor) {
      return;
    }

    await dispatch('supervisor.pause', { id: supervisor.id });
  }, [dispatch, supervisor]);

  const handleResume = useCallback(async () => {
    if (!supervisor) {
      return;
    }

    await dispatch('supervisor.resume', { id: supervisor.id });
  }, [dispatch, supervisor]);

  const handleTrigger = useCallback(async () => {
    if (!supervisor) {
      return;
    }

    await dispatch('supervisor.trigger', { id: supervisor.id });
  }, [dispatch, supervisor]);

  if (!supervisor) {
    return (
      <div className="supervisor-card supervisor-card-inactive">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => openDialog('enable')}
          title="启用 Supervisor"
        >
          <span className="icon">▶</span>
          <span>启用 Supervisor</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`supervisor-card ${STATE_CLASSES[supervisor.state]}`} data-workspace-id={workspaceId}>
      <div className="supervisor-header">
        <span className="supervisor-icon">✓</span>
        <span className="supervisor-label">Supervisor</span>
        <span className={`supervisor-state-tag ${STATE_CLASSES[supervisor.state]}`}>
          {STATE_LABELS[supervisor.state]}
        </span>
      </div>

      <div className="supervisor-objective-row">
        <span className="supervisor-objective-text" title={supervisor.objective}>
          {supervisor.objective}
        </span>
        <span className="supervisor-provider-pill">{supervisor.evaluatorProviderId}</span>
      </div>

      {latestCycle ? (
        <div className="supervisor-progress-block">
          <div className="supervisor-progress-track" aria-hidden="true">
            <div className="supervisor-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <ol className="supervisor-history-list">
            {cycles.slice(0, 3).map((cycle) => (
              <li key={cycle.id} className="supervisor-history-item">
                <span>{cycle.trigger === 'manual' ? 'Manual' : 'Auto'}</span>
                <span>{cycle.progress ?? 0}%</span>
                <span>{cycle.result ?? cycle.errorReason ?? '等待评估结果'}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="supervisor-actions">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => openDialog('edit')}
          title="编辑目标"
          aria-label="编辑目标"
        >
          ✎
        </button>

        {supervisor.state === 'paused' ? (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void handleResume();
            }}
            title="恢复"
            aria-label="恢复"
          >
            ▶
          </button>
        ) : (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void handlePause();
            }}
            title="暂停"
            aria-label="暂停"
            disabled={supervisor.state === 'evaluating' || supervisor.state === 'injecting'}
          >
            ⏸
          </button>
        )}

        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void handleTrigger();
          }}
          title="触发评估"
          aria-label="触发评估"
          disabled={supervisor.state === 'evaluating' || supervisor.state === 'injecting'}
        >
          ↑
        </button>

        <button
          className="btn btn-ghost btn-sm btn-danger"
          onClick={() => openDialog('disable')}
          title="禁用 Supervisor"
          aria-label="禁用 Supervisor"
        >
          ■
        </button>
      </div>

      {supervisor.errorReason ? <div className="supervisor-error">{supervisor.errorReason}</div> : null}
    </div>
  );
}
