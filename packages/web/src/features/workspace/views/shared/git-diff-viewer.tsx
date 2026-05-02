import type { FC } from 'react';
import { useMemo } from 'react';
import { useGitDiffViewerActions } from '../../actions/use-git-actions';

interface GitDiffViewerProps {
  workspaceId: string;
}

type DiffLineTone = 'meta' | 'added' | 'removed' | 'context';

interface DisplayLine {
  id: string;
  line: string;
  lineNumber: number;
  tone?: DiffLineTone;
}

function getDiffLineTone(line: string): DiffLineTone {
  if (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('@@')
  ) {
    return 'meta';
  }

  if (line.startsWith('+')) {
    return 'added';
  }

  if (line.startsWith('-')) {
    return 'removed';
  }

  return 'context';
}

export const GitDiffViewer: FC<GitDiffViewerProps> = ({ workspaceId }) => {
  const { preview } = useGitDiffViewerActions(workspaceId);

  const diffLines = useMemo<DisplayLine[]>(
    () =>
      preview?.diff
        .split('\n')
        .map((line, index) => ({
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
            {preview?.path ?? 'Select a changed file to inspect'}
          </span>
        </div>

        <div className="code-editor-body">
          {preview ? (
            <div className="code-lines git-diff-lines">
              {diffLines.map((line) => (
                <div
                  key={line.id}
                  className={`code-line git-diff-line git-diff-line-${line.tone}`}
                >
                  <span className="code-line-num">{line.lineNumber}</span>
                  <span className="git-diff-line-text">{line.line || ' '}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="git-diff-empty">
              <p className="git-diff-empty-title">Git Diff</p>
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
