/**
 * Monaco Host Component
 *
 * Monaco editor wrapper for viewing and editing a single file. Diff view lives
 * in the Git Diff feature and is deliberately not surfaced here.
 */

import type { FC } from 'react';
import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { themeAtom } from '../../../atoms/ui';

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: monaco.Environment;
};

monacoGlobal.MonacoEnvironment ??= {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onContentChangeRef = useRef(onContentChange);

  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  const language = detectLanguage(filePath);
  const editorTheme = uiTheme === 'light' ? 'vs' : 'vs-dark';

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      value: content,
      language,
      theme: editorTheme,
      fontSize: 13,
      fontFamily: 'JetBrains Mono, monospace',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 12, bottom: 12 },
      automaticLayout: true,
    });
    editorRef.current = editor;

    const changeDisposable = editor.onDidChangeModelContent(() => {
      onContentChangeRef.current?.(editor.getValue());
    });

    return () => {
      changeDisposable.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, language);
    }
  }, [language]);

  useEffect(() => {
    monaco.editor.setTheme(editorTheme);
  }, [editorTheme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === content) return;
    editor.setValue(content);
  }, [content]);

  return <div ref={containerRef} className="monaco-host" />;
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
