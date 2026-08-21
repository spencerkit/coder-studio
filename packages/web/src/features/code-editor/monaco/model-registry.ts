import * as monaco from "monaco-editor";
import { setGlobalMonacoModelRegistry } from "./model-registry-bridge";
import { toWorkspaceFileUri } from "./uri";

export interface EditorModelHandle {
  key: string;
  uri: monaco.Uri;
  model: monaco.editor.ITextModel;
  language: string;
  path: string;
}

export interface ModelRegistry {
  getOrCreate(input: {
    workspaceRootPath: string;
    path: string;
    language: string;
    content: string;
  }): EditorModelHandle;
  updateFromDisk(input: { workspaceRootPath: string; path: string; content: string }): void;
  disposeFile(workspaceRootPath: string, path: string): void;
  disposeWorkspace(workspaceRootPath: string): void;
}

function createKey(workspaceRootPath: string, path: string): string {
  return `${workspaceRootPath}::${path}`;
}

function setModelLanguage(model: monaco.editor.ITextModel, language: string): void {
  monaco.editor.setModelLanguage(model, language);
}

function syncModelFromDisk(
  model: monaco.editor.ITextModel,
  language: string,
  content: string
): void {
  setModelLanguage(model, language);
  if (model.getValue() !== content) {
    model.setValue(content);
  }
}

export function createModelRegistry(): ModelRegistry {
  const handles = new Map<string, EditorModelHandle>();

  return {
    getOrCreate({ workspaceRootPath, path, language, content }) {
      const key = createKey(workspaceRootPath, path);
      const existing = handles.get(key);
      if (existing) {
        setModelLanguage(existing.model, language);
        const handle =
          existing.language === language
            ? existing
            : {
                ...existing,
                language,
              };
        handles.set(key, handle);
        return handle;
      }

      const uri = toWorkspaceFileUri(workspaceRootPath, path);
      const existingModel = monaco.editor.getModel(uri);
      const model = existingModel ?? monaco.editor.createModel(content, language, uri);

      setModelLanguage(model, language);
      if (!existingModel && model.getValue() !== content) {
        model.setValue(content);
      }

      const handle: EditorModelHandle = {
        key,
        uri,
        model,
        language,
        path,
      };
      handles.set(key, handle);
      return handle;
    },

    updateFromDisk({ workspaceRootPath, path, content }) {
      const key = createKey(workspaceRootPath, path);
      const existing = handles.get(key);
      if (!existing) {
        return;
      }

      syncModelFromDisk(existing.model, existing.language, content);
    },

    disposeFile(workspaceRootPath, path) {
      const key = createKey(workspaceRootPath, path);
      const existing = handles.get(key);
      if (!existing) {
        return;
      }

      existing.model.dispose();
      handles.delete(key);
    },

    disposeWorkspace(workspaceRootPath) {
      for (const [key, handle] of handles) {
        if (!key.startsWith(`${workspaceRootPath}::`)) {
          continue;
        }

        handle.model.dispose();
        handles.delete(key);
      }
    },
  };
}

export const monacoModelRegistry = createModelRegistry();

setGlobalMonacoModelRegistry(monacoModelRegistry);
