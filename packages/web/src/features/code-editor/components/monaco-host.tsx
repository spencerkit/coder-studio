/**
 * Monaco Host Component
 *
 * Monaco editor wrapper for viewing and editing a single file. Diff view lives
 * in the Git Diff feature and is deliberately not surfaced here.
 */

import { useAtomValue } from "jotai";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import type { FC } from "react";
import { useEffect, useRef } from "react";
import { themeAtom } from "../../../atoms/app-ui";
import { getThemeById } from "../../../theme";
import { monacoModelRegistry } from "../monaco/model-registry";

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: monaco.Environment;
};

const registeredMonacoThemeIds = new Set<string>();

monacoGlobal.MonacoEnvironment ??= {
  getWorker(_workerId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

interface MonacoHostProps {
  workspaceId?: string;
  workspaceRootPath?: string;
  filePath: string;
  content: string;
  visible?: boolean;
  standalone?: boolean;
  onContentChange?: (content: string) => void;
  onSave?: () => void | Promise<void>;
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
  workspaceRootPath,
  filePath,
  content,
  visible = true,
  standalone = false,
  onContentChange,
  onSave,
}) => {
  const uiTheme = useAtomValue(themeAtom);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const standaloneModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const wasVisibleRef = useRef(visible);
  const onContentChangeRef = useRef(onContentChange);
  const onSaveRef = useRef(onSave);
  const isWorkspaceBacked = Boolean(workspaceRootPath) && !standalone;

  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const language = detectLanguage(filePath);
  const resolvedTheme = getThemeById(uiTheme);
  const editorTheme = `coder-studio-${resolvedTheme.id}`;

  useEffect(() => {
    if (!registeredMonacoThemeIds.has(editorTheme)) {
      monaco.editor.defineTheme(editorTheme, resolvedTheme.monaco);
      registeredMonacoThemeIds.add(editorTheme);
    }
  }, [editorTheme, resolvedTheme]);

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      model: null,
      theme: editorTheme,
      fontSize: 13,
      fontFamily: "JetBrains Mono, monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 12, bottom: 12 },
      automaticLayout: true,
    });
    editorRef.current = editor;

    const changeDisposable = editor.onDidChangeModelContent(() => {
      onContentChangeRef.current?.(editor.getValue());
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void onSaveRef.current?.();
    });

    return () => {
      changeDisposable.dispose();
      editor.dispose();
      editorRef.current = null;
      standaloneModelRef.current?.dispose();
      standaloneModelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (isWorkspaceBacked && workspaceRootPath) {
      const handle = monacoModelRegistry.getOrCreate({
        workspaceRootPath,
        path: filePath,
        language,
        content,
      });
      if (editor.getModel() !== handle.model) {
        editor.setModel(handle.model);
      }
      return;
    }

    if (!standaloneModelRef.current) {
      standaloneModelRef.current = monaco.editor.createModel(content, language);
    }

    const model = standaloneModelRef.current;
    monaco.editor.setModelLanguage(model, language);
    if (model.getValue() !== content) {
      model.setValue(content);
    }
    if (editor.getModel() !== model) {
      editor.setModel(model);
    }
  }, [content, filePath, isWorkspaceBacked, language, workspaceRootPath]);

  useEffect(() => {
    monaco.editor.setTheme(editorTheme);
  }, [editorTheme]);

  useEffect(() => {
    const editor = editorRef.current;
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = visible;

    if (!editor || !visible || wasVisible) {
      return;
    }

    editor.layout();
  }, [visible]);

  return (
    <div
      ref={containerRef}
      className="monaco-host"
      data-monaco-mode={isWorkspaceBacked ? "workspace" : "standalone"}
    />
  );
};

/**
 * Detect language from file extension
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    cpp: "cpp",
    c: "c",
    yaml: "yaml",
    yml: "yaml",
    sh: "shell",
    bash: "shell",
  };

  return langMap[ext || ""] || "plaintext";
}

export default MonacoHost;
