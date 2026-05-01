import { AlertTriangle, Eye, Pencil, PowerOff } from 'lucide-react';
import {
  OBJECTIVE_DIALOG_EVALUATOR_OPTIONS,
  type ObjectiveDialogEvaluatorProviderId,
  type ObjectiveDialogMode,
} from '../hooks/use-objective-dialog-state';

interface ObjectiveDialogContentProps {
  mode: ObjectiveDialogMode;
  draftObjective: string;
  draftEvaluatorProviderId: ObjectiveDialogEvaluatorProviderId;
  disableObjective: string;
  onDraftObjectiveChange: (value: string) => void;
  onDraftEvaluatorProviderChange: (value: ObjectiveDialogEvaluatorProviderId) => void;
}

export function ObjectiveDialogModeIcon({ mode }: { mode: ObjectiveDialogMode }) {
  if (mode === 'enable') return <Eye size={14} />;
  if (mode === 'edit') return <Pencil size={14} />;
  return <PowerOff size={14} />;
}

export function ObjectiveDialogContent({
  mode,
  draftObjective,
  draftEvaluatorProviderId,
  disableObjective,
  onDraftObjectiveChange,
  onDraftEvaluatorProviderChange,
}: ObjectiveDialogContentProps) {
  if (mode === 'disable') {
    return (
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
    );
  }

  return (
    <>
      <div className="form-group">
        <label htmlFor="objective">目标描述</label>
        <textarea
          id="objective"
          className="input textarea"
          rows={5}
          value={draftObjective}
          onChange={(event) => onDraftObjectiveChange(event.target.value)}
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
          value={draftEvaluatorProviderId}
          onChange={(event) =>
            onDraftEvaluatorProviderChange(
              event.target.value as ObjectiveDialogEvaluatorProviderId
            )
          }
        >
          {OBJECTIVE_DIALOG_EVALUATOR_OPTIONS.map((option) => (
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
  );
}
