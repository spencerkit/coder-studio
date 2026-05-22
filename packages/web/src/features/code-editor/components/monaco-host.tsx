/**
 * Monaco Host Component
 *
 * Monaco editor wrapper for viewing and editing a single file. Diff view lives
 * in the Git Diff feature and is deliberately not surfaced here.
 */

import { useAtomValue, useSetAtom } from "jotai";
import * as monaco from "monaco-editor";
import { ICodeEditorService } from "monaco-editor/esm/vs/editor/browser/services/codeEditorService.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { StandaloneServices } from "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import { themeAtom } from "../../../atoms/app-ui";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import { getThemeById } from "../../../theme";
import { useOpenLocation } from "../actions/use-open-location";
import { type PendingEditorNavigation, pendingEditorNavigationAtomFamily } from "../atoms";
import { globalLspBridge, type LspBridgeState } from "../lsp/bridge";
import { lspRuntimeModeAtom } from "../lsp/runtime-mode";
import { monacoModelRegistry } from "../monaco/model-registry";
import { fromWorkspaceFileUri } from "../monaco/uri";
import { LspStatusNotice } from "./lsp-status-notice";

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: monaco.Environment;
};

const registeredMonacoThemeIds = new Set<string>();

type NoticeLspState = Exclude<LspBridgeState, { kind: "ready" | "unsupported_language" }>;

function isNoticeLspState(state: LspBridgeState): state is NoticeLspState {
  return state.kind !== "ready" && state.kind !== "unsupported_language";
}

