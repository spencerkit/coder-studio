import type { GitCommitFileEntry } from "@coder-studio/core";
import type { FC } from "react";
import { ThemedIcon } from "../../../components/ui";
import type { GitCommitFileListPreview } from "../../workspace/atoms";

interface CommitFileListPreviewProps {
  preview: GitCommitFileListPreview;
  onOpenFile: (file: GitCommitFileEntry) => void;
}

function formatFileLabel(file: GitCommitFileEntry): string {
  return file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path;
}

function splitPath(filePath: string) {
  const pathParts = filePath.split("/");
  const name = pathParts[pathParts.length - 1] ?? filePath;
  const dir = pathParts.length > 1 ? `${pathParts.slice(0, -1).join("/")}/` : "";
  return { dir, name };
}

function getStatusSemantic(status: GitCommitFileEntry["status"]) {
  switch (status) {
    case "deleted":
      return "git.status.deleted";
    case "added":
    case "renamed":
    case "modified":
    default:
      return "git.status.modified";
  }
}

export const CommitFileListPreview: FC<CommitFileListPreviewProps> = ({ preview, onOpenFile }) => {
  return (
    <div className="commit-file-list-preview" data-testid="commit-file-list-preview">
      <div className="commit-file-list-preview__files" role="list" aria-label={preview.title}>
        {preview.files.map((file) => {
          const { dir, name } = splitPath(file.path);
          return (
            <button
              key={`${file.oldPath ?? ""}:${file.path}:${file.status}`}
              aria-label={`${formatFileLabel(file)} ${file.status}`}
              type="button"
              className="commit-file-list-preview__row git-row"
              onClick={() => onOpenFile(file)}
            >
              <span className="git-row-icon" aria-hidden="true">
                <ThemedIcon semantic={getStatusSemantic(file.status)} size={13} />
              </span>
              <div className="git-row-content">
                <span className="git-row-name">{name}</span>
                <span className="git-row-meta">
                  {dir ? <span className="git-row-dir">{dir}</span> : null}
                  {file.oldPath ? <span className="git-row-rename">{file.oldPath}</span> : null}
                </span>
              </div>
              <span
                className={`git-row-status-badge git-row-status-badge-${file.status}`}
                aria-hidden="true"
              >
                {file.status[0]?.toUpperCase() ?? "?"}
              </span>
              <span className="commit-file-list-preview__status">{file.status}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CommitFileListPreview;
