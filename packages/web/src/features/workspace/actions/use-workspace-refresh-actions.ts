import type { GitBranch, GitStatus, WorktreeInfo } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import { pushToastAtom } from "../../notifications/atoms";
import {
  editorRefreshTokenAtomFamily,
  expandedDirsAtomFamily,
  fileTreeAtomFamily,
  gitBranchListAtomFamily,
  gitStateAtomFamily,
  loadedDirsAtomFamily,
  worktreeListAtomFamily,
} from "../atoms";
import {
  applyDirectoryRefresh,
  applyRootTreeRefresh,
  collectRefreshTargets,
} from "./file-tree-refresh";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

type WorkspaceRefreshStatus = "idle" | "refreshing" | "error";

interface ReadTreeResult {
  path: string;
  children: Array<{ path: string; name: string; kind: "file" | "dir"; isGitIgnored?: boolean }>;
}

export function useWorkspaceRefreshActions(workspaceId: string) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const expandedDirs = useAtomValue(expandedDirsAtomFamily(workspaceId));
  const fileTree = useAtomValue(fileTreeAtomFamily(workspaceId));
  const loadedDirs = useAtomValue(loadedDirsAtomFamily(workspaceId));
  const setGitState = useSetAtom(gitStateAtomFamily(workspaceId));
  const setBranchList = useSetAtom(gitBranchListAtomFamily(workspaceId));
  const setWorktreeList = useSetAtom(worktreeListAtomFamily(workspaceId));
  const setFileTree = useSetAtom(fileTreeAtomFamily(workspaceId));
  const setLoadedDirs = useSetAtom(loadedDirsAtomFamily(workspaceId));
  const setExpandedDirs = useSetAtom(expandedDirsAtomFamily(workspaceId));
  const setEditorRefreshToken = useSetAtom(editorRefreshTokenAtomFamily(workspaceId));
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);
  const [status, setStatus] = useState<WorkspaceRefreshStatus>("idle");
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);

  const syncExpandedDirs = useCallback(
    (current: Set<string> | null, next: Set<string>) => {
      if (current === null) {
        return next;
      }

      if (current.size === next.size && [...current].every((value) => next.has(value))) {
        return current;
      }

      const normalized = collectRefreshTargets(next);
      const synced = new Set(normalized);
      setExpandedDirs(synced);
      void persistUiState({ fileTreeExpandedDirs: normalized });
      return synced;
    },
    [persistUiState, setExpandedDirs]
  );

  const refreshWorkspace = useCallback(async () => {
    if (!workspaceId) {
      return false;
    }

    if (inFlightRef.current) {
      queuedRef.current = true;
      return false;
    }

    inFlightRef.current = true;
    setStatus("refreshing");

    try {
      do {
        queuedRef.current = false;
        const failures: string[] = [];

        const [branchResult, statusResult, worktreeResult, rootTreeResult] = await Promise.all([
          dispatch<{ current: string; branches: GitBranch[] }>("git.branches", { workspaceId }),
          dispatch<GitStatus>("git.status", { workspaceId }),
          dispatch<{ worktrees: WorktreeInfo[] }>("worktree.list", { workspaceId }),
          dispatch<ReadTreeResult>("file.readTree", { workspaceId }),
        ]);

        if (branchResult.ok && branchResult.data) {
          setBranchList({
            current: branchResult.data.current,
            branches: branchResult.data.branches,
            loading: false,
          });
        } else {
          failures.push("branches");
        }

        if (statusResult.ok && statusResult.data) {
          setGitState(statusResult.data);
        } else {
          failures.push("git");
        }

        if (worktreeResult.ok && worktreeResult.data) {
          setWorktreeList({
            items: worktreeResult.data.worktrees,
            loading: false,
            lastLoadedAt: Date.now(),
          });
        } else {
          failures.push("worktrees");
        }

        if (!rootTreeResult.ok || !rootTreeResult.data) {
          failures.push("files");
        } else {
          const reconciled = applyRootTreeRefresh({
            previousTree: fileTree,
            previousLoadedDirs: loadedDirs,
            previousExpandedDirs: expandedDirs,
            rootChildren: rootTreeResult.data.children,
          });

          let currentTree = reconciled.tree;
          let currentLoadedDirs = reconciled.loadedDirs;
          let currentExpandedDirs = syncExpandedDirs(expandedDirs, reconciled.prunedExpandedDirs);

          setFileTree(currentTree);
          setLoadedDirs(currentLoadedDirs);

          for (const dirPath of collectRefreshTargets(currentExpandedDirs)) {
            if (!currentExpandedDirs.has(dirPath)) {
              continue;
            }

            const result = await dispatch<ReadTreeResult>("file.readTree", {
              workspaceId,
              subPath: dirPath,
            });

            if (!result.ok || !result.data) {
              failures.push(`files:${dirPath}`);
              continue;
            }

            const refreshed = applyDirectoryRefresh({
              previousTree: currentTree,
              previousLoadedDirs: currentLoadedDirs,
              previousExpandedDirs: currentExpandedDirs,
              dirPath,
              children: result.data.children,
            });

            currentTree = refreshed.tree;
            currentLoadedDirs = new Set(refreshed.loadedDirs).add(dirPath);
            currentExpandedDirs = syncExpandedDirs(
              currentExpandedDirs,
              refreshed.prunedExpandedDirs
            );

            setFileTree(currentTree);
            setLoadedDirs(currentLoadedDirs);
          }
        }

        setEditorRefreshToken((prev) => prev + 1);

        if (failures.length > 0) {
          setStatus("error");
          pushToast({
            kind: "warning",
            title: t("workspace.refresh_partial_title"),
            body: t("workspace.refresh_partial_body", {
              sections: failures.join(", "),
            }),
          });
        } else {
          setStatus("idle");
        }
      } while (queuedRef.current);

      return true;
    } finally {
      inFlightRef.current = false;
      if (!queuedRef.current) {
        setStatus((current) => (current === "error" ? "error" : "idle"));
      }
    }
  }, [
    dispatch,
    fileTree,
    expandedDirs,
    loadedDirs,
    pushToast,
    persistUiState,
    setBranchList,
    setEditorRefreshToken,
    setExpandedDirs,
    setFileTree,
    setGitState,
    setLoadedDirs,
    setWorktreeList,
    syncExpandedDirs,
    t,
    workspaceId,
  ]);

  return {
    refreshWorkspace,
    status,
  };
}
