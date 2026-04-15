/**
 * Supervisor Card Component (Phase 3)
 *
 * Displays supervisor state and action buttons for an agent session.
 */

import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import type { Supervisor, SupervisorState } from '@coder-studio/core';
import { supervisorsAtom, supervisorDialogAtom } from '../atoms';

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
  const setDialog = useSetAtom(supervisorDialogAtom);
  const supervisor = supervisors.get(sessionId);

  const handleEnable = useCallback(() => {
    setDialog({ open: true, sessionId, mode: 'enable' });
  }, [sessionId, setDialog]);

  const handleEdit = useCallback(() => {
    setDialog({ open: true, sessionId, mode: 'edit' });
  }, [sessionId, setDialog]);

  const handlePause = useCallback(async () => {
    // TODO: Implement pause command
    console.log('Pause supervisor:', supervisor?.id);
  }, [supervisor]);

  const handleResume = useCallback(async () => {
    // TODO: Implement resume command
    console.log('Resume supervisor:', supervisor?.id);
  }, [supervisor]);

  const handleTrigger = useCallback(async () => {
    // TODO: Implement trigger command
    console.log('Trigger evaluation:', supervisor?.id);
  }, [supervisor]);

  const handleDisable = useCallback(async () => {
    // TODO: Implement disable command
    console.log('Disable supervisor:', supervisor?.id);
  }, [supervisor]);

  // No supervisor configured - show enable button
  if (!supervisor) {
    return (
      <div className="supervisor-card supervisor-card-inactive">
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleEnable}
          title="启用 Supervisor"
        >
          <span className="icon">▶</span>
          <span>启用 Supervisor</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`supervisor-card ${STATE_CLASSES[supervisor.state]}`}>
      <div className="supervisor-header">
        <span className="supervisor-icon">✓</span>
        <span className="supervisor-label">Supervisor</span>
        <span className={`supervisor-state-tag ${STATE_CLASSES[supervisor.state]}`}>
          {STATE_LABELS[supervisor.state]}
        </span>
      </div>

      <div className="supervisor-actions">
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleEdit}
          title="编辑目标"
        >
          ✎
        </button>

        {supervisor.state === 'paused' ? (
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleResume}
            title="恢复"
          >
            ▶
          </button>
        ) : (
          <button
            className="btn btn-ghost btn-sm"
            onClick={handlePause}
            title="暂停"
            disabled={supervisor.state === 'evaluating' || supervisor.state === 'injecting'}
          >
            ⏸
          </button>
        )}

        <button
          className="btn btn-ghost btn-sm"
          onClick={handleTrigger}
          title="触发评估"
          disabled={supervisor.state === 'evaluating' || supervisor.state === 'injecting'}
        >
          ↑
        </button>

        <button
          className="btn btn-ghost btn-sm btn-danger"
          onClick={handleDisable}
          title="禁用"
        >
          ■
        </button>
      </div>

      {supervisor.errorReason && (
        <div className="supervisor-error">
          {supervisor.errorReason}
        </div>
      )}
    </div>
  );
}
