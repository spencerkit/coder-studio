import type { Tab } from "../../state/workbench-core.ts";
import type { WorkspaceViewPatch } from "../../types/app.ts";

type WorkspaceViewTab = Pick<
  Tab,
  "id" | "activeSessionId" | "activePaneId" | "activeTerminalId" | "paneLayout" | "filePreview"
>;

const persistedWorkspaceViews = new Map<string, string>();
const recentWorkspaceViewRequests = new Map<string, Array<{ serialized: string; at: number }>>();
const RECENT_WORKSPACE_VIEW_REQUEST_LIMIT = 24;
const RECENT_WORKSPACE_VIEW_REQUEST_TTL_MS = 15_000;
export const WORKSPACE_VIEW_PERSIST_DEBOUNCE_MS = 160;

type ScheduleTimeout = (callback: () => void, delayMs: number) => unknown;
type CancelTimeout = (handle: unknown) => void;

const serializePaneLayoutNode = (value: unknown): unknown => {
  const node = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (node.type === "leaf") {
    return {
      type: "leaf",
      id: typeof node.id === "string" ? node.id : "",
      sessionId: typeof node.sessionId === "string"
        ? node.sessionId
        : (typeof node.session_id === "string" ? node.session_id : ""),
    };
  }
  return {
    type: "split",
    id: typeof node.id === "string" ? node.id : "",
    axis: node.axis === "horizontal" ? "horizontal" : "vertical",
    ratio: typeof node.ratio === "number" ? node.ratio : 0.5,
    first: serializePaneLayoutNode(node.first),
    second: serializePaneLayoutNode(node.second),
  };
};

const serializeFilePreviewValue = (value: unknown) => {
  const preview = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    path: typeof preview.path === "string" ? preview.path : "",
    content: typeof preview.content === "string" ? preview.content : "",
    mode: preview.mode === "diff" ? "diff" : "preview",
    diff: typeof preview.diff === "string" ? preview.diff : "",
    originalContent: typeof preview.originalContent === "string" ? preview.originalContent : "",
    modifiedContent: typeof preview.modifiedContent === "string" ? preview.modifiedContent : "",
    dirty: Boolean(preview.dirty),
    source: preview.source === "git" ? "git" : undefined,
    statusLabel: typeof preview.statusLabel === "string" ? preview.statusLabel : undefined,
    parentPath: typeof preview.parentPath === "string" ? preview.parentPath : undefined,
    section: typeof preview.section === "string" ? preview.section : undefined,
  };
};

const canonicalizeWorkspaceViewPatch = (patch: WorkspaceViewPatch) => ({
  active_session_id: patch.active_session_id,
  active_pane_id: patch.active_pane_id,
  active_terminal_id: patch.active_terminal_id,
  pane_layout: serializePaneLayoutNode(patch.pane_layout),
  file_preview: serializeFilePreviewValue(patch.file_preview),
});

export const createWorkspaceViewPatchFromTab = (
  tab: WorkspaceViewTab,
): WorkspaceViewPatch => ({
  active_session_id: tab.activeSessionId,
  active_pane_id: tab.activePaneId,
  active_terminal_id: tab.activeTerminalId,
  pane_layout: tab.paneLayout,
  file_preview: tab.filePreview,
});

export const serializeWorkspaceViewPatch = (patch: WorkspaceViewPatch) => JSON.stringify(
  canonicalizeWorkspaceViewPatch(patch),
);

const serializeWorkspaceViewTab = (tab: WorkspaceViewTab) => serializeWorkspaceViewPatch(
  createWorkspaceViewPatchFromTab(tab),
);

const rememberWorkspaceViewSerializedBaseline = (workspaceId: string, serialized: string) => {
  persistedWorkspaceViews.set(workspaceId, serialized);
};

const pruneRecentWorkspaceViewRequests = (workspaceId: string, now = Date.now()) => {
  const entries = recentWorkspaceViewRequests.get(workspaceId);
  if (!entries?.length) {
    recentWorkspaceViewRequests.delete(workspaceId);
    return [];
  }

  const next = entries.filter((entry) => now - entry.at <= RECENT_WORKSPACE_VIEW_REQUEST_TTL_MS);
  if (next.length === 0) {
    recentWorkspaceViewRequests.delete(workspaceId);
    return [];
  }
  recentWorkspaceViewRequests.set(workspaceId, next);
  return next;
};

export const noteWorkspaceViewPersistRequest = (
  workspaceId: string,
  patch: WorkspaceViewPatch,
) => {
  const now = Date.now();
  const entries = pruneRecentWorkspaceViewRequests(workspaceId, now);
  entries.push({ serialized: serializeWorkspaceViewPatch(patch), at: now });
  recentWorkspaceViewRequests.set(
    workspaceId,
    entries.slice(-RECENT_WORKSPACE_VIEW_REQUEST_LIMIT),
  );
};

