import type { FC } from 'react';
import { Save, AlertCircle, X, Image as ImageIcon, FileText } from 'lucide-react';
import { useTranslation } from '../../../../lib/i18n';
import { MonacoHost } from '../../components/monaco-host';
import { ImagePreview } from '../../components/image-preview';
import { useCodeEditorActions } from '../../actions/use-code-editor-actions';

export const CodeEditorHost: FC = () => {
  const t = useTranslation();
  const {
    activeFilePath,
    activeLoadError,
    canSave,
    currentFile,
    handleClose,
    handleContentChange,
    handleSave,
    isImageFile,
    isSaving,
    isSvgTextBacked,
    isTextFile,
    saveError,
    toggleSvgTextMode,
    workspace,
  } = useCodeEditorActions();

  if (!workspace) {
    return (
      <div className="workspace-git-view">
        <div className="code-editor workspace-git-editor">
          <div className="code-editor-body">
            <div className="git-diff-empty">
              <p className="git-diff-empty-title">{t('workspace.no_workspace')}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const saveLabel = isSaving ? 'Saving…' : t('action.save_file');
  const dirtyIndicator =
    isTextFile && currentFile.isDirty ? <span className="dirty-indicator">*</span> : null;

  return (
    <div className="workspace-git-view">
      <div className="code-editor workspace-git-editor">
        <div className="code-editor-header">
          <span className="code-file-path">
            {currentFile ? (
              <>
                {currentFile.path}
                {dirtyIndicator}
              </>
            ) : activeFilePath ? (
              activeFilePath
            ) : (
              t('file.title')
            )}
          </span>

          <div className="code-mode-toggle">
            {isSvgTextBacked && (
              <button
                type="button"
                className="code-mode-btn"
                onClick={toggleSvgTextMode}
                title={isImageFile ? 'Edit as text' : 'Preview as image'}
                aria-label={isImageFile ? 'Edit as text' : 'Preview as image'}
              >
                {isImageFile ? <FileText size={12} /> : <ImageIcon size={12} />}
                <span>{isImageFile ? 'Text' : 'Image'}</span>
              </button>
            )}
            <button
              type="button"
              className="code-mode-btn"
              onClick={handleSave}
              disabled={!canSave}
              title={saveLabel}
              aria-label={saveLabel}
            >
              <Save size={12} />
              <span>{saveLabel}</span>
            </button>
            <button
              type="button"
              className="code-mode-btn"
              onClick={handleClose}
              title={t('action.close')}
              aria-label={t('action.close')}
            >
              <X size={12} />
            </button>
          </div>
        </div>

        {saveError && (
          <div className="code-editor-error" role="alert">
            <AlertCircle size={14} />
            <span>{saveError}</span>
          </div>
        )}

        <div className="code-editor-body">
          {isTextFile ? (
            <MonacoHost
              workspaceId={workspace.id}
              filePath={currentFile.path}
              content={currentFile.content}
              onContentChange={handleContentChange}
            />
          ) : isImageFile ? (
            <ImagePreview
              url={currentFile.url}
              mime={currentFile.mime}
              sizeBytes={currentFile.size}
              alt={currentFile.path}
            />
          ) : activeLoadError ? (
            <div className="git-diff-empty" role="alert">
              <p className="git-diff-empty-title">Failed to open file</p>
              <p className="git-diff-empty-body">{activeLoadError}</p>
            </div>
          ) : activeFilePath ? (
            <div className="git-diff-empty">
              <p className="git-diff-empty-title">{t('status.connecting')}…</p>
            </div>
          ) : (
            <div className="git-diff-empty">
              <p className="git-diff-empty-title">{t('file.title')}</p>
              <p className="git-diff-empty-body">
                Select a file on the left to open it in the editor.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CodeEditorHost;
