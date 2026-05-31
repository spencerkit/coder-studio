import { X } from "lucide-react";
import type { FC } from "react";
import { useMemo } from "react";
import { EmptyState, IconButton, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { PanelHeader } from "../../../shared/components/panel-header";
import { useGitDiffViewerActions } from "../../actions/use-git-actions";

interface GitDiffViewerProps {
  workspaceId: string;
  onClose?: () => void;
  showCloseButton?: boolean;
}

type DiffLineTone = "meta" | "added" | "removed" | "context";

interface DisplayLine {
  id: string;
  line: string;
  lineNumber: number;
  tone?: DiffLineTone;
}

function getDiffLineTone(line: string): DiffLineTone {
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("@@")
  ) {
    return "meta";
  }

  if (line.startsWith("+")) {
    return "added";
  }

  if (line.startsWith("-")) {
    return "removed";
  }

  return "context";
}

export const GitDiffViewer: FC<GitDiffViewerProps> = ({
  workspaceId,
  onClose,
  showCloseButton = true,
}) => {
  const t = useTranslation();
  const { preview, closePreview } = useGitDiffViewerActions(workspaceId);
  const handleClose = onClose ?? closePreview;

  const diffLines = useMemo<DisplayLine[]>(
    () =>
      preview?.diff.split("\n").map((line, index) => ({
        id: `${index}:${line}`,
        line,
        tone: getDiffLineTone(line),
        lineNumber: index + 1,
      })) ?? [],
    [preview]
  );

  return (
    <div className="workspace-git-view">
      <div className="code-editor workspace-git-editor">
        <PanelHeader
          title={preview?.title ?? preview?.path ?? t("git.diff_select_title")}
          actions={
            preview && showCloseButton ? (
              <div className="code-mode-toggle">
                <Tooltip content={t("action.close")}>
                  <IconButton
                    aria-label={t("action.close")}
                    className="code-mode-btn"
                    icon={<X size={12} />}
                    onClick={handleClose}
                    size="sm"
                  />
                </Tooltip>
              </div>
            ) : null
          }
        />

        <div className="code-editor-body">
          {preview ? (
            <div className="code-lines git-diff-lines">
              {diffLines.map((line) => (
                <div key={line.id} className={`code-line git-diff-line git-diff-line-${line.tone}`}>
                  <span className="code-line-num">{line.lineNumber}</span>
                  <span className="git-diff-line-text">{line.line || " "}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              className="git-diff-empty"
              description={<p className="git-diff-empty-body">{t("git.diff_empty_body")}</p>}
              title={<p className="git-diff-empty-title">{t("label.git")}</p>}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default GitDiffViewer;
