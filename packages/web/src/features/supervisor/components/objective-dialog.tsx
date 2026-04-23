/**
 * Supervisor Objective Dialog Component (Phase 3)
 *
 * Modal dialog for enabling, editing, and disabling supervisors.
 */

import { useAtom, useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { AlertTriangle, Eye, Pencil, PowerOff, X } from 'lucide-react';
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

type DialogMode = 'enable' | 'edit' | 'disable';

const MODE_COPY: Record<DialogMode, { title: string; subtitle: string; confirm: string }> = {
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

function ModeIcon({ mode }: { mode: DialogMode }) {
  if (mode === 'enable') return <Eye size={14} />;
  if (mode === 'edit') return <Pencil size={14} />;
  return <PowerOff size={14} />;
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

  const mode = dialog.mode;
  const copy = MODE_COPY[mode];
  const disableObjective = supervisor?.objective ?? dialog.draftObjective;
  const isDisable = mode === 'disable';

  return (
    <div className="modal-overlay" onClick={close}>
      <div
        className="modal-card supervisor-dialog"
        data-mode={mode}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="supervisor-dialog-header">
            <span className="supervisor-dialog-header-icon" aria-hidden="true">
              <ModeIcon mode={mode} />
            </span>
            <div>
              <h3>{copy.title}</h3>
              <span className="supervisor-dialog-subtitle">{copy.subtitle}</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={close} aria-label="关闭">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          {isDisable ? (
            <>
              <div className="supervisor-danger-callout" role="alert">
                <AlertTriangle
                  size={16}
                  className="supervisor-danger-callout-icon"
                  aria-hidden="true"
                />
                <div className="supervisor-danger-callout-copy">
                  <strong>禁用后会停止评估周期</strong>
                  <small>
                    当前会话的 supervisor 将被移除,历史 cycles 会一并清理。可重新启用,但无法恢复记录。
                  </small>
                </div>
              </div>
              <div className="form-group">
                <label>当前目标</label>
                <pre className="objective-preview">{disableObjective}</pre>
              </div>
            </>
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
                  placeholder={
                    '描述希望 Supervisor 盯住的目标,例如:\n' +
                    '· 完成用户认证功能的实现\n' +
                    '· 修复所有失败的单元测试\n' +
                    '· 把 P95 响应时间压到 100ms 以内'
                  }
                  autoFocus
                />
                <span className="dialog-helper">
                  越具体、越可衡量,评估效果越好。建议包含完成条件。
                </span>
              </div>

              <div className="form-group">
                <label htmlFor="evaluator-provider">评估方 (Evaluator)</label>
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
                <span className="dialog-helper">
                  用于评估进度并生成下一步指引的 provider,与执行方可不相同。
                </span>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={close}>
            取消
          </button>
          <button
            className={`btn ${isDisable ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              void confirm();
            }}
            disabled={!isDisable && !dialog.draftObjective.trim()}
          >
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
