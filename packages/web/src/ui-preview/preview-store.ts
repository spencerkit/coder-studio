import type {
  AgentSkillTargetEntry,
  FileNode,
  GitBranch,
  GitCommitDetail,
  GitCommitSummary,
  GitFileDiffPayload,
  GitStatus,
  MonitoringResponse,
  ProviderListItem,
  ProviderRuntimeStatusResponse,
  SearchSessionApplyResult,
  SearchSessionFilePreview,
  SearchSessionStartResult,
  Session,
  SkillInstallJobSnapshot,
  SkillLibraryEntry,
  SkillMountRelation,
  SkillRecommendationPage,
  SkillVersionCheckEntry,
  Supervisor,
  UpdateStateView,
  Workspace,
  WorkspaceHistoryEntry,
  WorktreeInfo,
} from "@coder-studio/core";
import { createStore, type Store } from "jotai";
import {
  applyAppearancePersonalizationToDocument,
  applyResolvedTheme,
  resolveAppearancePersonalizationSetting,
} from "../appearance";
import {
  appearancePersonalizationAtom,
  authenticatedAtom,
  commandPaletteOpenAtom,
  localeAtom,
  themeAtom,
} from "../atoms/app-ui";
import {
  authEnabledAtom,
  connectionStatusAtom,
  type DispatchCommand,
  wsClientAtom,
} from "../atoms/connection";
import { providerListAtom, providerRuntimeStatusAtom } from "../atoms/providers";
import { sessionsAtom } from "../atoms/sessions";
import {
  activeWorkspaceIdAtom,
  type WorkspaceLoadState,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../atoms/workspaces";
import {
  activeEditorPaneIdAtomFamily,
  editorPaneActiveFilePathAtomFamily,
  focusedEditorPaneIdAtomFamily,
  getEditorPaneStateKey,
} from "../features/agent-panes/atoms/editor-panes";
import { type PaneNode, paneLayoutAtomFamily } from "../features/agent-panes/atoms/pane-layout";
import { type Toast, toastsAtom } from "../features/notifications";
import { supervisorDialogAtom, supervisorsAtom } from "../features/supervisor/atoms";
import {
  terminalActiveIdAtomFamily,
  terminalIdsAtomFamily,
  terminalMetaAtomFamily,
} from "../features/terminal-panel/atoms";
import { updateStateAtom } from "../features/updates/atoms";
import {
  activeFilePathAtomFamily,
  branchQuickPickAtom,
  fileTreeAtomFamily,
  gitBranchListAtomFamily,
  gitDiffPreviewAtomFamily,
  gitStateAtomFamily,
  type OpenFile,
  openFilesAtomFamily,
  terminalPanelVisibleAtom,
  workspaceLayoutStateAtomFamily,
  worktreeListAtomFamily,
} from "../features/workspace/atoms";
import { resolveStoredThemeId } from "../theme";

export type UiPreviewTheme = string;
export type UiPreviewLocale = "zh" | "en";
export type UiPreviewDevice = "desktop" | "mobile";

export interface UiPreviewCommands {
  providerList?: ProviderListItem[];
  providerRuntimeStatus?: ProviderRuntimeStatusResponse["providers"];
  settingsGet?: Record<string, unknown>;
  settingsUpdate?: Record<string, unknown>;
  settingsPreviewCommandByProviderId?: Record<string, string>;
  monitoringGet?: MonitoringResponse;
  monitoringRecheck?: MonitoringResponse;
  workspaceHistoryList?: WorkspaceHistoryEntry[];
  workspaceBrowse?: {
    currentPath: string;
    parentPath: string | null;
    directories: Array<{ name: string; path: string; itemCount?: number }>;
    rootPaths?: string[];
  };
  workspaceWslBrowse?: {
    currentPath: string;
    parentPath: string | null;
    directories: Array<{ name: string; path: string; itemCount?: number }>;
    rootPaths?: string[];
  };
  workspaceWslDistros?: string[];
  workspaceOpen?: Workspace;
  workspaceUiStateSet?: Workspace;
  workspaceList?: Workspace[];
  sessionListByWorkspaceId?: Record<string, Session[]>;
  gitStatusByWorkspaceId?: Record<string, GitStatus>;
  gitBranchesByWorkspaceId?: Record<string, { current: string; branches: GitBranch[] }>;
  gitLogByWorkspaceId?: Record<string, { entries: GitCommitSummary[] }>;
  gitDiffByWorkspaceId?: Record<string, GitFileDiffPayload>;
  gitCommitDetailByWorkspaceId?: Record<string, GitCommitDetail>;
  gitCommitFileDiffByWorkspaceId?: Record<string, GitFileDiffPayload>;
  fileTreeByWorkspaceId?: Record<string, Record<string, FileNode[]>>;
  fileBrowseByWorkspaceId?: Record<
    string,
    {
      currentPath: string;
      parentPath: string | null;
      directories: Array<{ name: string; path: string; itemCount?: number }>;
      rootPaths?: string[];
    }
  >;
  fileSearchByWorkspaceId?: Record<string, FileNode[]>;
  fileSearchSessionByWorkspaceId?: Record<string, SearchSessionStartResult>;
  fileSearchPreviewByWorkspaceId?: Record<string, Record<string, SearchSessionFilePreview>>;
  fileSearchApplyByWorkspaceId?: Record<string, SearchSessionApplyResult>;
  fileReadByWorkspaceId?: Record<string, Record<string, { content: string; baseHash?: string }>>;
  worktreeListByWorkspaceId?: Record<string, WorktreeInfo[]>;
  worktreeStatusByPath?: Record<string, GitStatus>;
  worktreeDiffByPath?: Record<string, string>;
  worktreeTreeByPath?: Record<string, FileNode[]>;
  skillsLibraryList?: Array<
    SkillLibraryEntry & {
      mountedProviderIds: string[];
      mountStatus: "unmounted" | "partially_mounted" | "fully_mounted" | "error";
      errorCount: number;
    }
  >;
  skillsHealthScan?: {
    targets: Array<AgentSkillTargetEntry & { mountedSkillCount: number }>;
    mounts: SkillMountRelation[];
  };
  skillsRecommendations?: SkillRecommendationPage;
  skillsSearchResultsByQuery?: Record<
    string,
    Array<{
      slug: string;
      displayName: string;
      description?: string;
      version?: string;
      installed: boolean;
      installedVersion?: string;
      mountedProviderIds: string[];
    }>
  >;
  skillsInfoBySlug?: Record<
    string,
    {
      slug: string;
      displayName: string;
      description?: string;
      version?: string;
      installed: boolean;
      libraryEntry?: SkillLibraryEntry;
      mounts: SkillMountRelation[];
    }
  >;
  skillsLocalFileEntriesBySlug?: Record<
    string,
    Array<{
      path: string;
      kind: "file" | "dir";
      content?: string;
    }>
  >;
  skillsVersionChecks?: SkillVersionCheckEntry[];
  terminalListByWorkspaceId?: Record<
    string,
    Array<{
      id: string;
      workspaceId: string;
      kind: "shell";
      title: string;
      cwd: string;
      argv: string[];
      cols: number;
      rows: number;
      alive: boolean;
      createdAt: number;
    }>
  >;
  supervisorBySessionId?: Record<string, Supervisor>;
}

export interface UiPreviewSeed {
  theme: UiPreviewTheme;
  locale: UiPreviewLocale;
  device: UiPreviewDevice;
  authEnabled?: boolean | null;
  authenticated?: boolean;
  connectionStatus?: "connecting" | "connected" | "disconnected" | "reconnecting" | "rejected";
  workspaces?: Workspace[];
  activeWorkspaceId?: string | null;
  workspacesLoadState?: WorkspaceLoadState;
  workspacesLoadError?: string | null;
  sessions?: Session[];
  providerList?: ProviderListItem[];
  providerRuntimeStatus?: ProviderRuntimeStatusResponse["providers"];
  paneLayoutByWorkspaceId?: Record<string, PaneNode>;
  activeEditorPaneIdByWorkspaceId?: Record<string, string | null>;
  focusedEditorPaneIdByWorkspaceId?: Record<string, string | null>;
  activeFilePathByEditorPaneId?: Record<string, Record<string, string | null>>;
  fileTreeByWorkspaceId?: Record<string, Map<string, FileNode[]>>;
  openFilesByWorkspaceId?: Record<string, Record<string, OpenFile>>;
  activeFilePathByWorkspaceId?: Record<string, string | null>;
  gitStateByWorkspaceId?: Record<string, GitStatus>;
  gitBranchListByWorkspaceId?: Record<string, { current: string; branches: GitBranch[] }>;
  gitDiffPreviewByWorkspaceId?: Record<
    string,
    import("../features/workspace/atoms").GitDiffPreview
  >;
  worktreeListByWorkspaceId?: Record<string, WorktreeInfo[]>;
  terminalMetaById?: Record<
    string,
    { id: string; workspaceId: string; kind: "agent" | "shell"; alive: boolean; title?: string }
  >;
  terminalIdsByWorkspaceId?: Record<string, string[]>;
  terminalActiveIdByWorkspaceId?: Record<string, string | null>;
  terminalOutputById?: Record<string, Uint8Array[]>;
  toasts?: Toast[];
  commandPaletteOpen?: boolean;
  branchQuickPick?: {
    visible: boolean;
    workspaceId?: string;
    inputValue: string;
    selectedBranch?: string;
  };
  terminalPanelVisible?: boolean;
  supervisorBySessionId?: Record<string, Supervisor>;
  supervisorDialog?: {
    open: boolean;
    sessionId: string | null;
    mode: "enable" | "edit";
    draftObjective: string;
    draftEvaluatorProviderId: "claude" | "codex";
    draftEvaluatorModel?: string;
    draftMaxSupervisionCount?: string;
    draftScheduledAt?: string;
  };
  updateState?: UpdateStateView | null;
  commands?: UiPreviewCommands;
}

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function getTerminalPreviewBytes(seed: UiPreviewSeed, terminalId: string): Uint8Array {
  const chunks = seed.terminalOutputById?.[terminalId] ?? [];
  if (chunks.length === 0) {
    return new Uint8Array();
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function getTerminalPreviewSeq(seed: UiPreviewSeed, terminalId: string): number {
  return getTerminalPreviewBytes(seed, terminalId).byteLength;
}

type PreviewSkillLibraryItem = NonNullable<UiPreviewCommands["skillsLibraryList"]>[number];
type PreviewSkillInfoMap = NonNullable<UiPreviewCommands["skillsInfoBySlug"]>;
type PreviewSkillTarget = NonNullable<UiPreviewCommands["skillsHealthScan"]>["targets"][number];

interface PreviewSkillFsFileEntry {
  kind: "file";
  content: string;
}

interface PreviewSkillFsDirEntry {
  kind: "dir";
}

type PreviewSkillFsEntry = PreviewSkillFsFileEntry | PreviewSkillFsDirEntry;

interface PreviewSkillsState {
  library: PreviewSkillLibraryItem[];
  healthScan: {
    targets: PreviewSkillTarget[];
    mounts: SkillMountRelation[];
  };
  localFilesBySlug: Map<string, Map<string, PreviewSkillFsEntry>>;
  infoBySlug: PreviewSkillInfoMap;
  localSkillRoot: string;
}

function cloneSkillLibraryItem(item: PreviewSkillLibraryItem): PreviewSkillLibraryItem {
  return {
    ...item,
    mountedProviderIds: [...item.mountedProviderIds],
  };
}

function cloneSkillMountRelation(relation: SkillMountRelation): SkillMountRelation {
  return {
    ...relation,
  };
}

function cloneSkillTarget(target: PreviewSkillTarget): PreviewSkillTarget {
  return {
    ...target,
  };
}

function cloneSkillInfoMap(input: UiPreviewCommands["skillsInfoBySlug"]): PreviewSkillInfoMap {
  return Object.fromEntries(
    Object.entries(input ?? {}).map(([slug, info]) => [
      slug,
      {
        ...info,
        libraryEntry: info.libraryEntry ? { ...info.libraryEntry } : undefined,
        mounts: info.mounts.map((mount) => ({ ...mount })),
      },
    ])
  );
}

function previewHash(content: string): string {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = (hash * 31 + content.charCodeAt(index)) >>> 0;
  }
  return `preview:${content.length}:${hash.toString(16)}`;
}

function slugifyPreviewSkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildDefaultCustomSkillMarkdown(displayName: string, slug: string): string {
  return [
    "---",
    `name: ${slug}`,
    "description: Custom skill",
    "---",
    "",
    `# ${displayName}`,
    "",
  ].join("\n");
}

function normalizeSkillPath(input?: string, rootFallback = "."): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed || trimmed === "." || trimmed === "./") {
    return rootFallback;
  }

  const sanitized = trimmed
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/g, "");

  if (!sanitized || sanitized === ".") {
    return rootFallback;
  }

  const segments = sanitized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw { code: "path_escape", message: "Path escapes skill root" };
  }

  return segments.join("/");
}

