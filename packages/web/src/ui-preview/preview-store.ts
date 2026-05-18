import type {
  FileNode,
  GitBranch,
  GitCommitSummary,
  GitStatus,
  Session,
  Supervisor,
  Workspace,
  WorktreeInfo,
} from "@coder-studio/core";
import { createStore, type Store } from "jotai";
import { authenticatedAtom, commandPaletteOpenAtom, localeAtom, themeAtom } from "../atoms/app-ui";
import {
  authEnabledAtom,
  connectionStatusAtom,
  type DispatchCommand,
  wsClientAtom,
} from "../atoms/connection";
import { sessionsAtom } from "../atoms/sessions";
import {
  activeWorkspaceIdAtom,
  type WorkspaceLoadState,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../atoms/workspaces";
import { type PaneNode, paneLayoutAtomFamily } from "../features/agent-panes/atoms/pane-layout";
import { type Toast, toastsAtom } from "../features/notifications";
import {
  supervisorCyclesAtom,
  supervisorDialogAtom,
  supervisorsAtom,
} from "../features/supervisor/atoms";
import { terminalMetaAtomFamily } from "../features/terminal-panel/atoms";
import {
  activeFilePathAtomFamily,
  branchQuickPickAtom,
  fileTreeAtomFamily,
  gitBranchListAtomFamily,
  gitDiffPreviewAtomFamily,
  gitStateAtomFamily,
  terminalPanelVisibleAtom,
  worktreeListAtomFamily,
} from "../features/workspace/atoms";
import { resolveStoredThemeId } from "../theme";

export type UiPreviewTheme = string;
export type UiPreviewLocale = "zh" | "en";
export type UiPreviewDevice = "desktop" | "mobile";

export interface UiPreviewCommands {
  settingsGet?: Record<string, unknown>;
  settingsUpdate?: Record<string, unknown>;
  settingsPreviewCommandByProviderId?: Record<string, string>;
  workspaceBrowse?: {
    currentPath: string;
    parentPath: string | null;
    directories: Array<{ name: string; path: string; itemCount?: number }>;
  };
  workspaceOpen?: Workspace;
  workspaceUiStateSet?: Workspace;
  workspaceList?: Workspace[];
  sessionListByWorkspaceId?: Record<string, Session[]>;
  gitStatusByWorkspaceId?: Record<string, GitStatus>;
  gitBranchesByWorkspaceId?: Record<string, { current: string; branches: GitBranch[] }>;
  gitLogByWorkspaceId?: Record<string, { entries: GitCommitSummary[] }>;
  gitDiffByWorkspaceId?: Record<string, { diff: string }>;
  gitShowByWorkspaceId?: Record<string, { diff: string }>;
  fileTreeByWorkspaceId?: Record<string, Record<string, FileNode[]>>;
  fileSearchByWorkspaceId?: Record<string, FileNode[]>;
  worktreeListByWorkspaceId?: Record<string, WorktreeInfo[]>;
  worktreeStatusByPath?: Record<string, GitStatus>;
  worktreeDiffByPath?: Record<string, string>;
  worktreeTreeByPath?: Record<string, FileNode[]>;
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
  paneLayoutByWorkspaceId?: Record<string, PaneNode>;
  fileTreeByWorkspaceId?: Record<string, Map<string, FileNode[]>>;
  activeFilePathByWorkspaceId?: Record<string, string | null>;
  gitStateByWorkspaceId?: Record<string, GitStatus>;
  gitBranchListByWorkspaceId?: Record<string, { current: string; branches: GitBranch[] }>;
  gitDiffPreviewByWorkspaceId?: Record<
    string,
    { path: string; diff: string; source?: "file" | "commit" }
  >;
  worktreeListByWorkspaceId?: Record<string, WorktreeInfo[]>;
  terminalMetaById?: Record<
    string,
    { id: string; workspaceId: string; kind: "agent" | "shell"; alive: boolean; title?: string }
  >;
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
    mode: "enable" | "edit" | "disable";
    draftObjective: string;
    draftEvaluatorProviderId: "claude" | "codex";
    draftEvaluatorModel?: string;
    draftMaxSupervisionCount?: string;
    draftScheduledAt?: string;
  };
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

function err(message: string) {
  return {
    ok: false as const,
    error: { code: "preview_missing_handler", message },
  };
}

function createPreviewDispatcher(seed: UiPreviewSeed): DispatchCommand {
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

    if (op === "workspace.list") {
      return ok((commands.workspaceList ?? seed.workspaces ?? []) as T);
    }

    if (op === "workspace.browse") {
      if (!commands.workspaceBrowse) {
        return err("Missing workspace.browse preview handler");
      }
      return ok(commands.workspaceBrowse as T);
    }

    if (op === "workspace.open") {
      if (!commands.workspaceOpen) {
        return err("Missing workspace.open preview handler");
      }
      return ok(commands.workspaceOpen as T);
    }

    if (op === "workspace.uiState.set") {
      return ok(
        (commands.workspaceUiStateSet ?? commands.workspaceOpen ?? seed.workspaces?.[0]) as T
      );
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
      return ok((commands.gitDiffByWorkspaceId?.[workspaceId] ?? { diff: "" }) as unknown as T);
    }

    if (op === "git.show") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      return ok((commands.gitShowByWorkspaceId?.[workspaceId] ?? { diff: "" }) as unknown as T);
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

    if (op === "file.search") {
      const workspaceId = (args as { workspaceId?: string })?.workspaceId ?? "";
      return ok({ files: commands.fileSearchByWorkspaceId?.[workspaceId] ?? [] } as unknown as T);
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
      op === "provider.runtimeStatus" ||
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
  const dispatch = createPreviewDispatcher(seed);
  const workspaces = seed.workspaces ?? [];

  store.set(themeAtom, resolveStoredThemeId(seed.theme));
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
  store.set(
    sessionsAtom,
    Object.fromEntries((seed.sessions ?? []).map((session) => [session.id, session]))
  );
  store.set(commandPaletteOpenAtom, seed.commandPaletteOpen ?? false);
  store.set(branchQuickPickAtom, seed.branchQuickPick ?? { visible: false, inputValue: "" });
  store.set(terminalPanelVisibleAtom, seed.terminalPanelVisible ?? true);
  store.set(toastsAtom, seed.toasts ?? []);
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
  store.set(supervisorCyclesAtom, new Map());
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

  for (const [workspaceId, layout] of Object.entries(seed.paneLayoutByWorkspaceId ?? {})) {
    store.set(paneLayoutAtomFamily(workspaceId), layout);
  }

  for (const [workspaceId, treeMap] of Object.entries(seed.fileTreeByWorkspaceId ?? {})) {
    store.set(fileTreeAtomFamily(workspaceId), treeMap);
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

  return store;
}
