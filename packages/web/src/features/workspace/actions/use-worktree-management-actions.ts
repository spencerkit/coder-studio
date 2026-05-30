import type { Workspace, WorktreeInfo } from "@coder-studio/core";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useMemo } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspaceByIdAtomFamily,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../../../atoms/workspaces";
import { useTranslation } from "../../../lib/i18n";
import { pushToastAtom } from "../../notifications/atoms";
import { worktreeListAtomFamily } from "../atoms";
import { hydrateWorkspaceEditorState } from "./open-editor-state";
import { usePersistWorkspaceLastViewedTarget } from "./use-persist-workspace-last-viewed-target";

function slugifyBranchName(branch: string) {
  return branch
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSuggestedWorktreePath(workspacePath: string, branch: string) {
  const raw = workspacePath.trim();
  const normalized = raw.replace(/[\\/]+$/, "") || raw;
  const separator = raw.includes("\\") ? "\\" : "/";
  const driveRootMatch = /^([A-Za-z]:)([\\/]*)(.*)$/.exec(raw);
  const uncRootMatch = /^(\\\\|\/\/)([^\\/]+)[\\/]+([^\\/]+)(?:[\\/]+(.*))?$/.exec(raw);
  let prefix = "";
  let rest = normalized;

  if (driveRootMatch) {
    prefix = `${driveRootMatch[1]}${separator}`;
    rest = driveRootMatch[3].replace(/[\\/]+$/, "").replace(/^[\\/]+/, "");
  } else if (uncRootMatch) {
    prefix = `${uncRootMatch[1]}${uncRootMatch[2]}${separator}${uncRootMatch[3]}${separator}`;
    rest = (uncRootMatch[4] ?? "").replace(/[\\/]+$/, "").replace(/^[\\/]+/, "");
  } else if (normalized.startsWith("/") || normalized.startsWith("\\")) {
    prefix = normalized[0];
    rest = normalized.replace(/^[\\/]+/, "");
  }

  const parts = rest.split(/[\\/]+/).filter(Boolean);
  const base = parts.pop() ?? "worktree";
  const parent = parts.length > 0 ? `${parts.join(separator)}${separator}` : "";
  const suffix = slugifyBranchName(branch || "worktree");
  return `${prefix}${parent}${base}-${suffix}`;
}

function normalizeWorktreePathInput(path: string) {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }

  if (/^[A-Za-z]:[\\/]+$/.test(trimmed)) {
    return `${trimmed.slice(0, 2)}${trimmed.includes("\\") ? "\\" : "/"}`;
  }

  const normalized = trimmed.replace(/[\\/]+$/, "");
  return normalized || trimmed;
}

function isAbsoluteWorktreePath(path: string) {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path);
}

export function useWorktreeManagementActions(workspaceId: string) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const store = useStore();
  const workspace = useAtomValue(workspaceByIdAtomFamily(workspaceId));
  const [list, setList] = useAtom(worktreeListAtomFamily(workspaceId));
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);
  const setWorkspacesLoadState = useSetAtom(workspacesLoadStateAtom);
  const setWorkspacesLoadError = useSetAtom(workspacesLoadErrorAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const persistLastViewedTarget = usePersistWorkspaceLastViewedTarget();

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
      if (!normalizedPath || !isAbsoluteWorktreePath(normalizedPath)) {
        const message = t("worktree.create_path_absolute_required");
        pushToast({
          kind: "error",
          title: t("worktree.create_failed_title"),
          body: message,
        });
        return { ok: false as const, error: message };
      }
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

  const openWorktree = useCallback(
    async (path: string) => {
      const result = await dispatch<Workspace>("workspace.open", { path });

      if (!result.ok || !result.data?.id) {
        const message = result.error?.message ?? "Failed to open worktree";
        pushToast({
          kind: "error",
          title: t("workspace.launch.open_failed"),
          body: message,
        });
        return { ok: false as const, error: message };
      }

      setActiveWorkspaceId(result.data.id);
      setWorkspaces((prev) => ({
        ...prev,
        [result.data!.id]: result.data!,
      }));
      hydrateWorkspaceEditorState(store, result.data.id, result.data.uiState);
      setWorkspaceOrder((prev) => {
        if (prev.includes(result.data!.id)) {
          return prev;
        }
        return [result.data!.id, ...prev];
      });
      setWorkspacesLoadState("ready");
      setWorkspacesLoadError(null);
      void persistLastViewedTarget({ workspaceId: result.data.id });

      return { ok: true as const, workspace: result.data };
    },
    [
      dispatch,
      persistLastViewedTarget,
      pushToast,
      setActiveWorkspaceId,
      setWorkspaceOrder,
      setWorkspaces,
      setWorkspacesLoadError,
      setWorkspacesLoadState,
      store,
      t,
    ]
  );

  return {
    createWorktree,
    currentWorktree,
    dirtyCount,
    hasWorkspace: Boolean(workspace),
    list,
    loadWorktrees,
    openWorktree,
    removeWorktreeByPath,
    suggestedPathForBranch,
  };
}
