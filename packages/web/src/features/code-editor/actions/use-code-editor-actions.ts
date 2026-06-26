import type {
  AgentInstructionsSystemDocument,
  GitCommitFileEntry,
  GitFileDiffPayload,
} from "@coder-studio/core";
import { type PrimitiveAtom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { activeWorkspaceAtom } from "../../../atoms/workspaces";
import { useTranslation } from "../../../lib/i18n";
import { mergeOpenEditorPaths } from "../../workspace/actions/open-editor-state";
import { useOpenEditorsActions } from "../../workspace/actions/use-open-editors-actions";
import { useWorkspaceUiStatePersistence } from "../../workspace/actions/use-workspace-ui-state-persistence";
import {
  activeEditorTabAtomFamily,
  activeFilePathAtomFamily,
  createWorkspaceBrowserEditorTab,
  createWorkspaceCanvasEditorTabFromSourcePath,
  deriveDocumentPreviewKind,
  deriveEditorModeForOpenFile,
  deriveEditorModeForPath,
  editorModeAtomFamily,
  editorRefreshTokenAtomFamily,
  editorViewVisibleAtomFamily,
  type GitDiffPreview,
  gitDiffPreviewAtomFamily,
  gitDiffPreviewDismissedAtomFamily,
  gitStateAtomFamily,
  isCanvasSourcePath,
  type OpenFile,
  openEditorPathsAtomFamily,
  openEditorTabsAtomFamily,
  openFilesAtomFamily,
  type WorkspaceEditorMode,
  type WorkspaceEditorTab,
} from "../../workspace/atoms";
import { type PendingEditorNavigation, pendingEditorNavigationAtomFamily } from "../atoms";
import { monacoModelRegistry } from "../monaco/model-registry";
import { parseSkillEditorPath } from "../skill-editor-path";
import { parseSystemAgentInstructionsEditorPath } from "../system-agent-instructions-path";
import {
  beginPendingEditorLoad,
  cancelPendingEditorLoad,
  finishPendingEditorLoad,
  hasPendingEditorLoad,
  shouldIgnorePendingEditorLoadResult,
} from "./pending-editor-loads";
import { usePreviewSession } from "./use-preview-session";

interface CodeEditorActionsOptions {
  activeFilePathAtom?: PrimitiveAtom<string | null>;
  editorModeAtom?: PrimitiveAtom<WorkspaceEditorMode>;
  openEditorPathsAtom?: PrimitiveAtom<string[]>;
  pendingNavigationAtom?: PrimitiveAtom<PendingEditorNavigation | null>;
  persistEditorUiState?: boolean;
}

type FileReadTextPayload = {
  kind: "text";
  content: string;
  baseHash: string;
  encoding: "utf-8";
};

type FileReadImagePayload = {
  kind: "image";
  mime: string;
  url: string;
  size: number;
  version: string;
  isTextBacked: boolean;
};

type FileReadPayload = FileReadTextPayload | FileReadImagePayload;
type EditorReadTextPayload = FileReadTextPayload & {
  displayPath?: string;
  exists?: boolean;
};
type EditorReadPayload = EditorReadTextPayload | FileReadImagePayload;

function toSystemFileReadPayload(document: AgentInstructionsSystemDocument): EditorReadTextPayload {
  return {
    kind: "text",
    content: document.content,
    baseHash: document.baseHash ?? "",
    encoding: "utf-8",
    displayPath: document.displayPath,
    exists: document.exists,
  };
}

function isSkillNotFoundError(error: { code?: string } | undefined): boolean {
  return error?.code === "skill_not_found" || error?.code === "not_found";
}

function deriveEditorModeForResource(path: string, file?: OpenFile): WorkspaceEditorMode {
  if (parseSkillEditorPath(path)) {
    return "edit";
  }

  return file ? deriveEditorModeForOpenFile(file) : deriveEditorModeForPath(path);
}

function isBrowserEditorTab(
  tab: WorkspaceEditorTab
): tab is Extract<WorkspaceEditorTab, { kind: "browser" }> {
  return tab.kind === "browser";
}

function isCanvasEditorTab(
  tab: WorkspaceEditorTab
): tab is Extract<WorkspaceEditorTab, { kind: "canvas" }> {
  return tab.kind === "canvas";
}

function isSameEditorTab(
  left: WorkspaceEditorTab | null | undefined,
  right: WorkspaceEditorTab
): boolean {
  if (!left || left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "browser" && right.kind === "browser") {
    return left.id === right.id;
  }

  if (left.kind === "canvas" && right.kind === "canvas") {
    if (left.canvasId && right.canvasId) {
      return left.canvasId === right.canvasId;
    }

    return left.sourcePath === right.sourcePath;
  }

  if (left.kind === "file" && right.kind === "file") {
    return left.path === right.path;
  }

  return false;
}

type WorkspaceFileEditorTab = Extract<WorkspaceEditorTab, { kind: "file" }>;

function findOpenFileEditorTab(
  tabs: WorkspaceEditorTab[],
  path: string
): WorkspaceFileEditorTab | null {
  return (
    (tabs.find((tab) => tab.kind === "file" && tab.path === path) as
      | WorkspaceFileEditorTab
      | undefined) ?? null
  );
}

function resolveFileEditorTab(
  tabs: WorkspaceEditorTab[],
  path: string,
  fallbackPinned = false
): WorkspaceFileEditorTab {
  return findOpenFileEditorTab(tabs, path) ?? { kind: "file", path, pinned: fallbackPinned };
}

function isDirtyOpenFile(file: OpenFile | undefined): boolean {
  return file?.kind === "text" && file.isDirty === true;
}

export function useCodeEditorActions(options: CodeEditorActionsOptions = {}) {
  const t = useTranslation();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const workspaceRootPath = workspace?.path;
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setDiffPreview = useSetAtom(gitDiffPreviewAtomFamily(workspace?.id ?? ""));
  const setDiffPreviewDismissed = useSetAtom(
    gitDiffPreviewDismissedAtomFamily(workspace?.id ?? "")
  );

  const [savingPaths, setSavingPaths] = useState<Set<string>>(() => new Set());
  const savingPathsRef = useRef<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<{ path: string; message: string } | null>(null);
  const [fileLoadError, setFileLoadError] = useState<{ path: string; message: string } | null>(
    null
  );
  const [externalStatus, setExternalStatus] = useState<{
    path: string;
    status: "modified" | "deleted";
  } | null>(null);

  const workspaceId = workspace?.id;
  const activeFilePathAtom =
    options.activeFilePathAtom ?? activeFilePathAtomFamily(workspaceId ?? "");
  const editorModeAtom = options.editorModeAtom ?? editorModeAtomFamily(workspaceId ?? "");
  const openEditorPathsAtom =
    options.openEditorPathsAtom ?? openEditorPathsAtomFamily(workspaceId ?? "");
  const pendingNavigationAtom =
    options.pendingNavigationAtom ?? pendingEditorNavigationAtomFamily(workspaceId ?? "");
  const shouldPersistEditorUiState = options.persistEditorUiState !== false;
  const isGlobalEditorState =
    options.activeFilePathAtom === undefined &&
    options.editorModeAtom === undefined &&
    options.openEditorPathsAtom === undefined &&
    options.pendingNavigationAtom === undefined;
  const [activeFilePath, setActiveFilePath] = useAtom(activeFilePathAtom);
  const [openFiles, setOpenFiles] = useAtom(openFilesAtomFamily(workspaceId ?? ""));
  const [openEditorPaths, setOpenEditorPaths] = useAtom(openEditorPathsAtom);
  const [openEditorTabs, setOpenEditorTabs] = useAtom(openEditorTabsAtomFamily(workspaceId ?? ""));
  const [globalActiveEditorTab, setActiveEditorTab] = useAtom(
    activeEditorTabAtomFamily(workspaceId ?? "")
  );
  const [localOpenEditorTabs, setLocalOpenEditorTabs] = useState<WorkspaceEditorTab[]>([]);
  const [localActiveEditorTab, setLocalActiveEditorTab] = useState<WorkspaceEditorTab | null>(null);
  const [mode, setMode] = useAtom(editorModeAtom);
  const setEditorViewVisible = useSetAtom(editorViewVisibleAtomFamily(workspaceId ?? ""));
  const editorRefreshToken = useAtomValue(editorRefreshTokenAtomFamily(workspaceId ?? ""));
  const diffPreview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId ?? ""));
  const gitState = useAtomValue(gitStateAtomFamily(workspaceId ?? ""));
  const lastSeededModePathRef = useRef<string | null>(null);
  const pendingActivePathRef = useRef<string | null>(null);
  const nextSaveRequestIdRef = useRef(0);
  const activeSaveRequestIdByPathRef = useRef<Map<string, number>>(new Map());
  const nextCommitDiffRequestIdRef = useRef(0);
  const openEditorTabsRef = useRef<WorkspaceEditorTab[]>([]);
  const activeEditorTabRef = useRef<WorkspaceEditorTab | null>(null);
  const activationHistoryPathsRef = useRef<string[]>([]);
  const previousOpenFilePathsRef = useRef<string[] | null>(null);
  const recordActivationPath = useCallback((path: string | null | undefined) => {
    if (!path) {
      return;
    }

    activationHistoryPathsRef.current = [
      ...activationHistoryPathsRef.current.filter((entry) => entry !== path),
      path,
    ].slice(-50);
  }, []);
  const getActivationHistoryPaths = useCallback(() => activationHistoryPathsRef.current, []);
  const { closePath } = useOpenEditorsActions(workspaceId ?? "", {
    activeFilePathAtom,
    editorModeAtom,
    getActivationHistoryPaths,
    openEditorPathsAtom,
    persistEditorUiState: shouldPersistEditorUiState,
    workspaceRootPath,
  });
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId ?? "");

  const currentFile: OpenFile | undefined = workspaceId
    ? openFiles[activeFilePath ?? ""]
    : undefined;
  const currentOpenEditorTabs = isGlobalEditorState ? openEditorTabs : localOpenEditorTabs;
  const currentActiveEditorTab = isGlobalEditorState ? globalActiveEditorTab : localActiveEditorTab;
  const activeCanvasEditorTab =
    currentActiveEditorTab?.kind === "canvas" ? currentActiveEditorTab : null;

  useEffect(() => {
    if (!activeFilePath) {
      if (!isGlobalEditorState && currentActiveEditorTab?.kind === "file") {
        setLocalActiveEditorTab(null);
      }
      return;
    }

    recordActivationPath(activeFilePath);
    const matchingOpenFileTab = findOpenFileEditorTab(currentOpenEditorTabs, activeFilePath);
    const nextFileTab =
      matchingOpenFileTab ??
      ({
        kind: "file",
        path: activeFilePath,
        pinned: openEditorPaths.includes(activeFilePath),
      } as const);
    const shouldSyncPaneActiveTabToFile =
      !currentActiveEditorTab ||
      (currentActiveEditorTab.kind === "file" && currentActiveEditorTab.path !== activeFilePath) ||
      (currentActiveEditorTab.kind === "file" &&
        matchingOpenFileTab !== null &&
        currentActiveEditorTab.pinned !== matchingOpenFileTab.pinned) ||
      (currentActiveEditorTab.kind === "canvas" &&
        currentActiveEditorTab.sourcePath !== activeFilePath);
    const shouldSyncGlobalActiveTabToFile =
      !currentActiveEditorTab ||
      (currentActiveEditorTab.kind === "file" && currentActiveEditorTab.path !== activeFilePath) ||
      (currentActiveEditorTab.kind === "file" &&
        matchingOpenFileTab !== null &&
        currentActiveEditorTab.pinned !== matchingOpenFileTab.pinned);
    if (isGlobalEditorState && shouldSyncGlobalActiveTabToFile) {
      setActiveEditorTab(nextFileTab);
    } else if (!isGlobalEditorState && shouldSyncPaneActiveTabToFile) {
      setLocalActiveEditorTab(nextFileTab);
    }
    if (isGlobalEditorState && workspaceId) {
      setEditorViewVisible(true);
    }
  }, [
    activeFilePath,
    currentActiveEditorTab,
    currentOpenEditorTabs,
    isGlobalEditorState,
    openEditorPaths,
    recordActivationPath,
    setActiveEditorTab,
    setEditorViewVisible,
    setLocalActiveEditorTab,
    workspaceId,
  ]);

  useEffect(() => {
    if (!activeFilePath) {
      lastSeededModePathRef.current = null;
      return;
    }

    if (!workspaceId || !currentFile || lastSeededModePathRef.current === activeFilePath) {
      return;
    }

    lastSeededModePathRef.current = activeFilePath;
    const shouldPreserveDiffMode =
      mode === "diff" &&
      (diffPreview?.kind === "worktree-file-diff" ||
        diffPreview?.kind === "search-replace-file-diff") &&
      diffPreview.path === activeFilePath;
    const nextMode = shouldPreserveDiffMode
      ? "diff"
      : deriveEditorModeForResource(activeFilePath, currentFile);
    if (nextMode !== mode) {
      setMode(nextMode);
    }
  }, [activeFilePath, currentFile, diffPreview, mode, setMode, workspaceId]);

  useEffect(() => {
    setSaveError((current) => (current?.path === activeFilePath ? current : null));
    setFileLoadError((current) => (current?.path === activeFilePath ? current : null));
    setExternalStatus((current) => (current?.path === activeFilePath ? current : null));
  }, [activeFilePath]);

  useEffect(() => {
    openEditorTabsRef.current = currentOpenEditorTabs;
  }, [currentOpenEditorTabs]);

  useEffect(() => {
    activeEditorTabRef.current = currentActiveEditorTab;
  }, [currentActiveEditorTab]);

  const invalidateSaveStateForPaths = useCallback((paths: string[]) => {
    if (paths.length === 0) {
      return;
    }

    const removedPaths = new Set(paths);
    for (const path of removedPaths) {
      activeSaveRequestIdByPathRef.current.delete(path);
    }

    setSavingPaths((current) => {
      let changed = false;
      const next = new Set(current);
      for (const path of removedPaths) {
        if (next.delete(path)) {
          changed = true;
        }
      }

      savingPathsRef.current = changed ? next : current;
      return changed ? next : current;
    });
    setSaveError((current) => (current && removedPaths.has(current.path) ? null : current));
  }, []);

  useEffect(() => {
    const currentOpenFilePaths = Object.keys(openFiles);
    if (previousOpenFilePathsRef.current === null) {
      previousOpenFilePathsRef.current = currentOpenFilePaths;
      return;
    }

    const removedPaths = previousOpenFilePathsRef.current.filter((path) => !(path in openFiles));
    previousOpenFilePathsRef.current = currentOpenFilePaths;
    invalidateSaveStateForPaths(removedPaths);
  }, [invalidateSaveStateForPaths, openFiles]);

  useEffect(() => {
    if (!workspaceId) {
      pendingActivePathRef.current = null;
      return;
    }

    const nextPendingActivePath =
      activeFilePath && !openFiles[activeFilePath] ? activeFilePath : null;
    const previousPendingActivePath = pendingActivePathRef.current;

    if (previousPendingActivePath && previousPendingActivePath !== nextPendingActivePath) {
      cancelPendingEditorLoad(workspaceId, previousPendingActivePath);
    }

    pendingActivePathRef.current = nextPendingActivePath;
  }, [activeFilePath, openFiles, workspaceId]);

  const loadFile = useCallback(
    async (path: string, options?: { forceText?: boolean }) => {
      if (!workspaceId) {
        return;
      }

      const requestId = beginPendingEditorLoad(workspaceId, path);
      setFileLoadError((current) => (current?.path === path ? null : current));
      const systemProviderId = parseSystemAgentInstructionsEditorPath(path);
      const skillPath = parseSkillEditorPath(path);
      const result = systemProviderId
        ? await dispatch<AgentInstructionsSystemDocument>("agentInstructions.system.read", {
            workspaceId,
            providerId: systemProviderId,
          })
        : skillPath
          ? await dispatch<EditorReadPayload>("skills.files.read", {
              skillSlug: skillPath.skillSlug,
              path: skillPath.relativePath,
            })
          : await dispatch<FileReadPayload>("file.read", {
              workspaceId,
              path,
            });

      if (shouldIgnorePendingEditorLoadResult(workspaceId, path, requestId)) {
        return;
      }

      if (!result.ok || !result.data) {
        finishPendingEditorLoad(workspaceId, path, requestId);
        const message = result.error?.message ?? t("code_editor.open_failed_title");
        console.error("Failed to open file:", message);
        setFileLoadError({ path, message });
        return;
      }

      const data: EditorReadPayload = systemProviderId
        ? toSystemFileReadPayload(result.data as AgentInstructionsSystemDocument)
        : (result.data as FileReadPayload);

      if (options?.forceText && data.kind === "image" && data.isTextBacked) {
        try {
          const response = await fetch(data.url, { credentials: "include" });
          if (shouldIgnorePendingEditorLoadResult(workspaceId, path, requestId)) {
            return;
          }

          if (!response.ok) {
            finishPendingEditorLoad(workspaceId, path, requestId);
            const message = `${t("code_editor.text_backed_image_load_failed")}: ${response.status}`;
            console.error(message);
            setFileLoadError({ path, message });
            return;
          }

          const content = await response.text();
          if (shouldIgnorePendingEditorLoadResult(workspaceId, path, requestId)) {
            return;
          }

          const newFile: OpenFile = {
            kind: "text",
            path,
            content,
            savedContent: content,
            baseHash: "",
            isDirty: false,
            viewingTextBackedImageAsText: true,
          };

          finishPendingEditorLoad(workspaceId, path, requestId);
          setOpenFiles((prev) => ({ ...prev, [path]: newFile }));
          if (workspaceRootPath && !systemProviderId && !skillPath) {
            monacoModelRegistry.updateFromDisk({
              workspaceRootPath,
              path,
              content,
            });
          }
          setFileLoadError((current) => (current?.path === path ? null : current));
        } catch (error) {
          finishPendingEditorLoad(workspaceId, path, requestId);
          const message =
            error instanceof Error ? error.message : t("code_editor.text_backed_image_load_failed");
          console.error("Failed to fetch text-backed image bytes:", error);
          setFileLoadError({ path, message });
        }

        return;
      }

      const newFile: OpenFile =
        data.kind === "text"
          ? {
              kind: "text",
              path,
              displayPath: data.displayPath,
              content: data.content,
              savedContent: data.content,
              baseHash: data.baseHash,
              isDirty: false,
              externalState: undefined,
            }
          : {
              kind: "image",
              path,
              mime: data.mime,
              url: data.url,
              size: data.size,
              version: data.version,
              isTextBacked: data.isTextBacked,
              externalState: undefined,
            };

      finishPendingEditorLoad(workspaceId, path, requestId);
      setOpenFiles((prev) => ({ ...prev, [path]: newFile }));
      if (workspaceRootPath && data.kind === "text" && !systemProviderId && !skillPath) {
        monacoModelRegistry.updateFromDisk({
          workspaceRootPath,
          path,
          content: data.content,
        });
      }
      setExternalStatus((current) => (current?.path === path ? null : current));
      setFileLoadError((current) => (current?.path === path ? null : current));
    },
    [dispatch, setOpenFiles, t, workspaceId, workspaceRootPath]
  );

  const loadTextBackedImageContent = useCallback(
    async (url: string) => {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        throw new Error(`${t("code_editor.text_backed_image_load_failed")}: ${response.status}`);
      }

      return response.text();
    },
    [t]
  );

  const pinFileEditorTab = useCallback(
    (path: string) => {
      const pinnedTab = { kind: "file" as const, path, pinned: true };
      const currentOpenEditorTabs = openEditorTabsRef.current;
      const nextOpenEditorTabs = currentOpenEditorTabs.some(
        (tab) => tab.kind === "file" && tab.path === path
      )
        ? currentOpenEditorTabs.map((tab) =>
            tab.kind === "file" && tab.path === path ? pinnedTab : tab
          )
        : [...currentOpenEditorTabs, pinnedTab];

      openEditorTabsRef.current = nextOpenEditorTabs;
      activeEditorTabRef.current = pinnedTab;

      if (isGlobalEditorState) {
        setOpenEditorTabs(nextOpenEditorTabs);
        setActiveEditorTab(pinnedTab);
        const nextOpenEditorPaths = mergeOpenEditorPaths(openEditorPaths, [path]);
        setOpenEditorPaths(nextOpenEditorPaths);
        if (shouldPersistEditorUiState) {
          void persistUiState({
            openEditorPaths: nextOpenEditorPaths,
            openEditorTabs: nextOpenEditorTabs,
            activeEditorTab: pinnedTab,
            activeEditorPath: path,
          });
        }
        return;
      }

      setLocalOpenEditorTabs(nextOpenEditorTabs);
      setLocalActiveEditorTab(pinnedTab);
    },
    [
      isGlobalEditorState,
      openEditorPaths,
      persistUiState,
      setActiveEditorTab,
      setLocalActiveEditorTab,
      setLocalOpenEditorTabs,
      setOpenEditorPaths,
      setOpenEditorTabs,
      shouldPersistEditorUiState,
    ]
  );

  const handleSave = useCallback(async () => {
    if (!workspaceId || !currentFile || currentFile.kind !== "text") {
      return;
    }

    const { path, content, baseHash } = currentFile;
    if (savingPathsRef.current.has(path)) {
      return;
    }

    const requestId = ++nextSaveRequestIdRef.current;
    activeSaveRequestIdByPathRef.current.set(path, requestId);
    const nextSavingPaths = new Set(savingPathsRef.current);
    nextSavingPaths.add(path);
    savingPathsRef.current = nextSavingPaths;
    setSavingPaths(nextSavingPaths);
    setSaveError((current) => (current?.path === path ? null : current));

    const systemProviderId = parseSystemAgentInstructionsEditorPath(path);
    const skillPath = parseSkillEditorPath(path);
    const result = systemProviderId
      ? await dispatch<AgentInstructionsSystemDocument>("agentInstructions.system.write", {
          workspaceId,
          providerId: systemProviderId,
          content,
          baseHash: baseHash || undefined,
        })
      : skillPath
        ? await dispatch<{ newHash: string }>("skills.files.write", {
            skillSlug: skillPath.skillSlug,
            path: skillPath.relativePath,
            content,
            baseHash: baseHash || undefined,
          })
        : await dispatch<{ newHash: string }>("file.write", {
            workspaceId,
            path,
            content,
            baseHash: baseHash || undefined,
          });

    if (activeSaveRequestIdByPathRef.current.get(path) !== requestId) {
      return;
    }

    if (result.ok && result.data) {
      setOpenFiles((prev) => {
        const prevFile = prev[path];
        if (!prevFile || prevFile.kind !== "text") {
          return prev;
        }

        const nextBaseHash = systemProviderId
          ? ((result.data as AgentInstructionsSystemDocument).baseHash ?? "")
          : (result.data as { newHash: string }).newHash;
        const nextDisplayPath = systemProviderId
          ? (result.data as AgentInstructionsSystemDocument).displayPath
          : prevFile.displayPath;

        return {
          ...prev,
          [path]: {
            ...prevFile,
            savedContent: content,
            baseHash: nextBaseHash,
            displayPath: nextDisplayPath,
            isDirty: false,
            externalState: undefined,
          },
        };
      });
      setExternalStatus((current) => (current?.path === path ? null : current));
    } else {
      setSaveError({ path, message: result.error?.message ?? t("code_editor.save_failed_title") });
    }

    activeSaveRequestIdByPathRef.current.delete(path);
    const nextSavingPathsAfterSave = new Set(savingPathsRef.current);
    nextSavingPathsAfterSave.delete(path);
    savingPathsRef.current = nextSavingPathsAfterSave;
    setSavingPaths(nextSavingPathsAfterSave);
  }, [currentFile, dispatch, setOpenFiles, t, workspaceId]);

  const handleContentChange = useCallback(
    (newContent: string) => {
      if (!workspaceId || !currentFile || currentFile.kind !== "text") {
        return;
      }

      setOpenFiles((prev) => {
        const prevFile = prev[currentFile.path];
        if (!prevFile || prevFile.kind !== "text") {
          return prev;
        }

        return {
          ...prev,
          [currentFile.path]: {
            ...prevFile,
            content: newContent,
            isDirty: newContent !== prevFile.savedContent,
          },
        };
      });

      const activeTab = activeEditorTabRef.current;
      if (activeTab?.kind === "file" && activeTab.path === currentFile.path) {
        pinFileEditorTab(currentFile.path);
      }
    },
    [currentFile, pinFileEditorTab, setOpenFiles, workspaceId]
  );

  useEffect(() => {
    if (!workspaceId || !activeFilePath) {
      return;
    }

    if (openFiles[activeFilePath]) {
      return;
    }

    if (hasPendingEditorLoad(workspaceId, activeFilePath)) {
      return;
    }

    void loadFile(activeFilePath);
  }, [activeFilePath, loadFile, openFiles, workspaceId]);

  useEffect(() => {
    if (!workspaceId || editorRefreshToken <= 0) {
      return;
    }

    const entries = Object.entries(openFiles);
    if (entries.length === 0) {
      return;
    }

    let cancelled = false;

    const reconcileOpenFiles = async () => {
      for (const [path, file] of entries) {
        const systemProviderId = parseSystemAgentInstructionsEditorPath(path);
        const skillPath = parseSkillEditorPath(path);
        const result = systemProviderId
          ? await dispatch<AgentInstructionsSystemDocument>("agentInstructions.system.read", {
              workspaceId,
              providerId: systemProviderId,
            })
          : skillPath
            ? await dispatch<EditorReadPayload>("skills.files.read", {
                skillSlug: skillPath.skillSlug,
                path: skillPath.relativePath,
              })
            : await dispatch<FileReadPayload>("file.read", {
                workspaceId,
                path,
              });

        if (cancelled) {
          return;
        }

        const systemDocument = systemProviderId
          ? (result.data as AgentInstructionsSystemDocument | undefined)
          : undefined;
        if (!result.ok || !result.data || (systemDocument && !systemDocument.exists)) {
          const isMissing = systemDocument
            ? true
            : skillPath
              ? isSkillNotFoundError(result.error)
              : result.error?.code === "not_found";
          setOpenFiles((prev) => {
            const existing = prev[path];
            if (!existing) {
              return prev;
            }
            return {
              ...prev,
              [path]: {
                ...existing,
                externalState: isMissing ? "deleted" : existing.externalState,
              },
            };
          });
          if (isMissing && activeFilePath === path) {
            setExternalStatus({ path, status: "deleted" });
          }
          continue;
        }

        const nextData: EditorReadPayload = systemProviderId
          ? toSystemFileReadPayload(result.data as AgentInstructionsSystemDocument)
          : (result.data as FileReadPayload);

        if (file.kind === "text" && nextData.kind === "text") {
          const hasChangedOnDisk = nextData.baseHash !== file.baseHash;
          if (!hasChangedOnDisk) {
            continue;
          }

          if (file.isDirty) {
            setOpenFiles((prev) => {
              const existing = prev[path];
              if (!existing || existing.kind !== "text") {
                return prev;
              }
              return {
                ...prev,
                [path]: {
                  ...existing,
                  externalState: "modified",
                },
              };
            });
            if (activeFilePath === path) {
              setExternalStatus({ path, status: "modified" });
            }
            continue;
          }

          setOpenFiles((prev) => ({
            ...prev,
            [path]: {
              kind: "text",
              path,
              displayPath: nextData.displayPath ?? file.displayPath,
              content: nextData.content,
              savedContent: nextData.content,
              baseHash: nextData.baseHash,
              isDirty: false,
              externalState: undefined,
              viewingTextBackedImageAsText: file.viewingTextBackedImageAsText,
            },
          }));
          if (workspaceRootPath && !systemProviderId && !skillPath) {
            monacoModelRegistry.updateFromDisk({
              workspaceRootPath,
              path,
              content: nextData.content,
            });
          }
          if (activeFilePath === path) {
            setExternalStatus((current) => (current?.path === path ? null : current));
          }
          continue;
        }

        if (
          file.kind === "text" &&
          file.viewingTextBackedImageAsText === true &&
          nextData.kind === "image" &&
          nextData.isTextBacked
        ) {
          if (file.isDirty) {
            setOpenFiles((prev) => {
              const existing = prev[path];
              if (!existing || existing.kind !== "text") {
                return prev;
              }

              return {
                ...prev,
                [path]: {
                  ...existing,
                  externalState: "modified",
                },
              };
            });

            if (activeFilePath === path) {
              setExternalStatus({
                path,
                status: "modified",
              });
            }
            continue;
          }

          try {
            const content = await loadTextBackedImageContent(nextData.url);
            if (cancelled) {
              return;
            }

            setOpenFiles((prev) => {
              const existing = prev[path];
              if (!existing || existing.kind !== "text") {
                return prev;
              }

              return {
                ...prev,
                [path]: {
                  ...existing,
                  content,
                  savedContent: content,
                  baseHash: nextData.version,
                  isDirty: false,
                  externalState: undefined,
                  viewingTextBackedImageAsText: true,
                },
              };
            });

            if (activeFilePath === path) {
              setExternalStatus((current) => (current?.path === path ? null : current));
            }
          } catch (error) {
            console.error("Failed to refresh text-backed image bytes:", error);
            setOpenFiles((prev) => {
              const existing = prev[path];
              if (!existing || existing.kind !== "text") {
                return prev;
              }

              return {
                ...prev,
                [path]: {
                  ...existing,
                  externalState: "modified",
                },
              };
            });

            if (activeFilePath === path) {
              setExternalStatus({
                path,
                status: "modified",
              });
            }
          }
          continue;
        }

        if (file.kind === "image" && nextData.kind === "image") {
          if (file.version === nextData.version && file.size === nextData.size) {
            continue;
          }

          setOpenFiles((prev) => ({
            ...prev,
            [path]: {
              kind: "image",
              path,
              mime: nextData.mime,
              url: nextData.url,
              size: nextData.size,
              version: nextData.version,
              isTextBacked: nextData.isTextBacked,
              externalState: undefined,
            },
          }));
          if (activeFilePath === path) {
            setExternalStatus((current) => (current?.path === path ? null : current));
          }
          continue;
        }

        setOpenFiles((prev) => {
          const next = { ...prev };
          delete next[path];
          return next;
        });
        if (activeFilePath === path) {
          setExternalStatus({ path, status: "modified" });
        }
      }
    };

    void reconcileOpenFiles();

    return () => {
      cancelled = true;
    };
  }, [
    activeFilePath,
    dispatch,
    editorRefreshToken,
    loadTextBackedImageContent,
    openFiles,
    setOpenFiles,
    workspaceId,
    workspaceRootPath,
  ]);

  const handleClose = useCallback(async () => {
    if (diffPreview?.kind === "commit-file-diff") {
      setDiffPreview(diffPreview.parentList);
      return;
    }

    if (diffPreview?.kind === "commit-file-list") {
      setDiffPreview(null);
      if (currentFile) {
        const nextMode = deriveEditorModeForOpenFile(currentFile);
        if (nextMode !== mode) {
          setMode(nextMode);
        }
      }
      return;
    }

    if (currentFile?.path || activeFilePath) {
      closePath(currentFile?.path ?? activeFilePath ?? undefined);
      if (options.activeFilePathAtom) {
        setActiveFilePath(null);
      }
    }

    setSaveError(null);
  }, [
    activeFilePath,
    closePath,
    currentFile,
    diffPreview,
    mode,
    options.activeFilePathAtom,
    setActiveFilePath,
    setDiffPreview,
    setMode,
  ]);

  const closeOpenFilePath = useCallback(
    (path: string) => {
      if (isGlobalEditorState && workspaceId) {
        setEditorViewVisible(true);
      }
      closePath(path);
      activationHistoryPathsRef.current = activationHistoryPathsRef.current.filter(
        (entry) => entry !== path
      );
      if (isGlobalEditorState) {
        setOpenEditorTabs((current) =>
          current.filter((tab) => tab.kind !== "file" || tab.path !== path)
        );
        setActiveEditorTab((current) =>
          current?.kind === "file" && current.path === path ? null : current
        );
      } else {
        setLocalActiveEditorTab((current) =>
          current?.kind === "file" && current.path === path ? null : current
        );
      }
      setSaveError((current) => (current?.path === path ? null : current));
    },
    [
      closePath,
      isGlobalEditorState,
      setActiveEditorTab,
      setEditorViewVisible,
      setLocalActiveEditorTab,
      setOpenEditorTabs,
      setSaveError,
      workspaceId,
    ]
  );

  const hideEditorView = useCallback(async () => {
    if (isGlobalEditorState && workspaceId) {
      setEditorViewVisible(false);
    }

    const hiddenPath = currentFile?.path ?? activeFilePath;
    if (!hiddenPath) {
      setActiveFilePath(null);
      setMode("edit");
      setSaveError(null);
      if (shouldPersistEditorUiState) {
        void persistUiState({
          activeEditorPath: null,
          editorViewVisible: false,
        });
      }
      return;
    }

    const nextOpenEditorPaths = openEditorPaths.includes(hiddenPath)
      ? openEditorPaths
      : [...openEditorPaths, hiddenPath];
    if (nextOpenEditorPaths !== openEditorPaths) {
      setOpenEditorPaths(nextOpenEditorPaths);
    }

    setActiveFilePath(null);
    setMode("edit");
    setSaveError(null);
    if (shouldPersistEditorUiState) {
      void persistUiState({
        openEditorPaths: nextOpenEditorPaths,
        activeEditorPath: null,
        editorViewVisible: false,
      });
    }
  }, [
    activeFilePath,
    currentFile,
    isGlobalEditorState,
    openEditorPaths,
    persistUiState,
    setActiveFilePath,
    setEditorViewVisible,
    setMode,
    setOpenEditorPaths,
    setSaveError,
    shouldPersistEditorUiState,
    workspaceId,
  ]);

  const toggleSvgTextMode = useCallback(() => {
    if (!workspaceId || !currentFile) {
      return;
    }

    const path = currentFile.path;
    const wantText = currentFile.kind === "image";
    setMode(wantText ? "edit" : "preview");

    setOpenFiles((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    if (workspaceRootPath && currentFile.kind === "text") {
      monacoModelRegistry.disposeFile(workspaceRootPath, path);
    }

    void loadFile(path, wantText ? { forceText: true } : undefined);
  }, [currentFile, loadFile, setMode, setOpenFiles, workspaceId, workspaceRootPath]);

  const openInDiffMode = useCallback(async () => {
    if (!workspaceId || !currentFile) {
      return false;
    }

    const result = await dispatch<GitFileDiffPayload>("git.diff", {
      workspaceId,
      path: currentFile.path,
      staged: false,
    });

    if (!result.ok || !result.data) {
      return false;
    }

    const nextPreview = {
      kind: "worktree-file-diff",
      path: currentFile.path,
      diff: result.data.diff,
      staged: false,
      ...(result.data.renderAs ? { renderAs: result.data.renderAs } : {}),
      ...(result.data.status ? { status: result.data.status } : {}),
      ...(result.data.mime ? { mime: result.data.mime } : {}),
      ...(result.data.originalPath ? { originalPath: result.data.originalPath } : {}),
      ...(result.data.modifiedPath ? { modifiedPath: result.data.modifiedPath } : {}),
      ...(result.data.originalContent !== undefined
        ? { originalContent: result.data.originalContent }
        : {}),
      ...(result.data.modifiedContent !== undefined
        ? { modifiedContent: result.data.modifiedContent }
        : {}),
      ...(result.data.originalRevision ? { originalRevision: result.data.originalRevision } : {}),
      ...(result.data.modifiedRevision ? { modifiedRevision: result.data.modifiedRevision } : {}),
    } as GitDiffPreview;
    setDiffPreviewDismissed(false);
    setDiffPreview(nextPreview);
    setMode("diff");
    return true;
  }, [currentFile, dispatch, setDiffPreview, setDiffPreviewDismissed, setMode, workspaceId]);

  const openCommitFileDiff = useCallback(
    async (file: GitCommitFileEntry) => {
      if (!workspaceId || diffPreview?.kind !== "commit-file-list") {
        return false;
      }

      const parentList = diffPreview;
      const requestId = nextCommitDiffRequestIdRef.current + 1;
      nextCommitDiffRequestIdRef.current = requestId;

      const result = await dispatch<GitFileDiffPayload>("git.commitFileDiff", {
        workspaceId,
        sha: parentList.commit.sha,
        path: file.path,
        ...(file.oldPath ? { oldPath: file.oldPath } : {}),
      });

      if (!result.ok || !result.data) {
        return false;
      }

      const payload = result.data;

      let applied = false;
      setDiffPreview((current) => {
        if (requestId !== nextCommitDiffRequestIdRef.current) {
          return current;
        }

        if (
          current?.kind !== "commit-file-list" ||
          current !== parentList ||
          current.path !== parentList.path ||
          current.commit.sha !== parentList.commit.sha
        ) {
          return current;
        }

        applied = true;
        return {
          kind: "commit-file-diff",
          path: file.path,
          title: file.path,
          commit: parentList.commit,
          file,
          parentList,
          diff: payload.diff,
          renderAs: payload.renderAs,
          status: payload.status,
          ...(payload.mime ? { mime: payload.mime } : {}),
          ...(payload.originalPath ? { originalPath: payload.originalPath } : {}),
          ...(payload.modifiedPath ? { modifiedPath: payload.modifiedPath } : {}),
          ...(payload.originalContent !== undefined
            ? { originalContent: payload.originalContent }
            : {}),
          ...(payload.modifiedContent !== undefined
            ? { modifiedContent: payload.modifiedContent }
            : {}),
          ...(payload.originalRevision ? { originalRevision: payload.originalRevision } : {}),
          ...(payload.modifiedRevision ? { modifiedRevision: payload.modifiedRevision } : {}),
        };
      });
      return applied;
    },
    [diffPreview, dispatch, setDiffPreview, workspaceId]
  );

  const activateOpenFile = useCallback(
    (path: string, options: { pinned?: boolean } = {}) => {
      if (!workspaceId) {
        return;
      }

      recordActivationPath(path);
      const nextFileTab = resolveFileEditorTab(
        openEditorTabsRef.current,
        path,
        options.pinned ?? openEditorPaths.includes(path)
      );
      if (isGlobalEditorState) {
        setEditorViewVisible(true);
        setActiveEditorTab(nextFileTab);
      } else {
        setLocalActiveEditorTab(nextFileTab);
      }

      const nextFile = openFiles[path];
      const nextMode = deriveEditorModeForResource(path, nextFile);

      if (path === activeFilePath) {
        if (nextMode !== mode) {
          setMode(nextMode);
        }
        return;
      }

      setActiveFilePath(path);
      if (nextMode !== mode) {
        setMode(nextMode);
      }
      if (shouldPersistEditorUiState) {
        void persistUiState({
          activeEditorPath: path,
        });
      }
    },
    [
      activeFilePath,
      isGlobalEditorState,
      mode,
      openEditorPaths,
      openFiles,
      persistUiState,
      recordActivationPath,
      setActiveFilePath,
      setActiveEditorTab,
      setEditorViewVisible,
      setLocalActiveEditorTab,
      setMode,
      shouldPersistEditorUiState,
      workspaceId,
    ]
  );

  const openBrowserTab = useCallback(() => {
    if (!workspaceId || !isGlobalEditorState) {
      return;
    }

    const currentOpenEditorTabs = openEditorTabsRef.current;
    const nextBrowserTab = createWorkspaceBrowserEditorTab();
    const nextOpenEditorTabs = [...currentOpenEditorTabs, nextBrowserTab];
    openEditorTabsRef.current = nextOpenEditorTabs;
    activeEditorTabRef.current = nextBrowserTab;
    setEditorViewVisible(true);
    setOpenEditorTabs(nextOpenEditorTabs);
    setActiveEditorTab(nextBrowserTab);
    if (shouldPersistEditorUiState) {
      void persistUiState({
        openEditorTabs: nextOpenEditorTabs,
        activeEditorTab: nextBrowserTab,
      });
    }
  }, [
    isGlobalEditorState,
    persistUiState,
    setActiveEditorTab,
    setEditorViewVisible,
    setOpenEditorTabs,
    shouldPersistEditorUiState,
    workspaceId,
  ]);

  const activateCanvasPreviewForSourcePath = useCallback(
    (sourcePath: string) => {
      if (!workspaceId || !isCanvasSourcePath(sourcePath)) {
        return false;
      }

      const currentOpenEditorTabs = openEditorTabsRef.current;
      const existingCanvasTab = currentOpenEditorTabs.find(
        (tab): tab is Extract<WorkspaceEditorTab, { kind: "canvas" }> =>
          tab.kind === "canvas" && tab.sourcePath === sourcePath
      );
      const nextCanvasTab = createWorkspaceCanvasEditorTabFromSourcePath({
        sourcePath,
        file: openFiles[sourcePath],
        existingTab: existingCanvasTab,
      });
      const nextOpenEditorTabs = existingCanvasTab
        ? currentOpenEditorTabs.map((tab) => (tab === existingCanvasTab ? nextCanvasTab : tab))
        : [...currentOpenEditorTabs, nextCanvasTab];

      openEditorTabsRef.current = nextOpenEditorTabs;
      activeEditorTabRef.current = nextCanvasTab;
      if (isGlobalEditorState) {
        setEditorViewVisible(true);
        setOpenEditorTabs(nextOpenEditorTabs);
        setActiveEditorTab(nextCanvasTab);
      } else {
        setLocalOpenEditorTabs(nextOpenEditorTabs);
        setLocalActiveEditorTab(nextCanvasTab);
      }
      setMode("preview");
      if (isGlobalEditorState && shouldPersistEditorUiState) {
        void persistUiState({
          editorViewVisible: true,
          openEditorTabs: nextOpenEditorTabs,
          activeEditorTab: nextCanvasTab,
        });
      }
      return true;
    },
    [
      isGlobalEditorState,
      persistUiState,
      setActiveEditorTab,
      setEditorViewVisible,
      setLocalActiveEditorTab,
      setLocalOpenEditorTabs,
      setMode,
      setOpenEditorTabs,
      openFiles,
      shouldPersistEditorUiState,
      workspaceId,
    ]
  );

  const activateEditorTab = useCallback(
    (tab: WorkspaceEditorTab) => {
      if (tab.kind === "browser") {
        if (!workspaceId || !isGlobalEditorState) {
          return;
        }

        const currentOpenEditorTabs = openEditorTabsRef.current;
        activeEditorTabRef.current = tab;
        setEditorViewVisible(true);
        setActiveEditorTab(tab);
        if (shouldPersistEditorUiState) {
          void persistUiState({
            openEditorTabs: currentOpenEditorTabs,
            activeEditorTab: tab,
          });
        }
        return;
      }

      if (tab.kind === "canvas") {
        if (!workspaceId) {
          return;
        }

        if (isGlobalEditorState) {
          const currentOpenEditorTabs = openEditorTabsRef.current;
          activeEditorTabRef.current = tab;
          setEditorViewVisible(true);
          setActiveEditorTab(tab);
          if (shouldPersistEditorUiState) {
            void persistUiState({
              openEditorTabs: currentOpenEditorTabs,
              activeEditorTab: tab,
            });
          }
          return;
        }

        activeEditorTabRef.current = tab;
        setLocalActiveEditorTab(tab);
        return;
      }

      activateOpenFile(tab.path);
    },
    [
      activateOpenFile,
      isGlobalEditorState,
      persistUiState,
      setActiveEditorTab,
      setEditorViewVisible,
      setLocalActiveEditorTab,
      shouldPersistEditorUiState,
      workspaceId,
    ]
  );

  const closeEditorTab = useCallback(
    (tab: WorkspaceEditorTab) => {
      if (tab.kind === "file") {
        closeOpenFilePath(tab.path);
        return;
      }

      if (tab.kind === "browser" && !isGlobalEditorState) {
        return;
      }

      const currentOpenEditorTabs = openEditorTabsRef.current;
      const currentActiveEditorTab = activeEditorTabRef.current;
      const currentNonFileTabs = currentOpenEditorTabs.filter(
        (entry): entry is Extract<WorkspaceEditorTab, { kind: "browser" | "canvas" }> =>
          entry.kind === "browser" || entry.kind === "canvas"
      );
      const closedTabIndex = currentNonFileTabs.findIndex((entry) => isSameEditorTab(entry, tab));
      const nextOpenEditorTabs = currentOpenEditorTabs.filter(
        (entry) => !isSameEditorTab(entry, tab)
      );

      if (nextOpenEditorTabs.length === currentOpenEditorTabs.length) {
        return;
      }

      const nextNonFileTabs = nextOpenEditorTabs.filter(
        (entry): entry is Extract<WorkspaceEditorTab, { kind: "browser" | "canvas" }> =>
          entry.kind === "browser" || entry.kind === "canvas"
      );
      const mergedOpenFilePaths = mergeOpenEditorPaths(
        openEditorPaths,
        activeFilePath ? [activeFilePath] : undefined
      );
      const fallbackFilePath =
        activeFilePath && mergedOpenFilePaths.includes(activeFilePath)
          ? activeFilePath
          : (mergedOpenFilePaths[0] ?? null);
      const nextActiveEditorTab = isSameEditorTab(currentActiveEditorTab, tab)
        ? (nextNonFileTabs[closedTabIndex] ??
          nextNonFileTabs[closedTabIndex - 1] ??
          (fallbackFilePath ? ({ kind: "file", path: fallbackFilePath } as const) : null))
        : currentActiveEditorTab;

      openEditorTabsRef.current = nextOpenEditorTabs;
      activeEditorTabRef.current = nextActiveEditorTab;
      if (isGlobalEditorState) {
        setOpenEditorTabs(nextOpenEditorTabs);
        setActiveEditorTab(nextActiveEditorTab);
      } else {
        setLocalOpenEditorTabs(nextOpenEditorTabs);
        setLocalActiveEditorTab(nextActiveEditorTab);
      }
      if (isGlobalEditorState && shouldPersistEditorUiState) {
        void persistUiState({
          openEditorTabs: nextOpenEditorTabs,
          activeEditorTab: nextActiveEditorTab,
        });
      }
    },
    [
      activeFilePath,
      closeOpenFilePath,
      isGlobalEditorState,
      openEditorPaths,
      persistUiState,
      setActiveEditorTab,
      setLocalActiveEditorTab,
      setLocalOpenEditorTabs,
      setOpenEditorTabs,
      shouldPersistEditorUiState,
    ]
  );

  const removeEditorTabs = useCallback(
    (tabsToRemove: WorkspaceEditorTab[]) => {
      if (tabsToRemove.length === 0) {
        return;
      }

      const currentOpenEditorTabs = openEditorTabsRef.current;
      const removedFilePaths = tabsToRemove.flatMap((tab) =>
        tab.kind === "file" ? [tab.path] : []
      );
      const removedFilePathSet = new Set(removedFilePaths);
      const nextOpenEditorTabs = currentOpenEditorTabs.filter(
        (tab) => !tabsToRemove.some((removed) => isSameEditorTab(tab, removed))
      );
      const currentActiveEditorTab = activeEditorTabRef.current;
      const currentActiveRemoved =
        currentActiveEditorTab !== null &&
        tabsToRemove.some((removed) => isSameEditorTab(currentActiveEditorTab, removed));
      const nextActiveEditorTab =
        currentActiveRemoved || !currentActiveEditorTab
          ? (nextOpenEditorTabs[0] ?? null)
          : currentActiveEditorTab;
      const nextActiveFilePath =
        nextActiveEditorTab?.kind === "file"
          ? nextActiveEditorTab.path
          : activeFilePath && !removedFilePathSet.has(activeFilePath)
            ? activeFilePath
            : null;
      const nextOpenEditorPaths = openEditorPaths.filter((path) => !removedFilePathSet.has(path));

      for (const path of removedFilePaths) {
        cancelPendingEditorLoad(workspaceId ?? "", path);
      }

      setOpenFiles((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const path of removedFilePaths) {
          if (path in next) {
            delete next[path];
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      openEditorTabsRef.current = nextOpenEditorTabs;
      activeEditorTabRef.current = nextActiveEditorTab;
      setOpenEditorTabs(nextOpenEditorTabs);
      setActiveEditorTab(nextActiveEditorTab);
      setOpenEditorPaths(nextOpenEditorPaths);
      setActiveFilePath(nextActiveFilePath);
      if (nextActiveFilePath !== activeFilePath) {
        setMode("edit");
      }
      if (shouldPersistEditorUiState) {
        void persistUiState({
          openEditorTabs: nextOpenEditorTabs,
          activeEditorTab: nextActiveEditorTab,
          openEditorPaths: nextOpenEditorPaths,
          activeEditorPath: nextActiveFilePath,
        });
      }
    },
    [
      activeFilePath,
      openEditorPaths,
      persistUiState,
      setActiveEditorTab,
      setActiveFilePath,
      setMode,
      setOpenEditorPaths,
      setOpenEditorTabs,
      setOpenFiles,
      shouldPersistEditorUiState,
      workspaceId,
    ]
  );

  const keepOpenEditorTab = useCallback(
    (tab: WorkspaceEditorTab) => {
      if (tab.kind !== "file") {
        return;
      }

      pinFileEditorTab(tab.path);
    },
    [pinFileEditorTab]
  );

  const closeOtherEditorTabs = useCallback(
    (tab: WorkspaceEditorTab) => {
      const tabsToRemove = openEditorTabsRef.current.filter((entry) => {
        if (isSameEditorTab(entry, tab)) {
          return false;
        }

        return entry.kind !== "file" || !isDirtyOpenFile(openFiles[entry.path]);
      });
      removeEditorTabs(tabsToRemove);
    },
    [openFiles, removeEditorTabs]
  );

  const closeEditorTabsToRight = useCallback(
    (tab: WorkspaceEditorTab) => {
      const currentOpenEditorTabs = openEditorTabsRef.current;
      const index = currentOpenEditorTabs.findIndex((entry) => isSameEditorTab(entry, tab));
      if (index < 0) {
        return;
      }

      removeEditorTabs(
        currentOpenEditorTabs
          .slice(index + 1)
          .filter((entry) => entry.kind !== "file" || !isDirtyOpenFile(openFiles[entry.path]))
      );
    },
    [openFiles, removeEditorTabs]
  );

  const closeSavedEditorTabs = useCallback(() => {
    const tabsToRemove = openEditorTabsRef.current.filter((tab) => {
      if (tab.kind !== "file") {
        return false;
      }

      return !isDirtyOpenFile(openFiles[tab.path]);
    });

    removeEditorTabs(tabsToRemove);
  }, [openFiles, removeEditorTabs]);

  const closeAllEditorTabs = useCallback(() => {
    removeEditorTabs(
      openEditorTabsRef.current.filter(
        (tab) => tab.kind !== "file" || !isDirtyOpenFile(openFiles[tab.path])
      )
    );
  }, [openFiles, removeEditorTabs]);

  const handleSetMode = useCallback(
    (nextMode: WorkspaceEditorMode) => {
      if (nextMode === "preview") {
        const previewSourcePath = activeFilePath ?? activeCanvasEditorTab?.sourcePath;
        if (previewSourcePath && activateCanvasPreviewForSourcePath(previewSourcePath)) {
          return;
        }
      }

      if (nextMode === "edit" && activeCanvasEditorTab) {
        activateOpenFile(activeCanvasEditorTab.sourcePath, { pinned: true });
        return;
      }

      setMode(nextMode);
    },
    [
      activeCanvasEditorTab,
      activeFilePath,
      activateCanvasPreviewForSourcePath,
      activateOpenFile,
      setMode,
    ]
  );

  const isTextFile = currentFile?.kind === "text";
  const isImageFile = currentFile?.kind === "image";
  const isSvgTextBacked =
    (isImageFile && currentFile.isTextBacked) ||
    (isTextFile && currentFile.viewingTextBackedImageAsText === true);
  const canPreview = Boolean(currentFile) || activeCanvasEditorTab !== null;
  const canEdit =
    activeCanvasEditorTab !== null ||
    (Boolean(currentFile) &&
      (currentFile?.kind === "text" ||
        (currentFile?.kind === "image" && currentFile.isTextBacked)));
  const activeFileHasDiffPreview = Boolean(
    activeFilePath &&
      diffPreview &&
      (diffPreview.kind === "worktree-file-diff" ||
        diffPreview.kind === "search-replace-file-diff") &&
      diffPreview.path === activeFilePath
  );
  const activeFileHasGitChange = Boolean(
    activeFilePath &&
      gitState &&
      [...gitState.staged, ...gitState.modified, ...gitState.deleted, ...gitState.untracked].some(
        (change) => change.path === activeFilePath || change.oldPath === activeFilePath
      )
  );
  const canDiff = Boolean(activeFilePath && (activeFileHasGitChange || activeFileHasDiffPreview));
  const hasUnsavedChangesOutsideDiff = Boolean(
    mode === "diff" && activeFilePath && currentFile?.kind === "text" && currentFile.isDirty
  );
  const activeDiffChange =
    diffPreview &&
    (((diffPreview.kind === "worktree-file-diff" ||
      diffPreview.kind === "search-replace-file-diff") &&
      diffPreview.path === activeFilePath) ||
      diffPreview.kind === "commit-file-list" ||
      diffPreview.kind === "commit-file-diff")
      ? diffPreview
      : null;
  const isSaving = Boolean(isTextFile && savingPaths.has(currentFile.path));
  const canSave = Boolean(isTextFile && currentFile.isDirty && !isSaving);
  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      const isSaveShortcut =
        event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey) && !event.altKey;
      if (!isSaveShortcut) {
        return;
      }

      if (!isTextFile) {
        return;
      }

      event.preventDefault();
      if (canSave) {
        void handleSave();
      }
    };

    window.addEventListener("keydown", handleSaveShortcut);
    return () => {
      window.removeEventListener("keydown", handleSaveShortcut);
    };
  }, [canSave, handleSave, isTextFile]);

  const activeLoadError =
    activeFilePath && fileLoadError?.path === activeFilePath ? fileLoadError.message : null;
  const activeExternalStatus =
    activeFilePath && externalStatus?.path === activeFilePath ? externalStatus.status : null;
  const activeSaveError =
    activeFilePath && saveError?.path === activeFilePath ? saveError.message : null;
  const activeSkillPath =
    currentFile?.kind === "text" ? parseSkillEditorPath(currentFile.path) : null;
  const documentPreviewKind =
    currentFile?.kind === "text" && !activeSkillPath
      ? deriveDocumentPreviewKind(currentFile.path)
      : null;
  const documentPreview = usePreviewSession({
    enabled: mode === "preview" && Boolean(documentPreviewKind),
    workspaceId,
    filePath: currentFile?.kind === "text" ? currentFile.path : null,
    content: currentFile?.kind === "text" ? currentFile.content : undefined,
    kind: documentPreviewKind,
  });

  return {
    activeFilePath,
    activeEditorTab:
      currentActiveEditorTab ??
      (activeFilePath
        ? resolveFileEditorTab(
            currentOpenEditorTabs,
            activeFilePath,
            openEditorPaths.includes(activeFilePath)
          )
        : null),
    activeDiffChange,
    activeExternalStatus,
    activeLoadError,
    activateOpenFile,
    activateEditorTab,
    closeEditorTab,
    closeAllEditorTabs,
    closeEditorTabsToRight,
    closeOtherEditorTabs,
    closeSavedEditorTabs,
    closeOpenFilePath,
    canSave,
    canDiff,
    canEdit,
    canPreview,
    currentFile,
    documentPreview,
    handleClose,
    hideEditorView,
    handleContentChange,
    keepOpenEditorTab,
    handleSave,
    hasUnsavedChangesOutsideDiff,
    isImageFile,
    isSaving,
    isSvgTextBacked,
    isTextFile,
    mode: activeCanvasEditorTab ? "preview" : mode,
    openBrowserTab,
    openEditorTabs: (() => {
      const existingFileTabs = currentOpenEditorTabs.filter(
        (tab): tab is Extract<WorkspaceEditorTab, { kind: "file" }> => tab.kind === "file"
      );
      const existingFileTabPaths = new Set(existingFileTabs.map((tab) => tab.path));
      const mergedFileTabs = [
        ...existingFileTabs,
        ...mergeOpenEditorPaths(openEditorPaths, activeFilePath ? [activeFilePath] : undefined)
          .filter((path) => !existingFileTabPaths.has(path))
          .map(
            (path): WorkspaceEditorTab => ({
              kind: "file",
              path,
              pinned: openEditorPaths.includes(path),
            })
          ),
      ];

      return mergedFileTabs.concat(
        currentOpenEditorTabs.filter((tab) => isBrowserEditorTab(tab) || isCanvasEditorTab(tab))
      );
    })(),
    openEditorPaths,
    openFiles,
    openCommitFileDiff,
    openInDiffMode,
    pendingNavigationAtom,
    saveError: activeSaveError,
    setMode: handleSetMode,
    toggleSvgTextMode,
    workspace,
    workspaceId,
  };
}
