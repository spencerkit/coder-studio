import type { Workspace } from "@coder-studio/core";
import type { Store } from "jotai/vanilla/store";
import {
  activeEditorTabAtomFamily,
  activeFilePathAtomFamily,
  editorViewVisibleAtomFamily,
  openEditorPathsAtomFamily,
  openEditorTabsAtomFamily,
  type WorkspaceBrowserEditorTab,
  type WorkspaceEditorTab,
  type WorkspaceFileEditorTab,
} from "../atoms";

const LEGACY_BROWSER_TAB_ID = "dev-browser-legacy";
const MAX_BROWSER_VIEWPORT_DIMENSION = 4096;

function normalizeViewportDimension(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_BROWSER_VIEWPORT_DIMENSION
    ? value
    : null;
}

function normalizeBrowserDevicePreset(value: unknown): WorkspaceBrowserEditorTab["devicePreset"] {
  return value === "desktop" || value === "iphone-14" || value === "pixel-7" || value === "custom"
    ? value
    : "desktop";
}

function normalizeBrowserOrientation(value: unknown): WorkspaceBrowserEditorTab["orientation"] {
  return value === "portrait" || value === "landscape" ? value : "portrait";
}

function normalizeBrowserUserAgentMode(value: unknown): WorkspaceBrowserEditorTab["userAgentMode"] {
  return value === "desktop" || value === "mobile" ? value : "desktop";
}

function readLegacyDevBrowserTargetUrl(uiState: object): string | null {
  const candidate = (uiState as { devBrowserTargetUrl?: unknown }).devBrowserTargetUrl;
  if (typeof candidate !== "string") {
    return null;
  }

  const next = candidate.trim();
  return next.length > 0 ? next : null;
}

function normalizeWorkspaceBrowserEditorTab(
  entry: unknown,
  legacyUrl: string | null
): WorkspaceBrowserEditorTab | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = entry as Partial<WorkspaceBrowserEditorTab>;
  if (candidate.kind !== "browser") {
    return null;
  }

  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
    return null;
  }

  const id = candidate.id.trim();
  const normalizedUrl =
    typeof candidate.url === "string" && candidate.url.trim().length > 0
      ? candidate.url.trim()
      : null;
  const deviceSettings = {
    devicePreset: normalizeBrowserDevicePreset(candidate.devicePreset),
    viewportWidth: normalizeViewportDimension(candidate.viewportWidth),
    viewportHeight: normalizeViewportDimension(candidate.viewportHeight),
    orientation: normalizeBrowserOrientation(candidate.orientation),
    userAgentMode: normalizeBrowserUserAgentMode(candidate.userAgentMode),
  };

  if (id === "dev-browser") {
    return {
      kind: "browser",
      id: LEGACY_BROWSER_TAB_ID,
      url: normalizedUrl ?? legacyUrl,
      ...deviceSettings,
    };
  }

  return {
    kind: "browser",
    id,
    url: normalizedUrl,
    ...deviceSettings,
  };
}

function normalizeWorkspaceFileEditorTab(entry: unknown): WorkspaceFileEditorTab | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = entry as Partial<WorkspaceFileEditorTab>;
  if (candidate.kind !== "file") {
    return null;
  }

  if (typeof candidate.path !== "string" || candidate.path.trim().length === 0) {
    return null;
  }

  return {
    kind: "file",
    path: candidate.path.trim(),
  };
}

function normalizeWorkspaceEditorTab(
  entry: unknown,
  legacyUrl: string | null
): WorkspaceEditorTab | null {
  return (
    normalizeWorkspaceBrowserEditorTab(entry, legacyUrl) ?? normalizeWorkspaceFileEditorTab(entry)
  );
}

function normalizeWorkspaceEditorTabs(
  value: unknown,
  legacyUrl: string | null
): WorkspaceEditorTab[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenFilePaths = new Set<string>();
  const seenBrowserIds = new Set<string>();
  const next: WorkspaceEditorTab[] = [];

  for (const entry of value) {
    const normalizedTab = normalizeWorkspaceEditorTab(entry, legacyUrl);
    if (!normalizedTab) {
      continue;
    }

    if (normalizedTab.kind === "browser") {
      if (seenBrowserIds.has(normalizedTab.id)) {
        continue;
      }

      seenBrowserIds.add(normalizedTab.id);
      next.push(normalizedTab);
      continue;
    }

    if (seenFilePaths.has(normalizedTab.path)) {
      continue;
    }

    seenFilePaths.add(normalizedTab.path);
    next.push(normalizedTab);
  }

  return next;
}