export const shouldIgnoreIncomingWorkspaceViewPatch = (
  tab: WorkspaceViewTab,
  patch: WorkspaceViewPatch,
) => {
  const currentSerialized = serializeWorkspaceViewTab(tab);
  const incomingSerialized = serializeWorkspaceViewPatch(patch);
  if (incomingSerialized === currentSerialized) {
    return false;
  }

  const recentEntries = pruneRecentWorkspaceViewRequests(tab.id);
  if (recentEntries.length === 0) {
    return false;
  }

  const recentSerializations = new Set(recentEntries.map((entry) => entry.serialized));
  return recentSerializations.has(currentSerialized) && recentSerializations.has(incomingSerialized);
};

export const rememberWorkspaceViewBaseline = (tab: WorkspaceViewTab) => {
  rememberWorkspaceViewSerializedBaseline(tab.id, serializeWorkspaceViewTab(tab));
};

export const rememberWorkspaceViewPatchBaseline = (
  workspaceId: string,
  patch: WorkspaceViewPatch,
) => {
  rememberWorkspaceViewSerializedBaseline(workspaceId, serializeWorkspaceViewPatch(patch));
};

export const rememberWorkspaceViewBaselines = (tabs: WorkspaceViewTab[]) => {
  tabs.forEach((tab) => {
    rememberWorkspaceViewBaseline(tab);
  });
};

export const shouldPersistWorkspaceView = (tab: WorkspaceViewTab) => (
  persistedWorkspaceViews.get(tab.id) !== serializeWorkspaceViewTab(tab)
);

export const forgetWorkspaceViewBaseline = (workspaceId: string) => {
  persistedWorkspaceViews.delete(workspaceId);
  recentWorkspaceViewRequests.delete(workspaceId);
};

export const pruneWorkspaceViewBaselines = (workspaceIds: ReadonlySet<string>) => {
  Array.from(persistedWorkspaceViews.keys()).forEach((workspaceId) => {
    if (!workspaceIds.has(workspaceId)) {
      persistedWorkspaceViews.delete(workspaceId);
    }
  });
};

export const resetWorkspaceViewBaselines = () => {
  persistedWorkspaceViews.clear();
  recentWorkspaceViewRequests.clear();
};

export type WorkspaceViewPersistScheduler<TController> = {
  schedule: (workspaceId: string, patch: WorkspaceViewPatch, controller: TController) => void;
  cancel: (workspaceId: string) => void;
  prune: (workspaceIds: ReadonlySet<string>) => void;
  flush: (workspaceId?: string) => void;
  dispose: () => void;
};

export const createWorkspaceViewPersistScheduler = <TController>(
  persist: (workspaceId: string, patch: WorkspaceViewPatch, controller: TController) => void,
  scheduleTimeout: ScheduleTimeout,
  cancelTimeout: CancelTimeout,
  delayMs = WORKSPACE_VIEW_PERSIST_DEBOUNCE_MS,
): WorkspaceViewPersistScheduler<TController> => {
  const pending = new Map<string, {
    handle: unknown;
    patch: WorkspaceViewPatch;
    controller: TController;
  }>();

  const clearPending = (workspaceId: string) => {
    const entry = pending.get(workspaceId);
    if (!entry) return null;
    cancelTimeout(entry.handle);
    pending.delete(workspaceId);
    return entry;
  };

  const flushWorkspace = (workspaceId: string) => {
    const entry = clearPending(workspaceId);
    if (!entry) return;
    persist(workspaceId, entry.patch, entry.controller);
  };

  return {
    schedule(workspaceId, patch, controller) {
      clearPending(workspaceId);
      const handle = scheduleTimeout(() => {
        pending.delete(workspaceId);
        persist(workspaceId, patch, controller);
      }, delayMs);
      pending.set(workspaceId, { handle, patch, controller });
    },
    cancel(workspaceId) {
      clearPending(workspaceId);
    },
    prune(workspaceIds) {
      Array.from(pending.keys()).forEach((workspaceId) => {
        if (!workspaceIds.has(workspaceId)) {
          clearPending(workspaceId);
        }
      });
    },
    flush(workspaceId) {
      if (typeof workspaceId === "string") {
        flushWorkspace(workspaceId);
        return;
      }
      Array.from(pending.keys()).forEach((pendingWorkspaceId) => {
        flushWorkspace(pendingWorkspaceId);
      });
    },
    dispose() {
      Array.from(pending.keys()).forEach((workspaceId) => {
        clearPending(workspaceId);
      });
    },
  };
};
