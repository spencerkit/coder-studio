import { Minus, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import type { FC } from "react";
import { useMemo } from "react";
import { Button, EmptyState, IconButton, Tooltip } from "../../../../components/ui";
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
  const { preview, closePreview, refreshPreview, runFileOperation, runHunkOperation } =
    useGitDiffViewerActions(workspaceId);
  const handleClose = onClose ?? closePreview;
  const worktreePreview = preview?.kind === "worktree-file-diff" ? preview : null;
  const diffText =
    preview?.kind === "worktree-file-diff" || preview?.kind === "commit-file-diff"
      ? preview.diff
      : null;
  const hunkPreview =
    worktreePreview?.renderAs !== "image" && worktreePreview?.hunks?.length
      ? worktreePreview
      : null;

  const diffLines = useMemo<DisplayLine[]>(
    () =>
      diffText?.split("\n").map((line, index) => ({
        id: `${index}:${line}`,
        line,
        tone: getDiffLineTone(line),
        lineNumber: index + 1,
      })) ?? [],
    [diffText]
  );

  const renderFileActions = () => {
    if (!worktreePreview) {
      return null;
    }

    const staged = Boolean(worktreePreview.staged);
    const stageLabel = staged ? t("git.unstage_file") : t("git.stage_file");

    return (
      <div className="git-diff-actions">
        <Tooltip content={stageLabel}>
          <IconButton
            aria-label={stageLabel}
            className="code-mode-btn git-diff-action"
            icon={staged ? <Minus size={12} /> : <Plus size={12} />}
            onClick={() =>
              void runFileOperation({
                path: worktreePreview.path,
                staged,
                operation: staged ? "unstage" : "stage",
              })
            }
            size="sm"
          />
        </Tooltip>

        {!staged ? (
          <Tooltip content={t("git.discard_file")}>
            <IconButton
              aria-label={t("git.discard_file")}
              className="code-mode-btn git-diff-action"
              icon={<RotateCcw size={12} />}
              onClick={() =>
                void runFileOperation({
                  path: worktreePreview.path,
                  staged: false,
                  operation: "discard",
                })
              }
              size="sm"
            />
          </Tooltip>
        ) : null}

        <Tooltip content={t("git.refresh_diff")}>
          <IconButton
            aria-label={t("git.refresh_diff")}
            className="code-mode-btn git-diff-action"
            icon={<RefreshCw size={12} />}
            onClick={() => void refreshPreview(worktreePreview.path, staged)}
            size="sm"
          />
        </Tooltip>
      </div>
    );
  };

  const renderCloseAction = () =>
    preview && showCloseButton ? (
      <Tooltip content={t("action.close")}>
        <IconButton
          aria-label={t("action.close")}
          className="code-mode-btn"
          icon={<X size={12} />}
          onClick={handleClose}
          size="sm"
        />
      </Tooltip>
    ) : null;

  return (
    <div className="workspace-git-view">
      <div className="code-editor workspace-git-editor">
        <PanelHeader
          title={preview?.title ?? preview?.path ?? t("git.diff_select_title")}
          actions={
            preview ? (
              <div className="code-mode-toggle">
                {renderFileActions()}
                {renderCloseAction()}
              </div>
            ) : null
          }
        />

        <div className="code-editor-body">
          {preview ? (
            <div className="code-lines git-diff-lines">
              {hunkPreview
                ? hunkPreview.hunks?.map((hunk) => (
                    <div key={hunk.id} className="git-diff-hunk">
                      <div className="git-diff-hunk-toolbar">
                        <span className="git-diff-hunk-header">{hunk.header}</span>
                        <div className="git-diff-hunk-actions">
                          {hunkPreview.staged ? (
                            <Button
                              className="git-diff-hunk-action"
                              onClick={() =>
                                void runHunkOperation({
                                  path: hunkPreview.path,
                                  staged: true,
                                  hunkId: hunk.id,
                                  operation: "unstage",
                                })
                              }
                              size="sm"
                              variant="ghost"
                            >
                              {t("git.unstage_hunk")}
                            </Button>
                          ) : (
                            <>
                              <Button
                                className="git-diff-hunk-action"
                                onClick={() =>
                                  void runHunkOperation({
                                    path: hunkPreview.path,
                                    staged: false,
                                    hunkId: hunk.id,
                                    operation: "stage",
                                  })
                                }
                                size="sm"
                                variant="ghost"
                              >
                                {t("git.stage_hunk")}
                              </Button>
                              <Button
                                className="git-diff-hunk-action"
                                onClick={() =>
                                  void runHunkOperation({
                                    path: hunkPreview.path,
                                    staged: false,
                                    hunkId: hunk.id,
                                    operation: "discard",
                                  })
                                }
                                size="sm"
                                variant="danger"
                              >
                                {t("git.discard_hunk")}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      {hunk.lines.map((line, index) => (
                        <div
                          key={`${hunk.id}:${index}:${line}`}
                          className={`code-line git-diff-line git-diff-line-${getDiffLineTone(line)}`}
                        >
                          <span className="code-line-num">{index + 1}</span>
                          <span className="git-diff-line-text">{line || " "}</span>
                        </div>
                      ))}
                    </div>
                  ))
                : diffLines.map((line) => (
                    <div
                      key={line.id}
                      className={`code-line git-diff-line git-diff-line-${line.tone}`}
                    >
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