function appendMissingActiveBrowserTab(
  openEditorTabs: WorkspaceEditorTab[],
  activeEditorTab: WorkspaceEditorTab | null
): WorkspaceEditorTab[] {
  if (activeEditorTab?.kind !== "browser") {
    return openEditorTabs;
  }

  if (openEditorTabs.some((tab) => tab.kind === "browser" && tab.id === activeEditorTab.id)) {
    return openEditorTabs;
  }

  return [...openEditorTabs, activeEditorTab];
}

function hasOwnProperty<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function normalizeOpenEditorPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const next: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0 || seen.has(entry)) {
      continue;
    }

    seen.add(entry);
    next.push(entry);
  }

  return next;
}

export function normalizeActiveEditorPath(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value;
}

export function normalizeActiveEditorTab(value: unknown): WorkspaceEditorTab | null {
  return normalizeWorkspaceEditorTab(value, null);
}

export function mergeOpenEditorPaths(...pathLists: Array<Iterable<string> | undefined>): string[] {
  return normalizeOpenEditorPaths(pathLists.flatMap((paths) => (paths ? Array.from(paths) : [])));
}

export function appendOpenEditorPath(paths: Iterable<string>, path: string): string[] {
  return mergeOpenEditorPaths(paths, [path]);
}

export function removeOpenEditorPaths(
  paths: Iterable<string>,
  removedPaths: Iterable<string>
): string[] {
  const removed = new Set(removedPaths);
  return normalizeOpenEditorPaths(Array.from(paths)).filter((path) => !removed.has(path));
}

export function rewriteDescendantEditorPath(
  path: string,
  fromPath: string,
  toPath: string
): string {
  if (path === fromPath) {
    return toPath;
  }

  if (path.startsWith(`${fromPath}/`)) {
    return `${toPath}${path.slice(fromPath.length)}`;
  }

  return path;
}

export function rewriteOpenEditorPaths(
  paths: Iterable<string>,
  fromPath: string,
  toPath: string
): string[] {
  return normalizeOpenEditorPaths(
    Array.from(paths).map((path) => rewriteDescendantEditorPath(path, fromPath, toPath))
  );
}

export function normalizeWorkspaceEditorUiStatePatch(
  uiState: Partial<
    Pick<
      Workspace["uiState"],
      | "openEditorPaths"
      | "activeEditorPath"
      | "editorViewVisible"
      | "openEditorTabs"
      | "activeEditorTab"
      | "devBrowserTargetUrl"
    >
  >
): {
  openEditorPaths?: string[];
  activeEditorPath?: string | null;
  editorViewVisible?: boolean;
  openEditorTabs?: WorkspaceEditorTab[];
  activeEditorTab?: WorkspaceEditorTab | null;
} | null {
  const hasOpenEditorPaths = hasOwnProperty(uiState, "openEditorPaths");
  const hasActiveEditorPath = hasOwnProperty(uiState, "activeEditorPath");
  const hasEditorViewVisible = hasOwnProperty(uiState, "editorViewVisible");
  const hasOpenEditorTabs = hasOwnProperty(uiState, "openEditorTabs");
  const hasActiveEditorTab = hasOwnProperty(uiState, "activeEditorTab");
  const legacyBrowserTargetUrl = readLegacyDevBrowserTargetUrl(uiState);

  if (
    !hasOpenEditorPaths &&
    !hasActiveEditorPath &&
    !hasEditorViewVisible &&
    !hasOpenEditorTabs &&
    !hasActiveEditorTab
  ) {
    return null;
  }

  const next: {
    openEditorPaths?: string[];
    activeEditorPath?: string | null;
    editorViewVisible?: boolean;
    openEditorTabs?: WorkspaceEditorTab[];
    activeEditorTab?: WorkspaceEditorTab | null;
  } = {};

  if (hasOpenEditorPaths) {
    const openEditorPaths = normalizeOpenEditorPaths(uiState.openEditorPaths);
    next.openEditorPaths = openEditorPaths;

    if (hasActiveEditorPath) {
      const activeEditorPath = normalizeActiveEditorPath(uiState.activeEditorPath);
      next.activeEditorPath = activeEditorPath;

      if (activeEditorPath && !openEditorPaths.includes(activeEditorPath)) {
        next.openEditorPaths = [...openEditorPaths, activeEditorPath];
      }
    }
  } else if (hasActiveEditorPath) {
    next.activeEditorPath = normalizeActiveEditorPath(uiState.activeEditorPath);
  }

  if (hasEditorViewVisible) {
    next.editorViewVisible = uiState.editorViewVisible === true;
  }

  if (hasOpenEditorTabs) {
    const openEditorTabs = normalizeWorkspaceEditorTabs(
      uiState.openEditorTabs,
      legacyBrowserTargetUrl
    );
    next.openEditorTabs = openEditorTabs;

    if (hasActiveEditorTab) {
      const activeEditorTab = normalizeWorkspaceEditorTab(
        uiState.activeEditorTab,
        legacyBrowserTargetUrl
      );
      next.activeEditorTab = activeEditorTab;
      if (activeEditorTab?.kind === "browser") {
        next.openEditorTabs = appendMissingActiveBrowserTab(openEditorTabs, activeEditorTab);
      }
    }
  } else if (hasActiveEditorTab) {
    const activeEditorTab = normalizeWorkspaceEditorTab(
      uiState.activeEditorTab,
      legacyBrowserTargetUrl
    );
    next.activeEditorTab = activeEditorTab;
    if (activeEditorTab?.kind === "browser") {
      next.openEditorTabs = appendMissingActiveBrowserTab([], activeEditorTab);
    }
  }

  return next;
}