monacoGlobal.MonacoEnvironment ??= {
  getWorker(_workerId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

let javaScriptTypeScriptDefaultsConfigured = false;

configureJavaScriptTypeScriptDefaults();

interface MonacoTypeScriptLanguage {
  JsxEmit: {
    ReactJSX: number;
  };
  ModuleKind: {
    ESNext: number;
  };
  ModuleResolutionKind: {
    NodeJs: number;
  };
  ScriptTarget: {
    ESNext: number;
  };
  javascriptDefaults: {
    setCompilerOptions(options: Record<string, unknown>): void;
    setDiagnosticsOptions(options: {
      noSemanticValidation?: boolean;
      noSyntaxValidation?: boolean;
    }): void;
    setEagerModelSync(value: boolean): void;
  };
  typescriptDefaults: {
    setCompilerOptions(options: Record<string, unknown>): void;
    setDiagnosticsOptions(options: {
      noSemanticValidation?: boolean;
      noSyntaxValidation?: boolean;
    }): void;
    setEagerModelSync(value: boolean): void;
  };
}

interface MonacoHostProps {
  workspaceId?: string;
  workspaceRootPath?: string;
  filePath: string;
  content: string;
  visible?: boolean;
  standalone?: boolean;
  readOnly?: boolean;
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
  workspaceId,
  workspaceRootPath,
  filePath,
  content,
  visible = true,
  standalone = false,
  readOnly = false,
  onContentChange,
  onSave,
}) => {
  const uiTheme = useAtomValue(themeAtom);
  const lspRuntimeMode = useAtomValue(lspRuntimeModeAtom);
  const pendingNavigation = useAtomValue(pendingEditorNavigationAtomFamily(workspaceId ?? ""));
  const setPendingNavigation = useSetAtom(pendingEditorNavigationAtomFamily(workspaceId ?? ""));
  const dispatchCommand = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const { openLocation } = useOpenLocation(workspaceId ?? "");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const standaloneModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const lastAppliedNavigationKeyRef = useRef<number | string | null>(null);
  const wasVisibleRef = useRef(visible);
  const onContentChangeRef = useRef(onContentChange);
  const onSaveRef = useRef(onSave);
  const openLocationRef = useRef(openLocation);
  const filePathRef = useRef(filePath);
  const workspaceIdRef = useRef(workspaceId);
  const workspaceRootPathRef = useRef(workspaceRootPath);
  const isWorkspaceBacked = Boolean(workspaceRootPath) && !standalone;
  const lspHandleRef = useRef<ReturnType<typeof globalLspBridge.attachModel> | null>(null);
  const [lspState, setLspState] = useState<LspBridgeState>({ kind: "unsupported_language" });
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    openLocationRef.current = openLocation;
    filePathRef.current = filePath;
    workspaceIdRef.current = workspaceId;
    workspaceRootPathRef.current = workspaceRootPath;
  }, [filePath, openLocation, workspaceId, workspaceRootPath]);

  const editorLanguage = detectEditorLanguage(filePath);
  const lspLanguage = detectLspLanguage(filePath, editorLanguage);
  const resolvedTheme = getThemeById(uiTheme);
  const editorTheme = `coder-studio-${resolvedTheme.id}`;

  useEffect(() => {
    if (!registeredMonacoThemeIds.has(editorTheme)) {
      monaco.editor.defineTheme(
        editorTheme,
        resolvedTheme.monaco as Parameters<typeof monaco.editor.defineTheme>[1]
      );
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
      readOnly,
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
        language: editorLanguage,
        content,
      });
      if (editor.getModel() !== handle.model) {
        editor.setModel(handle.model);
      }
      return;
    }

    if (!standaloneModelRef.current) {
      standaloneModelRef.current = monaco.editor.createModel(content, editorLanguage);
    }

    const model = standaloneModelRef.current;
    monaco.editor.setModelLanguage(model, editorLanguage);
    if (model.getValue() !== content) {
      model.setValue(content);
    }
    if (editor.getModel() !== model) {
      editor.setModel(model);
    }
  }, [content, editorLanguage, filePath, isWorkspaceBacked, workspaceRootPath]);

  useEffect(() => {
    monaco.editor.setTheme(editorTheme);
  }, [editorTheme]);

  useEffect(() => {
    if (lspRuntimeMode === "off") {
      setLspState({
        kind: "disabled",
        mode: "off",
        message: "LSP is disabled by runtime mode",
      });
      setInstalling(false);
      return;
    }

    setLspState({ kind: "unsupported_language" });
  }, [filePath, lspRuntimeMode]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    globalLspBridge.configure({
      sendCommand: async <T,>(op: string, args: unknown) => {
        const result = await dispatchCommand(op, args);
        return result.ok ? (result.data as T) : (null as T);
      },
      subscribe: (topics, handler) =>
        wsClient?.subscribe(topics, (topic, payload) => handler(topic, payload)) ?? (() => {}),
    });
  }, [dispatchCommand, wsClient]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !isWorkspaceBacked || !workspaceId || !pendingNavigation) {
      return;
    }

    if (pendingNavigation.path !== filePath) {
      return;
    }

    const navigationKey =
      pendingNavigation.requestId ??
      `${pendingNavigation.path}:${pendingNavigation.line ?? ""}:${pendingNavigation.column ?? ""}:${pendingNavigation.endLine ?? ""}:${pendingNavigation.endColumn ?? ""}:${pendingNavigation.source}`;
    if (lastAppliedNavigationKeyRef.current === navigationKey) {
      return;
    }

    lastAppliedNavigationKeyRef.current = navigationKey;
    applyPendingNavigation(editor, pendingNavigation);
    setPendingNavigation((current) =>
      current && isSameNavigationRequest(current, pendingNavigation) ? null : current
    );
  }, [filePath, isWorkspaceBacked, pendingNavigation, setPendingNavigation, workspaceId]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (
      !model ||
      !isWorkspaceBacked ||
      !workspaceId ||
      !workspaceRootPath ||
      lspRuntimeMode !== "auto"
    ) {
      return;
    }

    const handle = globalLspBridge.attachModel(
      {
        workspaceId,
        workspaceRootPath,
        path: filePath,
        monacoLanguage: lspLanguage,
        model,
      },
      setLspState
    );
    lspHandleRef.current = handle;

    return () => {
      lspHandleRef.current = null;
      handle();
    };
  }, [filePath, isWorkspaceBacked, lspLanguage, lspRuntimeMode, workspaceId, workspaceRootPath]);

  const showLspNotice = isWorkspaceBacked && workspaceId && isNoticeLspState(lspState);
  const showInstallAction =
    lspState.kind === "tool_missing" &&
    lspState.autoInstallSupported &&
    lspState.missingPrerequisites.length === 0;

  const handleInstall = async () => {
    if (!lspHandleRef.current) {
      return;
    }
    setInstalling(true);
    try {
      await lspHandleRef.current.install();
    } finally {
      setInstalling(false);
    }
  };

  const handleRetry = async () => {
    await lspHandleRef.current?.retry();
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !isWorkspaceBacked) {
      return;
    }

    const codeEditorService = StandaloneServices.get(
      ICodeEditorService
    ) as CodeEditorOpenHandlerService;

    const disposable = codeEditorService.registerCodeEditorOpenHandler(async (input, source) => {
      if (source !== editor || !input.resource) {
        return null;
      }

      const nextWorkspaceId = workspaceIdRef.current;
      const nextWorkspaceRootPath = workspaceRootPathRef.current;
      if (!nextWorkspaceId || !nextWorkspaceRootPath) {
        return null;
      }

      const targetPath = fromWorkspaceFileUri(input.resource, nextWorkspaceRootPath);
      if (!targetPath || targetPath === filePathRef.current) {
        return null;
      }

      await openLocationRef.current({
        workspaceId: nextWorkspaceId,
        path: targetPath,
        source: "lsp",
        ...toNavigationSelection(input.options?.selection),
      });

      return waitForEditorModel(editor, input.resource);
    });
    return () => {
      disposable.dispose();
    };
  }, [isWorkspaceBacked]);

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
    <>
      {showLspNotice ? (
        <LspStatusNotice
          state={lspState}
          onInstall={showInstallAction ? handleInstall : undefined}
          onRetry={handleRetry}
          installing={installing}
        />
      ) : null}
      <div
        ref={containerRef}
        className="monaco-host"
        data-monaco-mode={isWorkspaceBacked ? "workspace" : "standalone"}
      />
    </>
  );
};

/**
 * Detect language from file extension
 */
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