function parentSkillPath(path: string): string {
  if (path === ".") {
    return ".";
  }

  const slashIndex = path.lastIndexOf("/");
  return slashIndex === -1 ? "." : path.slice(0, slashIndex);
}

function basenameSkillPath(path: string): string {
  if (path === ".") {
    return ".";
  }

  const slashIndex = path.lastIndexOf("/");
  return slashIndex === -1 ? path : path.slice(slashIndex + 1);
}

function ensurePreviewDirEntries(tree: Map<string, PreviewSkillFsEntry>, targetPath: string): void {
  let current = ".";
  for (const segment of targetPath.split("/")) {
    current = current === "." ? segment : `${current}/${segment}`;
    const existing = tree.get(current);
    if (existing?.kind === "file") {
      throw { code: "already_exists", message: "File already exists" };
    }
    if (!existing) {
      tree.set(current, { kind: "dir" });
    }
  }
}

function listPreviewSkillChildren(
  tree: Map<string, PreviewSkillFsEntry>,
  dirPath: string
): FileNode[] {
  const dirEntry = tree.get(dirPath);
  if (!dirEntry || dirEntry.kind !== "dir") {
    throw { code: "not_found", message: "Directory not found" };
  }

  const children: FileNode[] = [];
  for (const [path, entry] of tree.entries()) {
    if (path === "." || parentSkillPath(path) !== dirPath) {
      continue;
    }

    children.push({
      name: basenameSkillPath(path),
      path,
      kind: entry.kind,
    });
  }

  return children.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "dir" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function getPreviewLocalSkillTree(state: PreviewSkillsState, skillSlug: string) {
  const tree = state.localFilesBySlug.get(skillSlug);
  if (!tree) {
    throw { code: "skill_not_found", message: `Custom skill not found: ${skillSlug}` };
  }
  return tree;
}

function getPreviewSkillLibraryEntry(state: PreviewSkillsState, skillSlug: string) {
  const entry = state.library.find((skill) => skill.slug === skillSlug);
  if (!entry || entry.source !== "custom") {
    throw { code: "skill_not_found", message: `Custom skill not found: ${skillSlug}` };
  }
  return entry;
}

function touchPreviewSkill(state: PreviewSkillsState, skillSlug: string): void {
  const entry = getPreviewSkillLibraryEntry(state, skillSlug);
  entry.updatedAt = Date.now();
}

function readPreviewSkillFile(
  state: PreviewSkillsState,
  skillSlug: string,
  relPath: string
): {
  kind: "text";
  content: string;
  baseHash: string;
  encoding: "utf-8";
  displayPath: string;
} {
  const entry = getPreviewSkillLibraryEntry(state, skillSlug);
  const tree = getPreviewLocalSkillTree(state, skillSlug);
  const normalizedPath = normalizeSkillPath(relPath, ".");
  const node = tree.get(normalizedPath);

  if (!node || node.kind !== "file") {
    throw { code: "not_found", message: "File not found" };
  }

  return {
    kind: "text",
    content: node.content,
    baseHash: previewHash(node.content),
    encoding: "utf-8",
    displayPath: `${entry.libraryPath}/${normalizedPath}`,
  };
}

function createPreviewSkillFile(
  state: PreviewSkillsState,
  skillSlug: string,
  relPath: string
): void {
  const tree = getPreviewLocalSkillTree(state, skillSlug);
  const normalizedPath = normalizeSkillPath(relPath, ".");
  const existing = tree.get(normalizedPath);
  if (existing) {
    throw { code: "already_exists", message: "File already exists" };
  }

  ensurePreviewDirEntries(tree, parentSkillPath(normalizedPath));
  tree.set(normalizedPath, { kind: "file", content: "" });
  touchPreviewSkill(state, skillSlug);
}

function createPreviewSkillDirectory(
  state: PreviewSkillsState,
  skillSlug: string,
  relPath: string
): void {
  const tree = getPreviewLocalSkillTree(state, skillSlug);
  const normalizedPath = normalizeSkillPath(relPath, ".");
  const existing = tree.get(normalizedPath);
  if (existing) {
    throw {
      code: "already_exists",
      message: existing.kind === "dir" ? "Directory already exists" : "File already exists",
    };
  }

  ensurePreviewDirEntries(tree, normalizedPath);
  touchPreviewSkill(state, skillSlug);
}

function renamePreviewSkillEntry(
  state: PreviewSkillsState,
  skillSlug: string,
  fromRelPath: string,
  toRelPath: string
): void {
  const tree = getPreviewLocalSkillTree(state, skillSlug);
  const fromPath = normalizeSkillPath(fromRelPath, ".");
  const toPath = normalizeSkillPath(toRelPath, ".");
  const source = tree.get(fromPath);

  if (!source) {
    throw { code: "not_found", message: "Source not found" };
  }

  if (parentSkillPath(fromPath) !== parentSkillPath(toPath)) {
    throw {
      code: "rename_across_directories_not_supported",
      message: "Rename must stay within the current directory",
    };
  }

  if (tree.has(toPath)) {
    throw { code: "already_exists", message: "Target already exists" };
  }

  const renamedEntries = [...tree.entries()].filter(
    ([path]) => path === fromPath || path.startsWith(`${fromPath}/`)
  );
  const renamedPaths = new Set(renamedEntries.map(([path]) => path));

  for (const [path] of renamedEntries) {
    const nextPath = path === fromPath ? toPath : `${toPath}${path.slice(fromPath.length)}`;
    const conflict = tree.get(nextPath);
    if (conflict && !renamedPaths.has(nextPath)) {
      throw { code: "already_exists", message: "Target already exists" };
    }
  }

  for (const [path] of renamedEntries) {
    tree.delete(path);
  }

  for (const [path, entry] of renamedEntries) {
    const nextPath = path === fromPath ? toPath : `${toPath}${path.slice(fromPath.length)}`;
    tree.set(
      nextPath,
      entry.kind === "dir" ? { kind: "dir" } : { kind: "file", content: entry.content }
    );
  }

  touchPreviewSkill(state, skillSlug);
}

function deletePreviewSkillEntry(
  state: PreviewSkillsState,
  skillSlug: string,
  relPath: string
): void {
  const tree = getPreviewLocalSkillTree(state, skillSlug);
  const normalizedPath = normalizeSkillPath(relPath, ".");
  if (!tree.has(normalizedPath)) {
    throw { code: "not_found", message: "Target not found" };
  }

  for (const path of [...tree.keys()]) {
    if (path === normalizedPath || path.startsWith(`${normalizedPath}/`)) {
      tree.delete(path);
    }
  }

  touchPreviewSkill(state, skillSlug);
}

function writePreviewSkillFile(
  state: PreviewSkillsState,
  skillSlug: string,
  relPath: string,
  content: string,
  baseHash?: string
): { newHash: string } {
  const tree = getPreviewLocalSkillTree(state, skillSlug);
  const normalizedPath = normalizeSkillPath(relPath, ".");
  const node = tree.get(normalizedPath);
  if (!node || node.kind !== "file") {
    throw { code: "not_found", message: "File not found" };
  }

  const currentHash = previewHash(node.content);
  if (baseHash && baseHash !== currentHash) {
    throw {
      code: "conflict",
      message: "File has been modified externally",
      details: {
        expectedHash: baseHash,
        actualHash: currentHash,
      },
    };
  }

  tree.set(normalizedPath, { kind: "file", content });
  touchPreviewSkill(state, skillSlug);
  return { newHash: previewHash(content) };
}

function buildPreviewLocalFileTree(
  displayName: string,
  slug: string,
  entries?: Array<{ path: string; kind: "file" | "dir"; content?: string }>
): Map<string, PreviewSkillFsEntry> {
  const tree = new Map<string, PreviewSkillFsEntry>();
  tree.set(".", { kind: "dir" });

  for (const entry of entries ?? []) {
    const normalizedPath = normalizeSkillPath(entry.path, ".");
    if (normalizedPath === ".") {
      continue;
    }

    if (entry.kind === "dir") {
      ensurePreviewDirEntries(tree, normalizedPath);
      continue;
    }

    ensurePreviewDirEntries(tree, parentSkillPath(normalizedPath));
    tree.set(normalizedPath, { kind: "file", content: entry.content ?? "" });
  }

  if (!tree.has("SKILL.md")) {
    tree.set("SKILL.md", {
      kind: "file",
      content: buildDefaultCustomSkillMarkdown(displayName, slug),
    });
  }

  return tree;
}

function resolvePreviewLocalSkillRoot(
  library: PreviewSkillLibraryItem[],
  commands: UiPreviewCommands
): string {
  const localEntry = library.find((entry) => entry.source === "custom");
  if (localEntry?.libraryPath) {
    return parentSkillPath(localEntry.libraryPath.replace(/\\/g, "/"));
  }

  const seededPath = Object.keys(commands.skillsLocalFileEntriesBySlug ?? {})[0];
  if (seededPath) {
    return "/Users/spencer/.coder-studio/state/skills/custom";
  }

  return "/Users/spencer/.coder-studio/state/skills/custom";
}

function createPreviewSkillsState(commands: UiPreviewCommands = {}): PreviewSkillsState {
  const library = (commands.skillsLibraryList ?? []).map(cloneSkillLibraryItem);
  const healthScan = {
    targets: (commands.skillsHealthScan?.targets ?? []).map(cloneSkillTarget),
    mounts: (commands.skillsHealthScan?.mounts ?? []).map(cloneSkillMountRelation),
  };
  const infoBySlug = cloneSkillInfoMap(commands.skillsInfoBySlug);
  const localSkillRoot = resolvePreviewLocalSkillRoot(library, commands);
  const localFilesBySlug = new Map<string, Map<string, PreviewSkillFsEntry>>();

  for (const entry of library) {
    if (entry.source !== "custom") {
      continue;
    }

    localFilesBySlug.set(
      entry.slug,
      buildPreviewLocalFileTree(
        entry.displayName,
        entry.slug,
        commands.skillsLocalFileEntriesBySlug?.[entry.slug]
      )
    );
  }

  return {
    library,
    healthScan,
    localFilesBySlug,
    infoBySlug,
    localSkillRoot,
  };
}

function err(message: string) {
  return {
    ok: false as const,
    error: { code: "preview_missing_handler", message },
  };
}

function createPreviewDispatcher(seed: UiPreviewSeed, store: Store): DispatchCommand {
  const previewSkillsState = createPreviewSkillsState(seed.commands);

  return async <T>(op: string, args: unknown) => {
    const commands = seed.commands ?? {};

    if (op === "settings.get") {
      return ok((commands.settingsGet ?? {}) as T);
    }

    if (op === "settings.update") {
      return ok((commands.settingsUpdate ?? {}) as T);
    }

    if (op === "settings.previewCommand") {
      const providerId = (args as { providerId?: string })?.providerId ?? "";
      return ok({
        preview: commands.settingsPreviewCommandByProviderId?.[providerId] ?? "",
      } as unknown as T);
    }

    if (op === "settings.readConfigFile") {
      return ok({ exists: true, content: "# preview config\n" } as unknown as T);
    }

    if (op === "settings.writeConfigFile") {
      return ok({ ok: true } as unknown as T);
    }

    if (op === "monitoring.get") {
      if (!commands.monitoringGet) {
        return err("Missing preview handler for monitoring.get");
      }
      return ok(commands.monitoringGet as T);
    }

    if (op === "monitoring.recheck") {
      return ok((commands.monitoringRecheck ?? commands.monitoringGet ?? null) as T);
    }

    if (op === "workspace.list") {
      return ok((commands.workspaceList ?? seed.workspaces ?? []) as T);
    }

    if (op === "workspace.history.list") {
      return ok((commands.workspaceHistoryList ?? []) as T);
    }

    if (op === "provider.list") {
      return ok((commands.providerList ?? seed.providerList ?? []) as T);
    }

    if (op === "provider.runtimeStatus") {
      return ok({
        providers: commands.providerRuntimeStatus ?? seed.providerRuntimeStatus ?? {},
      } as unknown as T);
    }

    if (op === "workspace.browse") {
      if (!commands.workspaceBrowse) {
        return err("Missing workspace.browse preview handler");
      }
      return ok(commands.workspaceBrowse as T);
    }

    if (op === "workspace.wsl.browse") {
      const payload = commands.workspaceWslBrowse ?? commands.workspaceBrowse;
      if (!payload) {
        return err("Missing workspace.wsl.browse preview handler");
      }
      return ok(payload as T);
    }

    if (op === "workspace.wsl.listDistros") {
      return ok({ distros: commands.workspaceWslDistros ?? [] } as unknown as T);
    }

    if (op === "workspace.wsl.mkdir") {
      return ok({ ok: true } as unknown as T);
    }

    if (op === "file.browse") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      const payload =
        commands.fileBrowseByWorkspaceId?.[workspaceId] ??
        commands.workspaceBrowse ??
        commands.workspaceWslBrowse;
      if (!payload) {
        return err("Missing file.browse preview handler");
      }
      return ok(payload as T);
    }

    if (op === "workspace.open") {
      if (!commands.workspaceOpen) {
        return err("Missing workspace.open preview handler");
      }
      return ok(commands.workspaceOpen as T);
    }

    if (op === "workspace.uiState.set") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      const uiState = (args as { uiState?: Workspace["uiState"] })?.uiState;
      if (workspaceId && uiState?.paneLayout) {
        store.set(paneLayoutAtomFamily(workspaceId), uiState.paneLayout as PaneNode);
      }
      const fallbackWorkspace =
        seed.workspaces?.find((workspace) => workspace.id === workspaceId) ?? seed.workspaces?.[0];
      if (workspaceId && fallbackWorkspace && uiState) {
        const nextWorkspace = {
          ...fallbackWorkspace,
          uiState,
        };
        store.set(workspacesAtom, {
          ...store.get(workspacesAtom),
          [workspaceId]: nextWorkspace,
        });
        return ok((commands.workspaceUiStateSet ?? nextWorkspace) as T);
      }
      return ok((commands.workspaceUiStateSet ?? commands.workspaceOpen ?? fallbackWorkspace) as T);
    }

    if (op === "session.list") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      return ok((commands.sessionListByWorkspaceId?.[workspaceId] ?? []).slice() as T);
    }

    if (op === "git.status") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      const value = commands.gitStatusByWorkspaceId?.[workspaceId];
      return value ? ok(value as T) : ok((seed.gitStateByWorkspaceId?.[workspaceId] ?? null) as T);
    }

    if (op === "git.branches") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      const value = commands.gitBranchesByWorkspaceId?.[workspaceId];
      return value ? ok(value as T) : ok({ current: "", branches: [] } as unknown as T);
    }

    if (op === "git.log") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      return ok((commands.gitLogByWorkspaceId?.[workspaceId] ?? { entries: [] }) as unknown as T);
    }

    if (op === "git.diff") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      return ok(
        (commands.gitDiffByWorkspaceId?.[workspaceId] ?? {
          diff: "",
          renderAs: "text",
          status: "modified",
        }) as unknown as T
      );
    }

    if (op === "git.commitDetail") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      return ok(
        (commands.gitCommitDetailByWorkspaceId?.[workspaceId] ?? {
          commit: {
            sha: "",
            shortSha: "",
            subject: "",
            authorName: "",
            authoredAt: 0,
          },
          files: [],
        }) as unknown as T
      );
    }

    if (op === "git.commitFileDiff") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      return ok(
        (commands.gitCommitFileDiffByWorkspaceId?.[workspaceId] ?? {
          diff: "",
          renderAs: "text",
          status: "modified",
        }) as unknown as T
      );
    }

    if (op === "git.checkout") {
      return ok({ success: true, message: "Preview checkout", branch: "main" } as unknown as T);
    }

    if (op === "git.fetch" || op === "git.pull" || op === "git.push") {
      return ok({ success: true, message: "Preview sync" } as unknown as T);
    }

    if (op === "file.readTree") {
      const { workspaceId = "", subPath } =
        (args as { workspaceId?: string; subPath?: string }) ?? {};
      const key = subPath ?? ".";
      const children = commands.fileTreeByWorkspaceId?.[workspaceId]?.[key] ?? [];
      return ok({ path: key, children } as unknown as T);
    }

    if (op === "file.mkdirAbsolute") {
      return ok({ ok: true } as unknown as T);
    }

    if (op === "file.read") {
      const { workspaceId = "", path = "" } =
        (args as { workspaceId?: string; path?: string }) ?? {};
      const file = commands.fileReadByWorkspaceId?.[workspaceId]?.[path];
      return ok({
        kind: "text",
        content: file?.content ?? `// Preview file: ${path}\n`,
        baseHash: file?.baseHash ?? "",
        encoding: "utf-8",
      } as unknown as T);
    }

    if (op === "file.search") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      return ok({ files: commands.fileSearchByWorkspaceId?.[workspaceId] ?? [] } as unknown as T);
    }

    if (op === "file.searchSession.start") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      return ok(
        (commands.fileSearchSessionByWorkspaceId?.[workspaceId] ?? {
          files: [],
          sessionId: "preview-search-session",
          totalMatchCount: 0,
          totalFileCount: 0,
          hasMoreFiles: false,
          truncatedMatchFileCount: 0,
          skippedBinaryFileCount: 0,
          skippedLargeFileCount: 0,
        }) as unknown as T
      );
    }

    if (op === "file.searchSession.previewFile") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      const path = (args as { path?: string })?.path ?? "";
      return ok(
        (commands.fileSearchPreviewByWorkspaceId?.[workspaceId]?.[path] ?? {
          kind: "search-replace-file-diff",
          path,
          title: path,
          sessionId: "preview-search-session",
          baseHash: "preview-base-hash",
          originalContent: `// Preview before replacement: ${path}\n`,
          modifiedContent: `// Preview after replacement: ${path}\n`,
        }) as unknown as T
      );
    }

    if (op === "file.searchSession.apply") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      return ok(
        (commands.fileSearchApplyByWorkspaceId?.[workspaceId] ?? {
          sessionId: "preview-search-session",
          status: "ok",
          appliedFileCount: 1,
          conflictFileCount: 0,
          skippedFileCount: 0,
          results: [],
        }) as unknown as T
      );
    }

    if (op === "worktree.list") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      return ok({
        worktrees: commands.worktreeListByWorkspaceId?.[workspaceId] ?? [],
      } as unknown as T);
    }

    if (op === "worktree.status") {
      const worktreePath = (args as { worktreePath?: string })?.worktreePath ?? "";
      const value = commands.worktreeStatusByPath?.[worktreePath];
      return value ? ok({ status: value } as unknown as T) : ok({ status: null } as unknown as T);
    }

    if (op === "worktree.diff") {
      const worktreePath = (args as { worktreePath?: string })?.worktreePath ?? "";
      return ok({ diff: commands.worktreeDiffByPath?.[worktreePath] ?? "" } as unknown as T);
    }

    if (op === "worktree.tree") {
      const worktreePath = (args as { worktreePath?: string })?.worktreePath ?? "";
      return ok({ tree: commands.worktreeTreeByPath?.[worktreePath] ?? [] } as unknown as T);
    }

    if (op === "worktree.create" || op === "worktree.remove") {
      return ok({ ok: true } as unknown as T);
    }

    if (op === "skills.library.list") {
      return ok(previewSkillsState.library.map(cloneSkillLibraryItem) as unknown as T);
    }

    if (op === "skills.health.scan") {
      return ok({
        targets: previewSkillsState.healthScan.targets.map(cloneSkillTarget),
        mounts: previewSkillsState.healthScan.mounts.map(cloneSkillMountRelation),
      } as unknown as T);
    }

    if (op === "skills.targets.list") {
      return ok(previewSkillsState.healthScan.targets.map(cloneSkillTarget) as unknown as T);
    }

    if (op === "skills.recommend") {
      return ok(
        (commands.skillsRecommendations ?? { entries: [], hasMore: false }) as unknown as T
      );
    }

    if (op === "skills.search") {
      const query = (args as { query?: string })?.query?.trim() ?? "";
      return ok((commands.skillsSearchResultsByQuery?.[query] ?? []) as unknown as T);
    }

    if (op === "skills.info") {
      const slug = (args as { slug?: string })?.slug ?? "";
      const configured = previewSkillsState.infoBySlug[slug];
      if (configured) {
        return ok({
          ...configured,
          libraryEntry: configured.libraryEntry ? { ...configured.libraryEntry } : undefined,
          mounts: configured.mounts.map(cloneSkillMountRelation),
        } as unknown as T);
      }

      const libraryEntry = previewSkillsState.library.find((skill) => skill.slug === slug);
      if (libraryEntry) {
        return ok({
          slug: libraryEntry.slug,
          displayName: libraryEntry.displayName,
          description: libraryEntry.description,
          version: libraryEntry.version,
          installed: libraryEntry.installState === "installed",
          libraryEntry: { ...libraryEntry },
          mounts:
            previewSkillsState.healthScan.mounts
              .filter((mount) => mount.skillSlug === slug)
              .map(cloneSkillMountRelation) ?? [],
        } as unknown as T);
      }

      return err(`Missing preview skill info for ${slug}`);
    }

    if (op === "skills.custom.create") {
      const displayName = (args as { name?: string })?.name?.trim() ?? "";
      const slug = slugifyPreviewSkillName(displayName);

      if (!slug) {
        throw { code: "invalid_skill_name", message: "Skill name must produce a valid slug" };
      }

      if (previewSkillsState.library.some((entry) => entry.slug === slug)) {
        throw { code: "already_exists", message: "Skill already exists" };
      }

      const now = Date.now();
      const entry: PreviewSkillLibraryItem = {
        slug,
        displayName,
        description: "Custom skill",
        version: "local",
        source: "custom",
        origin: "filesystem",
        libraryPath: `${previewSkillsState.localSkillRoot}/${slug}`,
        installState: "installed",
        installedAt: now,
        updatedAt: now,
        mountedProviderIds: [],
        mountStatus: "unmounted",
        errorCount: 0,
      };

      previewSkillsState.library.push(entry);
      previewSkillsState.localFilesBySlug.set(
        slug,
        buildPreviewLocalFileTree(displayName, slug, [
          {
            path: "SKILL.md",
            kind: "file",
            content: buildDefaultCustomSkillMarkdown(displayName, slug),
          },
        ])
      );

      return ok({ ...entry } as unknown as T);
    }

    if (op === "skills.files.readTree") {
      const skillSlug = (args as { skillSlug?: string })?.skillSlug ?? "";
      const path = normalizeSkillPath((args as { path?: string })?.path, ".");
      const tree = getPreviewLocalSkillTree(previewSkillsState, skillSlug);
      return ok({
        path,
        children: listPreviewSkillChildren(tree, path),
      } as unknown as T);
    }

    if (op === "skills.files.read") {
      const skillSlug = (args as { skillSlug?: string })?.skillSlug ?? "";
      const path = (args as { path?: string })?.path ?? "";
      return ok(readPreviewSkillFile(previewSkillsState, skillSlug, path) as unknown as T);
    }

    if (op === "skills.files.write") {
      const skillSlug = (args as { skillSlug?: string })?.skillSlug ?? "";
      const path = (args as { path?: string })?.path ?? "";
      const content = (args as { content?: string })?.content ?? "";
      const baseHash = (args as { baseHash?: string })?.baseHash;
      return ok(
        writePreviewSkillFile(
          previewSkillsState,
          skillSlug,
          path,
          content,
          baseHash
        ) as unknown as T
      );
    }

    if (op === "skills.files.create") {
      const skillSlug = (args as { skillSlug?: string })?.skillSlug ?? "";
      const path = (args as { path?: string })?.path ?? "";
      createPreviewSkillFile(previewSkillsState, skillSlug, path);
      return ok({ ok: true } as unknown as T);
    }

    if (op === "skills.files.mkdir") {
      const skillSlug = (args as { skillSlug?: string })?.skillSlug ?? "";
      const path = (args as { path?: string })?.path ?? "";
      createPreviewSkillDirectory(previewSkillsState, skillSlug, path);
      return ok({ ok: true } as unknown as T);
    }

    if (op === "skills.files.rename") {
      const skillSlug = (args as { skillSlug?: string })?.skillSlug ?? "";
      const fromPath = (args as { fromPath?: string })?.fromPath ?? "";
      const toPath = (args as { toPath?: string })?.toPath ?? "";
      renamePreviewSkillEntry(previewSkillsState, skillSlug, fromPath, toPath);
      return ok({ ok: true } as unknown as T);
    }

    if (op === "skills.files.delete") {
      const skillSlug = (args as { skillSlug?: string })?.skillSlug ?? "";
      const path = (args as { path?: string })?.path ?? "";
      deletePreviewSkillEntry(previewSkillsState, skillSlug, path);
      return ok({ ok: true } as unknown as T);
    }

    if (op === "skills.versions.check") {
      return ok((commands.skillsVersionChecks ?? []) as unknown as T);
    }

    if (op === "skills.install.start" || op === "skills.update.start") {
      const slug = (args as { slug?: string })?.slug ?? "preview-skill";
      return ok({
        jobId: `preview-${op}-${slug}`,
        slug,
        status: "queued",
        steps: [],
      } satisfies SkillInstallJobSnapshot as unknown as T);
    }

    if (op === "skills.install.get") {
      const jobId = (args as { jobId?: string })?.jobId ?? "preview-job";
      return ok({
        jobId,
        slug: "preview-skill",
        status: "succeeded",
        steps: [],
      } satisfies SkillInstallJobSnapshot as unknown as T);
    }

    if (
      op === "skills.mount" ||
      op === "skills.repair" ||
      op === "skills.unmount" ||
      op === "skills.uninstall" ||
      op === "skills.builtin.setMountEnabled"
    ) {
      return ok({ ok: true } as unknown as T);
    }

    if (op === "terminal.list") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      return ok((commands.terminalListByWorkspaceId?.[workspaceId] ?? []) as unknown as T);
    }

    if (op === "terminal.create") {
      const workspaceId =
        (args as { workspaceId?: string })?.workspaceId ?? seed.activeWorkspaceId ?? "";
      return ok({
        id: "terminal-preview-created",
        workspaceId,
        kind: "shell",
        title: "Preview Terminal",
        cwd: "/home/spencer/workspace/coder-studio",
        argv: [],
        cols: 120,
        rows: 32,
        alive: true,
        createdAt: 1,
      } as unknown as T);
    }

    if (op === "terminal.snapshot") {
      const terminalId = (args as { terminalId?: string })?.terminalId ?? "";
      const bytes = getTerminalPreviewBytes(seed, terminalId);
      return ok({
        status: "ok",
        transport: "binary",
        streamId: 1,
        size: bytes.byteLength,
        seq: getTerminalPreviewSeq(seed, terminalId),
        rows: 28,
        cols: 120,
        source: "headless",
        bytes,
      } as unknown as T);
    }

    if (op === "terminal.replay") {
      const terminalId = (args as { terminalId?: string })?.terminalId ?? "";
      const lastSeq = (args as { lastSeq?: number })?.lastSeq ?? 0;
      const fullBytes = getTerminalPreviewBytes(seed, terminalId);
      const replayBytes = fullBytes.subarray(Math.max(0, lastSeq));
      return ok({
        status: "ok",
        transport: "binary",
        streamId: 1,
        size: replayBytes.byteLength,
        seq: fullBytes.byteLength,
        bytes: replayBytes,
      } as unknown as T);
    }

    if (
      op === "terminal.close" ||
      op === "terminal.resize" ||
      op === "terminal.input" ||
      op === "provider.install.start" ||
      op === "provider.install.get" ||
      op === "session.create" ||
      op === "session.stop" ||
      op === "session.remove" ||
      op === "file.create" ||
      op === "file.mkdir" ||
      op === "file.delete" ||
      op === "supervisor.create" ||
      op === "supervisor.update" ||
      op === "supervisor.delete"
    ) {
      return ok({} as unknown as T);
    }

    if (op === "supervisor.get") {
      const sessionId = (args as { sessionId?: string })?.sessionId ?? "";
      const supervisor =
        commands.supervisorBySessionId?.[sessionId] ??
        seed.supervisorBySessionId?.[sessionId] ??
        null;
      return ok({ supervisor } as unknown as T);
    }

    return err(`Missing preview handler for ${op}`);
  };
}

