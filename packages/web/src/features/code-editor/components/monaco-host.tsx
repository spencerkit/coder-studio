/**
 * Monaco Host Component
 *
 * Monaco editor wrapper with file loading and saving.
 */

import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
import Editor, { OnChange } from '@monaco-editor/react';
import { DiffEditor } from '@monaco-editor/react';

interface MonacoHostProps {
  workspaceId: string;
  filePath: string;
  content: string;
  isDiffMode: boolean;
  onContentChange?: (content: string) => void;
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
export const MonacoHost: FC<MonacoHostProps> = ({
  workspaceId,
  filePath,
  content,
  isDiffMode,
  onContentChange,
}) => {
  const editorRef = useRef<any>(null);
  const [originalContent, setOriginalContent] = useState('');

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
  };

  const handleChange: OnChange = (value) => {
    onContentChange?.(value || '');
  };

  // Load original content for diff mode
  useEffect(() => {
    // For diff mode, we need the original content (from baseHash)
    // This would be loaded once when the file opens
    // For now, we'll set it to the initial content
    if (isDiffMode && originalContent === '') {
      setOriginalContent(content);
    }
  }, [isDiffMode, content, originalContent]);

  const language = detectLanguage(filePath);

  if (isDiffMode) {
    return (
      <div className="monaco-host">
        <DiffEditor
          height="100%"
          language={language}
          theme="vs-dark"
          original={originalContent}
          modified={content}
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
  }

  return (
    <div className="monaco-host">
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
