import type { FC, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { gitDiffPreviewAtomFamily } from '../atoms/git';

interface GitDiffViewerProps {
  workspaceId: string;
}

type DiffLineTone = 'meta' | 'added' | 'removed' | 'context';
type ViewMode = 'preview' | 'diff';

interface DisplayLine {
  id: string;
  line: string;
  lineNumber: number;
  tone?: DiffLineTone;
}

type PreviewTokenTone =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'comment'
  | 'function'
  | 'type'
  | 'operator';

interface PreviewToken {
  text: string;
  tone: PreviewTokenTone;
}

const PREVIEW_TOKEN_PATTERN =
  /('(?:\\.|[^'])*'|"(?:\\.|[^"])*")|\b(import|from|export|interface|type|const|let|var|return|if|else|async|await|try|catch|new)\b|(=>)|\b([A-Z][A-Za-z0-9_]*)\b|\b([a-z_][A-Za-z0-9_]*)\s*(?=\()/g;

function tokenizeCodePart(source: string): PreviewToken[] {
  const tokens: PreviewToken[] = [];
  let lastIndex = 0;

  for (const match of source.matchAll(PREVIEW_TOKEN_PATTERN)) {
    const [value, stringLiteral, keyword, arrow, typeName, functionName] = match;
    const index = match.index ?? 0;

    if (index > lastIndex) {
      tokens.push({
        text: source.slice(lastIndex, index),
        tone: 'plain',
      });
    }

    if (stringLiteral) {
      tokens.push({ text: value, tone: 'string' });
    } else if (keyword) {
      tokens.push({ text: value, tone: 'keyword' });
    } else if (arrow) {
      tokens.push({ text: value, tone: 'operator' });
    } else if (typeName) {
      tokens.push({ text: value, tone: 'type' });
    } else if (functionName) {
      tokens.push({ text: value, tone: 'function' });
    } else {
      tokens.push({ text: value, tone: 'plain' });
    }

    lastIndex = index + value.length;
  }

  if (lastIndex < source.length) {
    tokens.push({
      text: source.slice(lastIndex),
      tone: 'plain',
    });
  }

  return tokens;
}

function tokenizePreviewLine(line: string): PreviewToken[] {
  if (!line) {
    return [{ text: ' ', tone: 'plain' }];
  }

  const commentIndex = line.indexOf('//');
  if (commentIndex === -1) {
    return tokenizeCodePart(line);
  }

  const codePart = line.slice(0, commentIndex);
  const commentPart = line.slice(commentIndex);
  return [
    ...tokenizeCodePart(codePart),
    { text: commentPart, tone: 'comment' },
  ];
}

function renderPreviewLine(line: string): ReactNode {
  const tokens = tokenizePreviewLine(line);

  return tokens.map((token, index) => {
    if (token.tone === 'plain') {
      return <span key={`${token.tone}:${index}`}>{token.text}</span>;
    }

    return (
      <span key={`${token.tone}:${index}`} className={`code-${token.tone}`}>
        {token.text}
      </span>
    );
  });
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
  const preview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId));
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  useEffect(() => {
    setViewMode('preview');
  }, [preview?.path]);

  useEffect(() => {
    if (!preview?.path) {
      setPreviewContent(null);
      setPreviewError(null);
      setIsLoadingPreview(false);
      return;
    }

    let cancelled = false;

    const loadPreview = async () => {
      setIsLoadingPreview(true);
      setPreviewError(null);

      const result = await dispatch<{ content: string }>('file.read', {
        workspaceId,
        path: preview.path,
      });

      if (cancelled) {
        return;
      }

      if (!result.ok || !result.data) {
        setPreviewContent(null);
        setPreviewError(result.error?.message ?? 'Preview is unavailable for this change.');
        setIsLoadingPreview(false);
        return;
      }

      setPreviewContent(result.data.content);
      setIsLoadingPreview(false);
    };

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [dispatch, preview?.path, workspaceId]);

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

  const previewLines = useMemo<DisplayLine[]>(
    () =>
      previewContent
        ?.split('\n')
        .map((line, index) => ({
          id: `${index}:${line}`,
          line,
          lineNumber: index + 1,
        })) ?? [],
    [previewContent]
  );

  const isPreviewMode = viewMode === 'preview';

  return (
    <div className="workspace-git-view">
      <div className="code-editor workspace-git-editor">
        <div className="code-editor-header">
          <span className="code-file-path">
            {preview?.path ?? 'Select a changed file to inspect'}
          </span>

          <div className="code-mode-toggle">
            <button
              className={`code-mode-btn ${isPreviewMode ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
              type="button"
            >
              Preview
            </button>
            <button
              className={`code-mode-btn ${!isPreviewMode ? 'active' : ''}`}
              onClick={() => setViewMode('diff')}
              type="button"
            >
              Diff
            </button>
          </div>
        </div>

        <div className="code-editor-body">
          {preview ? (
            isPreviewMode ? (
              isLoadingPreview ? (
                <div className="git-diff-empty">
                  <p className="git-diff-empty-title">Loading Preview</p>
                  <p className="git-diff-empty-body">
                    Reading the current file contents for this change.
                  </p>
                </div>
              ) : previewLines.length > 0 ? (
                <div className="code-lines git-preview-lines">
                  {previewLines.map((line) => (
                    <div key={line.id} className="code-line git-preview-line">
                      <span className="code-line-num">{line.lineNumber}</span>
                      <span className="git-diff-line-text">{renderPreviewLine(line.line)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="git-diff-empty">
                  <p className="git-diff-empty-title">Preview Unavailable</p>
                  <p className="git-diff-empty-body">
                    {previewError ?? 'Switch to Diff to inspect this change as a patch.'}
                  </p>
                </div>
              )
            ) : (
              <div className="code-lines git-diff-lines">
                {diffLines.map((line) => (
                  <div key={line.id} className={`code-line git-diff-line git-diff-line-${line.tone}`}>
                    <span className="code-line-num">{line.lineNumber}</span>
                    <span className="git-diff-line-text">{line.line || ' '}</span>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="git-diff-empty">
              <p className="git-diff-empty-title">Git Diff Preview</p>
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
