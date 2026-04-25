/**
 * Monaco Host Component
 *
 * Monaco editor wrapper for viewing and editing a single file. Diff view lives
 * in the Git Diff feature and is deliberately not surfaced here.
 */

import type { FC } from 'react';
import { useRef } from 'react';
import { useAtomValue } from 'jotai';
import Editor, { OnChange } from '@monaco-editor/react';
import { themeAtom } from '../../../atoms/ui';

interface MonacoHostProps {
  workspaceId: string;
  filePath: string;
  content: string;
  onContentChange?: (content: string) => void;
}

/**
 * Monaco Host
 *
 * PRD §9.5.3:
 *   - Syntax highlighting
 *   - Line numbers
 *   - Auto-save on Ctrl/Cmd + S (handled by parent)
 */
export const MonacoHost: FC<MonacoHostProps> = ({
  // workspaceId is accepted for future per-workspace editor settings; Monaco
  // itself doesn't need it today.
  workspaceId: _workspaceId,
  filePath,
  content,
  onContentChange,
}) => {
  const uiTheme = useAtomValue(themeAtom);
  const editorRef = useRef<unknown>(null);

  const handleEditorDidMount = (editor: unknown) => {
    editorRef.current = editor;
  };

  const handleChange: OnChange = (value) => {
    onContentChange?.(value || '');
  };

  const language = detectLanguage(filePath);
  const editorTheme = uiTheme === 'light' ? 'vs' : 'vs-dark';

  return (
    <div className="monaco-host">
      <Editor
        height="100%"
        language={language}
        theme={editorTheme}
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
