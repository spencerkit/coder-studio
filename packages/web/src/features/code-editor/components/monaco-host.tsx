/**
 * Monaco Host Component
 *
 * Monaco editor wrapper with file loading and saving.
 */

import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import Editor, { OnChange } from '@monaco-editor/react';
import { useTranslation } from '../../../lib/i18n';

interface MonacoHostProps {
  workspaceId: string;
  filePath: string;
  isDiffMode: boolean;
}

/**
 * Monaco Host
 *
 * PRD §9.5.3:
 *   - Syntax highlighting
 *   - Line numbers
 *   - Diff mode (side-by-side)
 *   - Auto-save on Ctrl/Cmd + S
 */
export const MonacoHost: FC<MonacoHostProps> = ({ workspaceId, filePath, isDiffMode }) => {
  const t = useTranslation();
  const editorRef = useRef<any>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
  };

  const handleChange: OnChange = (value) => {
    setContent(value || '');
    setIsDirty(true);
  };

  const handleSave = async () => {
    if (!isDirty) return;
    // TODO: Dispatch file save command
    console.log('Save file:', filePath, content);
    setIsDirty(false);
  };

  // Load file on mount
  useEffect(() => {
    // TODO: Dispatch file read command
    console.log('Load file:', filePath);
    const mockContent = '// File content would be loaded here\nconsole.log("Hello, World!");';
    setContent(mockContent);
    setOriginalContent(mockContent);
    setIsDirty(false);
  }, [filePath]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, content]);

  const language = detectLanguage(filePath);

  return (
    <div className="monaco-host">
      {isDiffMode ? (
        <Editor
          height="100%"
          language={language}
          theme="vs-dark"
          original={originalContent}
          value={content}
          onChange={handleChange}
          onMount={handleEditorDidMount}
          options={{
            fontSize: 13,
            fontFamily: 'JetBrains Mono, monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 12, bottom: 12 },
          }}
        />
      ) : (
        <Editor
          height="100%"
          language={language}
          theme="vs-dark"
          value={content}
          onChange={handleChange}
          onMount={handleEditorDidMount}
          options={{
            fontSize: 13,
            fontFamily: 'JetBrains Mono, monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 12, bottom: 12 },
          }}
        />
      )}

      {isDirty && (
        <div className="monaco-dirty-indicator">
          <span>{t('file.modified')}</span>
        </div>
      )}
    </div>
  );
};

/**
 * Detect language from file extension
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'shell',
    bash: 'shell',
  };

  return langMap[ext || ''] || 'plaintext';
}

export default MonacoHost;
