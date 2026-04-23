/**
 * Supervisor Strip Component (Phase 3)
 *
 * Compact supervisor controls rendered directly under the session header.
 * Shows: state pill · objective · progress · latest cycle banner · actions.
 * The full cycle history lives in a dedicated drawer (not rendered here).
 */

import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpCircle,
  Eye,
  Pause,
  Pencil,
  Play,
  PowerOff,
} from 'lucide-react';
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
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!actionError) return;
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

  const runAction = useCallback(
    async (op: string, id: string, failureLabel: string) => {
      setActionError(null);
      const result = await dispatch(op, { id });
      if (!result.ok) {
        setActionError(
          result.error?.message
            ? `${failureLabel}: ${result.error.message}`
            : failureLabel
        );
      }
    },
    [dispatch]
  );

  const handlePause = useCallback(async () => {
    if (!supervisor) return;
    await runAction('supervisor.pause', supervisor.id, '暂停失败');
  }, [runAction, supervisor]);

  const handleResume = useCallback(async () => {
    if (!supervisor) return;
    await runAction('supervisor.resume', supervisor.id, '恢复失败');
  }, [runAction, supervisor]);

  const handleTrigger = useCallback(async () => {
    if (!supervisor) return;
    await runAction('supervisor.trigger', supervisor.id, '触发评估失败');
  }, [runAction, supervisor]);

  if (!supervisor) {
    return (
      <div className="supervisor-card supervisor-card-inactive">
        <button
          className="supervisor-enable-btn"
          onClick={() => openDialog('enable')}
          title="启用 Supervisor"
        >
          <Eye size={13} />
          <span>启用 Supervisor</span>
        </button>
      </div>
    );
  }

  const isBusy = supervisor.state === 'evaluating' || supervisor.state === 'injecting';

  return (
    <div
      className={`supervisor-card ${STATE_CLASSES[supervisor.state]}`}
      data-workspace-id={workspaceId}
    >
      <div className="supervisor-strip-row">
        <span className="supervisor-strip-eyebrow">
          <span className={`supervisor-pulse ${STATE_CLASSES[supervisor.state]}`} aria-hidden="true" />
          <span className="supervisor-label">Supervisor</span>
        </span>

        <span className={`supervisor-state-tag ${STATE_CLASSES[supervisor.state]}`}>
          {STATE_LABELS[supervisor.state]}
        </span>

        <div className="supervisor-actions">
          <button
            className="supervisor-icon-btn"
            onClick={() => openDialog('edit')}
            title="编辑目标"
            aria-label="编辑目标"
          >
            <Pencil size={12} />
          </button>

          {supervisor.state === 'paused' ? (
            <button
              className="supervisor-icon-btn"
              onClick={() => {
                void handleResume();
              }}
              title="恢复"
              aria-label="恢复"
            >
              <Play size={12} />
            </button>
          ) : (
            <button
              className="supervisor-icon-btn"
              onClick={() => {
                void handlePause();
              }}
              title="暂停"
              aria-label="暂停"
              disabled={isBusy}
            >
              <Pause size={12} />
            </button>
          )}

          <button
            className="supervisor-icon-btn"
            onClick={() => {
              void handleTrigger();
            }}
            title="触发评估"
            aria-label="触发评估"
            disabled={isBusy}
          >
            <ArrowUpCircle size={12} />
          </button>

          <button
            className="supervisor-icon-btn supervisor-icon-btn-danger"
            onClick={() => openDialog('disable')}
            title="禁用 Supervisor"
            aria-label="禁用 Supervisor"
          >
            <PowerOff size={12} />
          </button>
        </div>
      </div>

      <div className="supervisor-objective-row" onDoubleClick={() => openDialog('edit')}>
        <span className="supervisor-objective-text" title={supervisor.objective}>
          {supervisor.objective}
        </span>
        <span className="supervisor-provider-pill">{supervisor.evaluatorProviderId}</span>
      </div>

      <div className="supervisor-progress-block">
        <div className="supervisor-progress-track" aria-hidden="true">
          <div className="supervisor-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        {latestCycle ? (
          <ol className="supervisor-history-list" aria-label="最近一次评估">
            <li className="supervisor-history-item" data-trigger={latestCycle.trigger}>
              <span className="supervisor-history-trigger">
                {latestCycle.trigger === 'manual' ? 'MANUAL' : 'AUTO'}
              </span>
              <span className="supervisor-history-progress">{latestCycle.progress ?? 0}%</span>
              <span className="supervisor-history-result">
                {latestCycle.result ?? latestCycle.errorReason ?? '等待评估结果'}
              </span>
            </li>
          </ol>
        ) : null}
      </div>

      {actionError ? (
        <div className="supervisor-error" role="alert">
          {actionError}
        </div>
      ) : supervisor.errorReason ? (
        <div className="supervisor-error" role="alert">
          {supervisor.errorReason}
        </div>
      ) : null}
    </div>
  );
}
