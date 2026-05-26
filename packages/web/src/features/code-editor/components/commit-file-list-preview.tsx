import type { GitCommitFileEntry } from "@coder-studio/core";
import type { FC } from "react";
import type { GitCommitFileListPreview } from "../../workspace/atoms";

interface CommitFileListPreviewProps {
  preview: GitCommitFileListPreview;
  onOpenFile: (file: GitCommitFileEntry) => void;
}

function formatFileLabel(file: GitCommitFileEntry): string {
  return file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path;
}

export const CommitFileListPreview: FC<CommitFileListPreviewProps> = ({ preview, onOpenFile }) => {
  return (
    <div className="commit-file-list-preview" data-testid="commit-file-list-preview">
      <div className="commit-file-list-preview__files" role="list" aria-label={preview.title}>
        {preview.files.map((file) => (
          <button
            key={`${file.oldPath ?? ""}:${file.path}:${file.status}`}
            aria-label={formatFileLabel(file)}
            type="button"
            className="commit-file-list-preview__row"
            onClick={() => onOpenFile(file)}
          >
            <span className="commit-file-list-preview__path">{formatFileLabel(file)}</span>
            <span className="commit-file-list-preview__meta" aria-hidden="true">
              {file.status} · {file.renderAs}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default CommitFileListPreview;
