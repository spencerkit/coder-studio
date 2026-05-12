import * as monaco from "monaco-editor";
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
  updateFromDisk(input: {
    workspaceRootPath: string;
    path: string;
    content: string;
    language: string;
  }): void;
  disposeWorkspace(workspaceRootPath: string): void;
}

function createKey(workspaceRootPath: string, path: string): string {
  return `${workspaceRootPath}::${path}`;
}

function syncModel(model: monaco.editor.ITextModel, language: string, content: string): void {
  monaco.editor.setModelLanguage(model, language);
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
        syncModel(existing.model, language, content);
        return {
          ...existing,
          language,
        };
      }

      const uri = toWorkspaceFileUri(workspaceRootPath, path);
      const model =
        monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, language, uri);

      syncModel(model, language, content);

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

    updateFromDisk({ workspaceRootPath, path, content, language }) {
      const key = createKey(workspaceRootPath, path);
      const existing = handles.get(key);
      if (!existing) {
        return;
      }

      syncModel(existing.model, language, content);
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
