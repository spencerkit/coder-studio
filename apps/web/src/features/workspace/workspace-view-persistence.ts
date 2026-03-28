import type { Tab } from "../../state/workbench-core.ts";
import type { WorkspaceViewPatch } from "../../types/app.ts";

type WorkspaceViewTab = Pick<
  Tab,
  "id" | "activeSessionId" | "activePaneId" | "activeTerminalId" | "paneLayout" | "filePreview"
>;

const persistedWorkspaceViews = new Map<string, string>();

export const createWorkspaceViewPatchFromTab = (
  tab: WorkspaceViewTab,
): WorkspaceViewPatch => ({
  active_session_id: tab.activeSessionId,
  active_pane_id: tab.activePaneId,
  active_terminal_id: tab.activeTerminalId,
  pane_layout: tab.paneLayout,
  file_preview: tab.filePreview,
});

export const serializeWorkspaceViewPatch = (patch: WorkspaceViewPatch) => JSON.stringify(patch);

const serializeWorkspaceViewTab = (tab: WorkspaceViewTab) => serializeWorkspaceViewPatch(
  createWorkspaceViewPatchFromTab(tab),
);

export const rememberWorkspaceViewBaseline = (tab: WorkspaceViewTab) => {
  persistedWorkspaceViews.set(tab.id, serializeWorkspaceViewTab(tab));
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
};
