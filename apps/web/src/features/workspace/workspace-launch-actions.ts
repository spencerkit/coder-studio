import type { Locale } from "../../i18n";
import type { TreeNode, WorkbenchState } from "../../state/workbench";
import { launchWorkspace as launchWorkspaceRequest } from "../../services/http/workspace.service";
import { flattenTree } from "../../shared/utils/tree";
import { upsertWorkspaceSnapshot } from "../../shared/utils/workspace";
import type { AppSettings, WorkspaceLaunchResult, WorkspaceTree } from "../../types/app";

type UpdateState = (updater: (current: WorkbenchState) => WorkbenchState) => void;
type WithServiceFallback = <T>(operation: () => Promise<T>, fallback: T) => Promise<T>;

type StartWorkspaceLaunchArgs = {
  overlay: WorkbenchState["overlay"];
  locale: Locale;
  appSettings: AppSettings;
  deviceId: string;
  clientId: string;
  updateState: UpdateState;
  withServiceFallback: WithServiceFallback;
  refreshWorkspaceArtifacts: (workspaceId: string) => Promise<WorkspaceTree | null>;
};

export type StartWorkspaceLaunchOutput = {
  workspaceId: string;
  created: boolean;
  alreadyOpen: boolean;
  firstFile?: TreeNode;
};

export const startWorkspaceLaunch = async ({
  overlay,
  locale,
  appSettings,
  deviceId,
  clientId,
  updateState,
  withServiceFallback,
  refreshWorkspaceArtifacts,
}: StartWorkspaceLaunchArgs): Promise<StartWorkspaceLaunchOutput | null> => {
  const input = overlay.input.trim();
  if (!input) return null;

  const result = await withServiceFallback<WorkspaceLaunchResult | null>(
    () => launchWorkspaceRequest({
      kind: overlay.mode,
      pathOrUrl: input,
      target: overlay.target,
    }, deviceId, clientId),
    null,
  );
  if (!result) return null;

  updateState((current) => upsertWorkspaceSnapshot(
    current,
    result.snapshot,
    locale,
    appSettings,
    result.ui_state,
  ));

  const workspaceId = result.snapshot.workspace.workspace_id;
  const workspaceTree = await refreshWorkspaceArtifacts(workspaceId);
  const shouldSelectInitialFile = result.created && !result.snapshot.view_state.file_preview.path;
  const firstFile = shouldSelectInitialFile
    ? flattenTree(workspaceTree?.root.children ?? []).find((node) => node.kind === "file")
    : undefined;

  return {
    workspaceId,
    created: result.created,
    alreadyOpen: result.already_open,
    firstFile,
  };
};
