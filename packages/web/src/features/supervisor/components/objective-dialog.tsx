/**
 * Supervisor Objective Dialog Component (Phase 3)
 *
 * Modal dialog for defining and editing supervisor objectives.
 */

import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useState, useEffect } from 'react';
import { supervisorDialogAtom, supervisorsAtom } from '../atoms';
import { wsClientAtom } from '../../../atoms/connection';

export function ObjectiveDialog({ workspaceId }: { workspaceId: string }) {
  const dialog = useAtomValue(supervisorDialogAtom);
  const supervisors = useAtomValue(supervisorsAtom);
  const setDialog = useSetAtom(supervisorDialogAtom);
  const wsClient = useAtomValue(wsClientAtom);

  const [objective, setObjective] = useState('');

  // Load existing objective when editing
  useEffect(() => {
    if (dialog.sessionId) {
      const supervisor = supervisors.get(dialog.sessionId);
      if (supervisor) {
        setObjective(supervisor.objective);
      } else {
        setObjective('');
      }
    }
  }, [dialog.sessionId, supervisors]);

  const handleClose = useCallback(() => {
    setDialog({ open: false, sessionId: null, mode: 'enable' });
    setObjective('');
  }, [setDialog]);

  const handleConfirm = useCallback(async () => {
    if (!dialog.sessionId || !objective.trim() || !wsClient) {
      return;
    }

    try {
      if (dialog.mode === 'enable') {
        await wsClient.sendCommand('supervisor.create', {
          sessionId: dialog.sessionId,
          workspaceId,
          objective: objective.trim(),
        });
      } else {
        const supervisor = supervisors.get(dialog.sessionId);
        if (supervisor) {
          await wsClient.sendCommand('supervisor.update', {
            id: supervisor.id,
            objective: objective.trim(),
          });
        }
      }
      handleClose();
    } catch (error) {
      console.error('Failed to save supervisor:', error);
    }
  }, [dialog, objective, wsClient, workspaceId, supervisors, handleClose]);

  if (!dialog.open) {
    return null;
  }

  const title = dialog.mode === 'enable' ? '启用 Supervisor' : '编辑 Supervisor 目标';
  const confirmLabel = dialog.mode === 'enable' ? '启用' : '保存';

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={handleClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="objective">目标描述</label>
            <textarea
              id="objective"
              className="input textarea"
              rows={5}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="描述 Supervisor 应该评估的目标，例如：&#10;- 完成用户认证功能的实现&#10;- 修复所有测试失败&#10;- 优化性能至响应时间 < 100ms"
              autoFocus
            />
          </div>

          {objective.trim() && (
            <div className="form-group">
              <label>预览</label>
              <pre className="objective-preview">{objective}</pre>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={!objective.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
