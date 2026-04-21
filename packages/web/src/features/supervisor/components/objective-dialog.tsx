/**
 * Supervisor Objective Dialog Component (Phase 3)
 *
 * Modal dialog for enabling, editing, and disabling supervisors.
 */

import { useAtom, useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { supervisorDialogAtom, supervisorsAtom } from '../atoms';
import { dispatchCommandAtom } from '../../../atoms/connection';

const EVALUATOR_OPTIONS = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
] as const;

interface ObjectiveDialogProps {
  workspaceId: string;
  sessionId?: string;
}

export function ObjectiveDialog({ workspaceId, sessionId }: ObjectiveDialogProps) {
  const [dialog, setDialog] = useAtom(supervisorDialogAtom);
  const supervisors = useAtomValue(supervisorsAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);

  const supervisor = dialog.sessionId ? supervisors.get(dialog.sessionId) : undefined;

  const close = useCallback(() => {
    setDialog({
      open: false,
      sessionId: null,
      mode: 'enable',
      draftObjective: '',
      draftEvaluatorProviderId: 'claude',
    });
  }, [setDialog]);

  const updateDraft = useCallback(
    (
      patch: Partial<{
        draftObjective: string;
        draftEvaluatorProviderId: 'claude' | 'codex';
      }>
    ) => {
      setDialog((current) => ({ ...current, ...patch }));
    },
    [setDialog]
  );

  const confirm = useCallback(async () => {
    if (!dialog.sessionId) {
      return;
    }

    if (dialog.mode === 'disable') {
      if (!supervisor) {
        return;
      }
      const result = await dispatch('supervisor.delete', { id: supervisor.id });
      if (result.ok) {
        close();
      }
      return;
    }

    const objective = dialog.draftObjective.trim();
    if (!objective) {
      return;
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
      }
      return;
    }

    if (!supervisor) {
      return;
    }

    const result = await dispatch('supervisor.update', {
      id: supervisor.id,
      objective,
      evaluatorProviderId: dialog.draftEvaluatorProviderId,
    });

    if (result.ok) {
      close();
    }
  }, [close, dialog, dispatch, supervisor, workspaceId]);

  if (!dialog.open) {
    return null;
  }

  if (sessionId && dialog.sessionId !== sessionId) {
    return null;
  }

  const disableObjective = supervisor?.objective ?? dialog.draftObjective;
  const title =
    dialog.mode === 'disable'
      ? '禁用 Supervisor'
      : dialog.mode === 'edit'
        ? '编辑 Supervisor'
        : '启用 Supervisor';
  const confirmLabel =
    dialog.mode === 'disable' ? '禁用' : dialog.mode === 'edit' ? '保存' : '启用';

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={close} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {dialog.mode === 'disable' ? (
            <div className="form-group">
              <p className="dialog-helper">禁用会停止评估并清空历史</p>
              <pre className="objective-preview">{disableObjective}</pre>
            </div>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="objective">目标描述</label>
                <textarea
                  id="objective"
                  className="input textarea"
                  rows={5}
                  value={dialog.draftObjective}
                  onChange={(event) => updateDraft({ draftObjective: event.target.value })}
                  placeholder="描述 Supervisor 应该评估的目标，例如：&#10;- 完成用户认证功能的实现&#10;- 修复所有测试失败&#10;- 优化性能至响应时间 < 100ms"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="evaluator-provider">Evaluator Provider</label>
                <select
                  id="evaluator-provider"
                  className="input"
                  value={dialog.draftEvaluatorProviderId}
                  onChange={(event) =>
                    updateDraft({
                      draftEvaluatorProviderId: event.target.value as 'claude' | 'codex',
                    })
                  }
                >
                  {EVALUATOR_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {dialog.draftObjective.trim() ? (
                <div className="form-group">
                  <label>预览</label>
                  <pre className="objective-preview">{dialog.draftObjective}</pre>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={close}>
            取消
          </button>
          <button
            className={`btn ${dialog.mode === 'disable' ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              void confirm();
            }}
            disabled={dialog.mode !== 'disable' && !dialog.draftObjective.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
