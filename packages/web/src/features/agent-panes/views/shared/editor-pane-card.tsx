import { useAtomValue } from "jotai";
import { FlipHorizontal, FlipVertical, X } from "lucide-react";
import type { FC } from "react";
import { IconButton, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useCodeEditorActions } from "../../../code-editor/actions/use-code-editor-actions";
import {
  CodeEditorDesktopHeaderActions,
  CodeEditorHost,
} from "../../../code-editor/views/shared/code-editor-host";
import { PanelHeader } from "../../../shared/components/panel-header";
import { activeFilePathAtomFamily } from "../../../workspace/atoms";

interface EditorPaneCardProps {
  paneId: string;
  workspaceId: string;
  onClosePane: (paneId: string) => void;
  onSplitPane: (paneId: string, direction: "horizontal" | "vertical") => void;
}

export const EditorPaneCard: FC<EditorPaneCardProps> = ({
  paneId,
  workspaceId,
  onClosePane,
  onSplitPane,
}) => {
  const t = useTranslation();
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const editorState = useCodeEditorActions();
  const title = activeFilePath ?? "Editor";

  return (
    <div
      className="session-card agent-pane editor-pane-card"
      data-pane-id={paneId}
      data-testid={`editor-pane-${paneId}`}
    >
      <PanelHeader
        title={title}
        metaPlacement="inline"
        actions={
          <>
            <Tooltip content="Split horizontal">
              <IconButton
                aria-label="Split horizontal"
                className="session-action-btn"
                icon={<FlipHorizontal size={13} />}
                onClick={() => onSplitPane(paneId, "horizontal")}
                size="sm"
              />
            </Tooltip>
            <Tooltip content="Split vertical">
              <IconButton
                aria-label="Split vertical"
                className="session-action-btn"
                icon={<FlipVertical size={13} />}
                onClick={() => onSplitPane(paneId, "vertical")}
                size="sm"
              />
            </Tooltip>
            <Tooltip content={t("action.close")}>
              <IconButton
                aria-label={t("action.close")}
                className="session-action-btn session-action-btn-close"
                icon={<X size={14} />}
                onClick={() => onClosePane(paneId)}
                size="sm"
              />
            </Tooltip>
          </>
        }
      />

      <div className="editor-pane-card__body">
        <div className="code-editor-header editor-pane-card__toolbar-row">
          <CodeEditorDesktopHeaderActions state={editorState} showCloseAction={false} />
        </div>
        <div className="editor-pane-card__content">
          <CodeEditorHost chrome="content-only" editorState={editorState} />
        </div>
      </div>
    </div>
  );
};

export default EditorPaneCard;
