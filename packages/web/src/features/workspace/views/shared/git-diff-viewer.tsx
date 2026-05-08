import { X } from "lucide-react";
import type { FC } from "react";
import { useMemo } from "react";
import { useTranslation } from "../../../../lib/i18n";
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
        <div className="code-editor-header">
          <span className="code-file-path">
            {preview?.title ?? preview?.path ?? "Select a changed file to inspect"}
          </span>
          {preview && showCloseButton ? (
            <div className="code-mode-toggle">
              <button
                type="button"
                className="code-mode-btn"
                onClick={handleClose}
                title={t("action.close")}
                aria-label={t("action.close")}
              >
                <X size={12} />
              </button>
            </div>
          ) : null}
        </div>

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
            <div className="git-diff-empty">
              <p className="git-diff-empty-title">{t("label.git")}</p>
              <p className="git-diff-empty-body">
                Select a staged or modified file on the left to inspect its diff.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GitDiffViewer;
