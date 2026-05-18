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

type WorkspaceRefreshStatus = "idle" | "refreshing" | "error";

interface ReadTreeResult {
  path: string;
  children: Array<{ path: string; name: string; kind: "file" | "dir" }>;
}

function sortExpandedDirs(paths: Iterable<string>): string[] {
  return [...paths].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

export function useWorkspaceRefreshActions(workspaceId: string) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const expandedDirs = useAtomValue(expandedDirsAtomFamily(workspaceId));
  const setGitState = useSetAtom(gitStateAtomFamily(workspaceId));
  const setBranchList = useSetAtom(gitBranchListAtomFamily(workspaceId));
  const setWorktreeList = useSetAtom(worktreeListAtomFamily(workspaceId));
  const setFileTree = useSetAtom(fileTreeAtomFamily(workspaceId));
  const setLoadedDirs = useSetAtom(loadedDirsAtomFamily(workspaceId));
  const setEditorRefreshToken = useSetAtom(editorRefreshTokenAtomFamily(workspaceId));
  const [status, setStatus] = useState<WorkspaceRefreshStatus>("idle");
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);

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

        if (rootTreeResult.ok && rootTreeResult.data) {
          const nextTree = new Map<string, ReadTreeResult["children"]>();
          nextTree.set(".", rootTreeResult.data.children);
          setFileTree(nextTree);
          setLoadedDirs(new Set());
        } else {
          failures.push("files");
        }

        if (rootTreeResult.ok && rootTreeResult.data && expandedDirs && expandedDirs.size > 0) {
          for (const dirPath of sortExpandedDirs(expandedDirs)) {
            const result = await dispatch<ReadTreeResult>("file.readTree", {
              workspaceId,
              subPath: dirPath,
            });

            if (!result.ok || !result.data) {
              failures.push(`files:${dirPath}`);
              continue;
            }

            setFileTree((prev) => {
              const next = new Map(prev ?? []);
              next.set(dirPath, result.data!.children);
              return next;
            });
            setLoadedDirs((prev) => new Set(prev).add(dirPath));
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
    expandedDirs,
    pushToast,
    setBranchList,
    setEditorRefreshToken,
    setFileTree,
    setGitState,
    setLoadedDirs,
    setWorktreeList,
    t,
    workspaceId,
  ]);

  return {
    refreshWorkspace,
    status,
  };
}
