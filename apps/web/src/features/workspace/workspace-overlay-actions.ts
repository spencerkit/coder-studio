import type { Dispatch, SetStateAction } from "react";
import type { Locale, Translator } from "../../i18n";
import type { ExecTarget, WorkbenchState } from "../../state/workbench";
import { listFilesystem } from "../../services/http/system.service";
import { looksLikeWindowsPath } from "../../shared/utils/path";
import type { FilesystemListResponse, FolderBrowserState } from "../../types/app";

export const selectWorkspaceOverlayMode = (
  current: WorkbenchState,
  mode: WorkbenchState["overlay"]["mode"],
): WorkbenchState => ({
  ...current,
  overlay: { ...current.overlay, mode, input: "" },
});

export const updateWorkspaceOverlayInput = (
  current: WorkbenchState,
  input: string,
): WorkbenchState => ({
  ...current,
  overlay: { ...current.overlay, input },
});

export const updateWorkspaceOverlayTarget = (
  current: WorkbenchState,
  target: ExecTarget,
): WorkbenchState => ({
  ...current,
  overlay: { ...current.overlay, target },
});

export const hideWorkspaceOverlay = (current: WorkbenchState): WorkbenchState => ({
  ...current,
  overlay: { ...current.overlay, visible: false },
});

type BrowseWorkspaceOverlayDirectoryArgs = {
  target: ExecTarget;
  path?: string;
  selectCurrent?: boolean;
  locale: Locale;
  t: Translator;
  setFolderBrowser: Dispatch<SetStateAction<FolderBrowserState>>;
  setOverlayCanUseWsl: Dispatch<SetStateAction<boolean>>;
  updateOverlayInput: (value: string) => void;
  shouldApplyResult?: () => boolean;
  listFilesystemImpl?: (target: ExecTarget, path?: string) => Promise<FilesystemListResponse>;
};

export const browseWorkspaceOverlayDirectory = async ({
  target,
  path,
  selectCurrent = false,
  locale,
  t,
  setFolderBrowser,
  setOverlayCanUseWsl,
  updateOverlayInput,
  shouldApplyResult,
  listFilesystemImpl = listFilesystem,
}: BrowseWorkspaceOverlayDirectoryArgs) => {
  setFolderBrowser((current) => ({
    ...current,
    loading: true,
    error: undefined,
    notice: undefined,
  }));

  try {
    const listing = await listFilesystemImpl(target, path);
    if (shouldApplyResult && !shouldApplyResult()) {
      return;
    }

    const recoveredPath = Boolean(path && listing.fallback_reason);
    if (target.type === "native") {
      setOverlayCanUseWsl(listing.roots.some((root) => looksLikeWindowsPath(root.path)));
    }

    setFolderBrowser({
      loading: false,
      currentPath: listing.current_path,
      homePath: listing.home_path,
      parentPath: listing.parent_path ?? undefined,
      roots: listing.roots,
      entries: listing.entries,
      notice: recoveredPath ? t("folderBrowserRecovered") : undefined,
    });

    if (selectCurrent || recoveredPath) {
      updateOverlayInput(listing.current_path);
    }
  } catch (error) {
    if (shouldApplyResult && !shouldApplyResult()) {
      return;
    }

    const reason = error instanceof Error ? error.message : String(error);
    setFolderBrowser((current) => ({
      ...current,
      loading: false,
      currentPath: "",
      parentPath: undefined,
      entries: [],
      error: locale === "zh"
        ? `无法读取服务器目录${reason ? `：${reason}` : ""}`
        : `Unable to read server directories${reason ? `: ${reason}` : ""}`,
    }));
  }
};