export function buildUiPreviewStore(seed: UiPreviewSeed): Store {
  const store = createStore();
  const dispatch = createPreviewDispatcher(seed, store);
  const workspaces = seed.workspaces ?? [];
  const resolvedThemeId = resolveStoredThemeId(seed.theme);
  const personalization = resolveAppearancePersonalizationSetting(seed.commands?.settingsGet ?? {});

  store.set(themeAtom, resolvedThemeId);
  store.set(appearancePersonalizationAtom, personalization);
  store.set(localeAtom, seed.locale);
  store.set(authEnabledAtom, seed.authEnabled === undefined ? false : seed.authEnabled);
  store.set(authenticatedAtom, seed.authenticated ?? true);
  store.set(connectionStatusAtom, seed.connectionStatus ?? "connected");
  store.set(
    workspacesAtom,
    Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace]))
  );
  store.set(
    workspaceOrderAtom,
    workspaces.map((workspace) => workspace.id)
  );
  store.set(workspacesLoadStateAtom, seed.workspacesLoadState ?? "ready");
  store.set(workspacesLoadErrorAtom, seed.workspacesLoadError ?? null);
  store.set(
    activeWorkspaceIdAtom,
    seed.activeWorkspaceId === undefined ? (workspaces[0]?.id ?? null) : seed.activeWorkspaceId
  );
  for (const workspace of workspaces) {
    store.set(workspaceLayoutStateAtomFamily(workspace.id), {
      focusMode: workspace.uiState.focusMode,
      leftPanelWidth: workspace.uiState.leftPanelWidth,
      bottomPanelHeight: workspace.uiState.bottomPanelHeight,
      sidebarCollapsed: false,
      desktopSidebarView: "explorer",
      terminalPanelVisible: seed.terminalPanelVisible ?? true,
    });
  }
  store.set(
    sessionsAtom,
    Object.fromEntries((seed.sessions ?? []).map((session) => [session.id, session]))
  );
  store.set(providerListAtom, seed.providerList ?? []);
  store.set(providerRuntimeStatusAtom, seed.providerRuntimeStatus);
  store.set(commandPaletteOpenAtom, seed.commandPaletteOpen ?? false);
  store.set(branchQuickPickAtom, seed.branchQuickPick ?? { visible: false, inputValue: "" });
  store.set(terminalPanelVisibleAtom, seed.terminalPanelVisible ?? true);
  store.set(toastsAtom, seed.toasts ?? []);
  store.set(updateStateAtom, seed.updateState ?? null);
  store.set(
    supervisorDialogAtom,
    seed.supervisorDialog
      ? {
          draftEvaluatorModel: "",
          draftMaxSupervisionCount: "0",
          draftScheduledAt: "",
          ...seed.supervisorDialog,
        }
      : {
          open: false,
          sessionId: null,
          mode: "enable",
          draftObjective: "",
          draftEvaluatorProviderId: "claude",
          draftEvaluatorModel: "",
          draftMaxSupervisionCount: "0",
          draftScheduledAt: "",
        }
  );
  store.set(supervisorsAtom, new Map(Object.entries(seed.supervisorBySessionId ?? {})));
  store.set(wsClientAtom, {
    sendCommand: async <T>(op: string, args: unknown) => {
      const result = await dispatch<T>(op, args);
      if (!result.ok) {
        throw new Error(result.error?.message ?? `Preview command failed: ${op}`);
      }
      return result.data as T;
    },
    sendTerminalInput: async () => {},
    subscribe: () => () => {},
    connect: async () => {},
    disconnect: () => {},
    getStatus: () => "connected",
  } as never);

  if (typeof document !== "undefined") {
    applyResolvedTheme(resolvedThemeId);
    document.documentElement.setAttribute("lang", seed.locale);
    document.body.dataset.uiPreviewDevice = seed.device;
    applyAppearancePersonalizationToDocument(personalization, resolvedThemeId);
  }

  for (const [workspaceId, layout] of Object.entries(seed.paneLayoutByWorkspaceId ?? {})) {
    store.set(paneLayoutAtomFamily(workspaceId), layout);
  }

  for (const [workspaceId, paneId] of Object.entries(seed.activeEditorPaneIdByWorkspaceId ?? {})) {
    store.set(activeEditorPaneIdAtomFamily(workspaceId), paneId);
  }

  for (const [workspaceId, paneId] of Object.entries(seed.focusedEditorPaneIdByWorkspaceId ?? {})) {
    store.set(focusedEditorPaneIdAtomFamily(workspaceId), paneId);
  }

  for (const [workspaceId, paneFiles] of Object.entries(seed.activeFilePathByEditorPaneId ?? {})) {
    for (const [paneId, path] of Object.entries(paneFiles)) {
      store.set(
        editorPaneActiveFilePathAtomFamily(getEditorPaneStateKey(workspaceId, paneId)),
        path
      );
    }
  }

  for (const [workspaceId, treeMap] of Object.entries(seed.fileTreeByWorkspaceId ?? {})) {
    store.set(fileTreeAtomFamily(workspaceId), treeMap);
  }

  for (const [workspaceId, openFiles] of Object.entries(seed.openFilesByWorkspaceId ?? {})) {
    store.set(openFilesAtomFamily(workspaceId), openFiles);
  }

  for (const [workspaceId, path] of Object.entries(seed.activeFilePathByWorkspaceId ?? {})) {
    store.set(activeFilePathAtomFamily(workspaceId), path);
  }

  for (const [workspaceId, gitState] of Object.entries(seed.gitStateByWorkspaceId ?? {})) {
    store.set(gitStateAtomFamily(workspaceId), gitState);
  }

  for (const [workspaceId, branchList] of Object.entries(seed.gitBranchListByWorkspaceId ?? {})) {
    store.set(gitBranchListAtomFamily(workspaceId), {
      ...branchList,
      loading: false,
    });
  }

  for (const [workspaceId, preview] of Object.entries(seed.gitDiffPreviewByWorkspaceId ?? {})) {
    store.set(gitDiffPreviewAtomFamily(workspaceId), preview);
  }

  for (const [workspaceId, items] of Object.entries(seed.worktreeListByWorkspaceId ?? {})) {
    store.set(worktreeListAtomFamily(workspaceId), {
      items,
      loading: false,
      lastLoadedAt: 1,
    });
  }

  for (const [terminalId, meta] of Object.entries(seed.terminalMetaById ?? {})) {
    store.set(terminalMetaAtomFamily(terminalId), meta);
  }

  for (const [workspaceId, terminalIds] of Object.entries(seed.terminalIdsByWorkspaceId ?? {})) {
    store.set(terminalIdsAtomFamily(workspaceId), terminalIds);
  }

  for (const [workspaceId, terminalId] of Object.entries(
    seed.terminalActiveIdByWorkspaceId ?? {}
  )) {
    store.set(terminalActiveIdAtomFamily(workspaceId), terminalId);
  }

  return store;
}
