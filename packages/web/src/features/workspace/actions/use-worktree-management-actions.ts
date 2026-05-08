import type { WorktreeInfo } from "@coder-studio/core";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { workspaceByIdAtomFamily } from "../../../atoms/workspaces";
import { useTranslation } from "../../../lib/i18n";
import { pushToastAtom } from "../../notifications/atoms";
import { worktreeListAtomFamily } from "../atoms";

function slugifyBranchName(branch: string) {
  return branch
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSuggestedWorktreePath(workspacePath: string, branch: string) {
  const normalized = workspacePath.replace(/\/+$/, "") || workspacePath;
  const lastSlash = normalized.lastIndexOf("/");
  const parent = lastSlash > 0 ? normalized.slice(0, lastSlash) : "";
  const base = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const suffix = slugifyBranchName(branch || "worktree");
  return `${parent}/${base}-${suffix}`;
}

function normalizeWorktreePathInput(path: string) {
  const trimmed = path.trim();
  return trimmed.replace(/\/+$/, "") || "/";
}

export function useWorktreeManagementActions(workspaceId: string) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const workspace = useAtomValue(workspaceByIdAtomFamily(workspaceId));
  const [list, setList] = useAtom(worktreeListAtomFamily(workspaceId));
  const pushToast = useSetAtom(pushToastAtom);

  const loadWorktrees = useCallback(async () => {
    if (!workspaceId) {
      return false;
    }

    setList((prev) => ({ ...prev, loading: true, error: undefined }));
    const result = await dispatch<{ worktrees: WorktreeInfo[] }>("worktree.list", { workspaceId });

    if (!result.ok || !result.data) {
      setList((prev) => ({
        ...prev,
        loading: false,
        error: result.error?.message ?? "Failed to load worktrees",
      }));
      return false;
    }

    setList({
      items: result.data.worktrees,
      loading: false,
      lastLoadedAt: Date.now(),
    });
    return true;
  }, [dispatch, setList, workspaceId]);

  const createWorktree = useCallback(
    async (branch: string, path: string) => {
      const normalizedPath = normalizeWorktreePathInput(path);
      const result = await dispatch<{ worktree: WorktreeInfo }>("worktree.create", {
        workspaceId,
        branch,
        path: normalizedPath,
      });

      if (!result.ok || !result.data?.worktree) {
        const message = result.error?.message ?? "Failed to create worktree";
        pushToast({
          kind: "error",
          title: t("worktree.create_failed_title"),
          body: message,
        });
        return { ok: false as const, error: message };
      }

      await loadWorktrees();
      pushToast({
        kind: "success",
        title: t("worktree.create_success_title"),
        body: t("worktree.create_success_body", { name: result.data.worktree.name }),
      });
      return { ok: true as const, worktree: result.data.worktree };
    },
    [dispatch, loadWorktrees, pushToast, t, workspaceId]
  );

  const removeWorktreeByPath = useCallback(
    async (worktreePath: string, force = false) => {
      const result = await dispatch("worktree.remove", {
        workspaceId,
        worktreePath,
        force,
      });

      if (!result.ok) {
        const message = result.error?.message ?? "Failed to remove worktree";
        pushToast({
          kind: "error",
          title: t("worktree.remove_failed_title"),
          body: message,
        });
        return { ok: false as const, error: message };
      }

      await loadWorktrees();
      pushToast({
        kind: "success",
        title: t("worktree.remove_success_title"),
        body: t("worktree.remove_success_body"),
      });
      return { ok: true as const };
    },
    [dispatch, loadWorktrees, pushToast, t, workspaceId]
  );

  const currentWorktree = useMemo(
    () => list.items.find((item) => item.path === workspace?.path) ?? null,
    [list.items, workspace?.path]
  );

  const dirtyCount = useMemo(
    () => list.items.filter((item) => item.status === "dirty").length,
    [list.items]
  );

  const suggestedPathForBranch = useCallback(
    (branch: string) => {
      if (!workspace?.path) {
        return "";
      }

      return buildSuggestedWorktreePath(workspace.path, branch);
    },
    [workspace?.path]
  );

  return {
    createWorktree,
    currentWorktree,
    dirtyCount,
    hasWorkspace: Boolean(workspace),
    list,
    loadWorktrees,
    removeWorktreeByPath,
    suggestedPathForBranch,
  };
}