export function normalizeWorkspaceEditorUiState(
  uiState: Workspace["uiState"]
): Workspace["uiState"] {
  const hasLegacyBrowserTargetUrl = hasOwnProperty(uiState, "devBrowserTargetUrl");
  const normalizedPatch = normalizeWorkspaceEditorUiStatePatch(uiState);
  if (!normalizedPatch) {
    if (!hasLegacyBrowserTargetUrl) {
      return uiState;
    }

    const { devBrowserTargetUrl: _legacyBrowserTargetUrl, ...restUiState } =
      uiState as Workspace["uiState"] & { devBrowserTargetUrl?: string | null };
    return restUiState;
  }

  const { devBrowserTargetUrl: _legacyBrowserTargetUrl, ...restUiState } =
    uiState as Workspace["uiState"] & { devBrowserTargetUrl?: string | null };

  return {
    ...restUiState,
    ...(hasOwnProperty(normalizedPatch, "openEditorPaths")
      ? { openEditorPaths: normalizedPatch.openEditorPaths }
      : {}),
    ...(hasOwnProperty(normalizedPatch, "activeEditorPath")
      ? { activeEditorPath: normalizedPatch.activeEditorPath }
      : {}),
    ...(hasOwnProperty(normalizedPatch, "editorViewVisible")
      ? { editorViewVisible: normalizedPatch.editorViewVisible }
      : {}),
    ...(hasOwnProperty(normalizedPatch, "openEditorTabs")
      ? { openEditorTabs: normalizedPatch.openEditorTabs }
      : {}),
    ...(hasOwnProperty(normalizedPatch, "activeEditorTab")
      ? { activeEditorTab: normalizedPatch.activeEditorTab }
      : {}),
  };
}

export function hydrateWorkspaceEditorState(
  store: Store,
  workspaceId: string,
  uiState?: Partial<Workspace["uiState"]> | null
): void {
  if (!uiState) {
    return;
  }

  const hasOpenEditorPaths = hasOwnProperty(uiState, "openEditorPaths");
  const hasActiveEditorPath = hasOwnProperty(uiState, "activeEditorPath");
  const hasEditorViewVisible = hasOwnProperty(uiState, "editorViewVisible");
  const hasOpenEditorTabs = hasOwnProperty(uiState, "openEditorTabs");
  const hasActiveEditorTab = hasOwnProperty(uiState, "activeEditorTab");
  if (
    !hasOpenEditorPaths &&
    !hasActiveEditorPath &&
    !hasEditorViewVisible &&
    !hasOpenEditorTabs &&
    !hasActiveEditorTab
  ) {
    return;
  }

  const normalizedPatch = normalizeWorkspaceEditorUiStatePatch(uiState);
  if (!normalizedPatch) {
    return;
  }

  if (hasOpenEditorPaths) {
    store.set(openEditorPathsAtomFamily(workspaceId), normalizedPatch.openEditorPaths ?? []);
  }

  if (hasActiveEditorPath) {
    store.set(activeFilePathAtomFamily(workspaceId), normalizedPatch.activeEditorPath ?? null);
  }

  if (hasEditorViewVisible) {
    store.set(editorViewVisibleAtomFamily(workspaceId), normalizedPatch.editorViewVisible === true);
  }

  if (hasOpenEditorTabs) {
    store.set(openEditorTabsAtomFamily(workspaceId), normalizedPatch.openEditorTabs ?? []);
  }

  if (hasActiveEditorTab) {
    store.set(activeEditorTabAtomFamily(workspaceId), normalizedPatch.activeEditorTab ?? null);
  }
}
