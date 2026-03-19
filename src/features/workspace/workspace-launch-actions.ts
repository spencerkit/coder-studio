import { formatTerminalTitle, type Locale } from "../../i18n";
import type { TreeNode, WorkbenchState } from "../../state/workbench";
import { createEmptyPreview, type Tab } from "../../state/workbench";
import { createTerminal as createTerminalRequest } from "../../services/http/terminal.service";
import { initWorkspace as initWorkspaceRequest } from "../../services/http/workspace.service";
import { displayPathName } from "../../shared/utils/path";
import { flattenTree } from "../../shared/utils/tree";
import type { WorkspaceInfo, WorkspaceTree } from "../../types/app";

type UpdateTab = (tabId: string, updater: (tab: Tab) => Tab) => void;
type UpdateState = (updater: (current: WorkbenchState) => WorkbenchState) => void;
type WithServiceFallback = <T>(operation: () => Promise<T>, fallback: T) => Promise<T>;

type StartWorkspaceLaunchArgs = {
  overlay: WorkbenchState["overlay"];
  locale: Locale;
  updateTab: UpdateTab;
  updateState: UpdateState;
  withServiceFallback: WithServiceFallback;
  refreshTabFromBackend: (tabId: string) => Promise<void>;
  refreshWorkspaceArtifacts: (tabId: string) => Promise<WorkspaceTree | null>;
  onSelectInitialFile: (node: TreeNode) => Promise<void>;
};

export const startWorkspaceLaunch = async ({
  overlay,
  locale,
  updateTab,
  updateState,
  withServiceFallback,
  refreshTabFromBackend,
  refreshWorkspaceArtifacts,
  onSelectInitialFile,
}: StartWorkspaceLaunchArgs) => {
  if (!overlay.tabId) return;
  const input = overlay.input.trim();
  if (!input) return;

  const tabId = overlay.tabId;
  const source = {
    tabId,
    kind: overlay.mode,
    pathOrUrl: input,
    target: overlay.target,
  };
  const info = await withServiceFallback<WorkspaceInfo>(() => initWorkspaceRequest(source), {
    tab_id: tabId,
    project_path: input,
    target: overlay.target,
  });
  const workspacePath = info.project_path ?? input;

  const terminalInfo = await withServiceFallback<{ id: number; output: string }>(
    () => createTerminalRequest(tabId, workspacePath, overlay.target),
    { id: Date.now(), output: "" },
  );

  updateTab(tabId, (tab) => ({
    ...tab,
    title: displayPathName(workspacePath) || tab.title,
    status: "ready",
    project: {
      kind: overlay.mode,
      path: workspacePath,
      gitUrl: overlay.mode === "remote" ? input : undefined,
      target: overlay.target,
    },
    terminals: [{
      id: `term-${terminalInfo.id}`,
      title: formatTerminalTitle(1, locale),
      output: terminalInfo.output ?? "",
    }],
    activeTerminalId: `term-${terminalInfo.id}`,
    gitChanges: [],
    fileTree: [],
    changesTree: [],
    filePreview: createEmptyPreview(),
  }));

  updateState((current) => ({
    ...current,
    overlay: { ...current.overlay, visible: false },
  }));

  await refreshTabFromBackend(tabId);
  const workspaceTree = await refreshWorkspaceArtifacts(tabId);
  const firstFile = flattenTree(workspaceTree?.root.children ?? []).find((node) => node.kind === "file");
  if (firstFile) {
    await onSelectInitialFile(firstFile);
  }
};
