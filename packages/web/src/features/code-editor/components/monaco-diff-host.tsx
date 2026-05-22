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

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: monaco.Environment;
};

monacoGlobal.MonacoEnvironment ??= {
  getWorker(_workerId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

interface MonacoDiffHostProps {
  originalContent: string;
  modifiedContent: string;
  filePath: string;
  readOnly?: boolean;
}

export const MonacoDiffHost: FC<MonacoDiffHostProps> = ({
  originalContent,
  modifiedContent,
  filePath,
  readOnly = true,
}) => {
  const uiTheme = useAtomValue(themeAtom);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const resolvedTheme = getThemeById(uiTheme);
  const editorTheme = `coder-studio-${resolvedTheme.id}`;

  useEffect(() => {
    monaco.editor.defineTheme(
      editorTheme,
      resolvedTheme.monaco as Parameters<typeof monaco.editor.defineTheme>[1]
    );
  }, [editorTheme, resolvedTheme]);

  useEffect(() => {
    if (!containerRef.current || editorRef.current) {
      return;
    }

    editorRef.current = monaco.editor.createDiffEditor(containerRef.current, {
      automaticLayout: true,
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 13,
      minimap: { enabled: false },
      originalEditable: false,
      readOnly,
      renderSideBySide: false,
      scrollBeyondLastLine: false,
      theme: editorTheme,
    });

    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
  }, [editorTheme, readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    originalModelRef.current?.dispose();
    modifiedModelRef.current?.dispose();

    const language = detectEditorLanguage(filePath);
    originalModelRef.current = monaco.editor.createModel(originalContent, language);
    modifiedModelRef.current = monaco.editor.createModel(modifiedContent, language);

    editor.setModel({
      original: originalModelRef.current,
      modified: modifiedModelRef.current,
    });
  }, [filePath, modifiedContent, originalContent]);

  useEffect(() => {
    monaco.editor.setTheme(editorTheme);
  }, [editorTheme]);

  return (
    <div
      ref={containerRef}
      className="monaco-host monaco-diff-host"
      data-testid="monaco-diff-host"
    />
  );
};

function detectEditorLanguage(filePath: string): string {
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

export default MonacoDiffHost;
