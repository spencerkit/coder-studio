import type { TaskDefinition } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { X } from "lucide-react";
import { wsClientAtom } from "../../../../atoms/connection";
import { Button, EmptyState, IconButton, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { terminalActiveIdAtomFamily } from "../../../terminal-panel/atoms";
import { useTaskActions } from "../../actions/use-task-actions";

interface TaskCommandSidePanelProps {
  workspaceId: string;
  onClose: () => void;
}

export function TaskCommandSidePanel({ workspaceId, onClose }: TaskCommandSidePanelProps) {
  const t = useTranslation();
  const wsClient = useAtomValue(wsClientAtom);
  const activeTerminalId = useAtomValue(terminalActiveIdAtomFamily(workspaceId));
  const { tasks, loading, error, commandPreview } = useTaskActions(workspaceId);
  const canInsertCommand = Boolean(activeTerminalId && wsClient);

  async function insertCommand(task: TaskDefinition) {
    if (!activeTerminalId || !wsClient) {
      return;
    }

    await wsClient.sendTerminalInput(
      activeTerminalId,
      new TextEncoder().encode(commandPreview(task)),
      "typing"
    );
  }

  return (
    <aside className="terminal-command-side-panel" aria-label={t("tasks.kicker")}>
      <div className="terminal-command-side-panel__header">
        <div className="terminal-command-side-panel__heading">
          <span className="terminal-kicker">{t("tasks.kicker")}</span>
        </div>
        <Tooltip content={t("action.close")}>
          <IconButton
            aria-label={t("terminal.close_commands")}
            className="panel-toolbar-btn"
            icon={<X size={14} />}
            onClick={onClose}
            size="sm"
          />
        </Tooltip>
      </div>

      {error ? <div className="terminal-command-side-panel__error">{error}</div> : null}

      {tasks.length === 0 && !loading ? (
        <EmptyState
          className="terminal-command-side-panel__empty"
          icon={<ThemedIcon semantic="terminal.action.new" size={24} />}
          title={<p>{t("tasks.empty_title")}</p>}
          description={<p>{t("tasks.empty_body")}</p>}
        />
      ) : (
        <div className="terminal-command-side-panel__list terminal-command-side-panel__list--scroll">
          {tasks.map((task) => {
            const preview = commandPreview(task);

            return (
              <div key={task.id} className="terminal-command-side-panel__row" title={preview}>
                <div className="terminal-command-side-panel__row-main">
                  <span className="terminal-command-side-panel__label">{task.label}</span>
                  <span className="terminal-command-side-panel__command">{preview}</span>
                </div>
                <div className="terminal-command-side-panel__row-footer">
                  <span className="terminal-command-side-panel__status">
                    {t("tasks.insert_hint")}
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!canInsertCommand}
                    onClick={() => void insertCommand(task)}
                  >
                    {t("tasks.insert_label", { label: task.label })}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