function detectLspLanguage(filePath: string, editorLanguage: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === "tsx") {
    return "typescriptreact";
  }
  if (ext === "jsx") {
    return "javascriptreact";
  }

  return editorLanguage;
}

function applyPendingNavigation(
  editor: monaco.editor.IStandaloneCodeEditor,
  navigation: PendingEditorNavigation
): void {
  const startLineNumber = normalizeEditorCoordinate(navigation.line);
  const startColumn = normalizeEditorCoordinate(navigation.column);
  const endLineNumber = normalizeEditorCoordinate(navigation.endLine, startLineNumber);
  const endColumn = normalizeEditorCoordinate(navigation.endColumn, startColumn);

  if (navigation.endLine !== undefined || navigation.endColumn !== undefined) {
    const range = {
      startLineNumber,
      startColumn,
      endLineNumber,
      endColumn,
    };
    editor.setSelection(range);
    editor.revealRangeInCenter(range);
    return;
  }

  if (navigation.line !== undefined || navigation.column !== undefined) {
    const position = {
      lineNumber: startLineNumber,
      column: startColumn,
    };
    editor.setPosition(position);
    editor.revealPositionInCenter(position);
  }
}

function isSameNavigationRequest(
  left: PendingEditorNavigation,
  right: PendingEditorNavigation
): boolean {
  if (left.requestId !== undefined || right.requestId !== undefined) {
    return left.requestId === right.requestId;
  }

  return (
    left.workspaceId === right.workspaceId &&
    left.path === right.path &&
    left.line === right.line &&
    left.column === right.column &&
    left.endLine === right.endLine &&
    left.endColumn === right.endColumn &&
    left.source === right.source
  );
}

function normalizeEditorCoordinate(value: number | undefined, fallback = 1): number {
  return Math.max(1, value ?? fallback);
}

export default MonacoHost;

function configureJavaScriptTypeScriptDefaults(): void {
  const typeScriptLanguage = (
    monaco.languages as unknown as { typescript?: MonacoTypeScriptLanguage }
  ).typescript;
  if (javaScriptTypeScriptDefaultsConfigured || !typeScriptLanguage) {
    return;
  }

  javaScriptTypeScriptDefaultsConfigured = true;

  const sharedCompilerOptions = {
    allowJs: true,
    allowNonTsExtensions: true,
    jsx: typeScriptLanguage.JsxEmit.ReactJSX,
    module: typeScriptLanguage.ModuleKind.ESNext,
    moduleResolution: typeScriptLanguage.ModuleResolutionKind.NodeJs,
    target: typeScriptLanguage.ScriptTarget.ESNext,
  };

  typeScriptLanguage.typescriptDefaults.setCompilerOptions(sharedCompilerOptions);
  typeScriptLanguage.javascriptDefaults.setCompilerOptions(sharedCompilerOptions);
  typeScriptLanguage.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
  });
  typeScriptLanguage.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
  });
  typeScriptLanguage.typescriptDefaults.setEagerModelSync(true);
  typeScriptLanguage.javascriptDefaults.setEagerModelSync(true);
}

interface CodeEditorOpenHandlerService {
  registerCodeEditorOpenHandler(
    handler: (
      input: CodeEditorOpenInput,
      source: monaco.editor.ICodeEditor | null,
      sideBySide?: boolean
    ) =>
      | monaco.editor.ICodeEditor
      | monaco.editor.IStandaloneCodeEditor
      | Promise<monaco.editor.ICodeEditor | monaco.editor.IStandaloneCodeEditor | null>
      | null
  ): monaco.IDisposable;
}

interface CodeEditorOpenInput {
  resource?: monaco.Uri;
  options?: {
    selection?: monaco.IRange | monaco.IPosition | null;
  } | null;
}

function toNavigationSelection(
  selection: monaco.IRange | monaco.IPosition | null | undefined
): Pick<PendingEditorNavigation, "line" | "column" | "endLine" | "endColumn"> {
  if (!selection) {
    return {};
  }

  if ("startLineNumber" in selection) {
    return {
      line: selection.startLineNumber,
      column: selection.startColumn,
      endLine: selection.endLineNumber,
      endColumn: selection.endColumn,
    };
  }

  return {
    line: selection.lineNumber,
    column: selection.column,
  };
}

function waitForEditorModel(
  editor: monaco.editor.IStandaloneCodeEditor,
  resource: monaco.Uri,
  timeoutMs = 3000
): Promise<monaco.editor.IStandaloneCodeEditor | null> {
  if (editor.getModel()?.uri.toString() === resource.toString()) {
    return Promise.resolve(editor);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

    const finish = (value: monaco.editor.IStandaloneCodeEditor | null) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      modelChangeDisposable.dispose();
      resolve(value);
    };

    const modelChangeDisposable = editor.onDidChangeModel(() => {
      if (editor.getModel()?.uri.toString() === resource.toString()) {
        finish(editor);
      }
    });

    timeoutId = globalThis.setTimeout(() => {
      finish(null);
    }, timeoutMs);
  });
}
