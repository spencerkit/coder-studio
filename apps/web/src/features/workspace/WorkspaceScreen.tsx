import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRelaxState } from "@relax-state/react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ExecTarget,
  Session,
  Tab,
  TreeNode,
  WorkbenchState,
  WorktreeInfo,
  createEmptyPreview,
  createId,
  createPaneLeaf,
  createSession,
  createTab,
  workbenchState
} from "../../state/workbench";
import {
  Locale,
  createTranslator,
  formatSessionTitle,
  formatTerminalTitle,
  localizeSessionTitle,
  localizeTerminalTitle,
  localizeWorkspaceTitle,
} from "../../i18n";
import {
  AgentSplitHorizontalIcon,
  AgentSplitVerticalIcon,
  AgentPlusIcon,
  AgentSendIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  HeaderCloseIcon,
} from "../../components/icons";
import { CommandPalette } from "../../components/CommandPalette";
import {
  RuntimeValidationOverlay,
  type RuntimeRequirementStatus,
  type RuntimeValidationState,
} from "../../components/RuntimeValidationOverlay/RuntimeValidationOverlay";
import { TopBar } from "../../components/TopBar";
import { HistoryDrawer } from "../../components/HistoryDrawer";
import { AgentStreamTerminal, type XtermBaseHandle } from "../../components/terminal";
import { WorktreeModal } from "../../components/WorktreeModal";
import { WorkspaceLaunchOverlay } from "../../components/WorkspaceLaunchOverlay";
import { WorkspaceShell } from "../../components/workspace";
import {
  AgentWorkspaceFeature,
  armAgentStartupGate,
  buildSlashMenuItems,
  buildSlashMenuSections,
  clearAgentStartupGate,
  commitAgentSessionTitle,
  createAgentTerminalFitScheduler,
  focusAgentTerminal,
  fitAgentTerminals,
  isAgentRuntimeRunning,
  markAgentRuntimeStarted,
  setAgentTerminalRef,
  setDraftPromptInputRef,
  syncAgentPaneSize,
  syncAgentRuntimeSize,
  trackAgentInitialTitleInput,
  waitForAgentStartupDrain
} from "../../features/agents";
import { buildCommandPaletteActions, filterCommandPaletteActions } from "../../features/command-palette";
import { WorkspaceCodeFeature } from "../../features/editor";
import { WorkspaceTerminalFeature } from "../../features/terminal";
import {
  activateWorkspacePane,
  addWorkspaceTerminal,
  canMutateWorkspace,
  buildWorkspaceGitChangeGroups,
  closeWorkspaceTerminal,
  createWorkspaceControllerStateFromLease,
  findPreviewGitChange,
  getOrCreateClientId,
  getOrCreateDeviceId,
  loadWorkspaceFilePreview,
  loadWorkspaceGitChangePreview,
  loadWorkspaceRepositoryDiff,
  openWorkspacePreviewPath,
  openWorkspaceWorktree,
  performWorkspaceGitOperation,
  resolveWorkspacePreviewPathLabel,
  saveWorkspacePreview,
  selectWorkspaceTerminal,
  splitWorkspacePane,
  startWorkspacePaneSplitResize,
  startWorkspacePanelResize,
  syncWorkspaceTerminalSize,
  toggleWorkspaceRightPane,
  writeWorkspaceTerminalData
} from "./";
import {
  resolveAgentRecoveryAction,
  resolveTerminalRecoveryAction,
} from "./workspace-recovery";
import { attachWorkspaceRuntimeWithRetry } from "./runtime-attach";
import {
  createInitialHistoryExpansion,
  groupSessionHistory,
  selectHistoryPrimaryAction,
} from "./session-history";
import { listRestoreCandidatesForWorkspace } from "./session-restore-chooser";
import { createWorkspaceSessionActions } from "./session-actions";
import { useWorkspaceArtifactsSync } from "./workspace-sync-hooks";
import { startWorkspaceLaunch } from "./workspace-launch-actions";
import {
  browseWorkspaceOverlayDirectory,
  updateWorkspaceOverlayInput,
  updateWorkspaceOverlayTarget
} from "./workspace-overlay-actions";
import {
  buildWorkspaceFileSearchResults,
  closeWorkspaceFileSearch,
  createInitialWorkspaceFileSearchState,
  moveWorkspaceFileSearchIndex,
  normalizeWorkspaceFileSearchQuery,
  openWorkspaceFileSearch,
  resetWorkspaceFileSearch,
  resolveWorkspaceFileSearchDropdownStyle,
  setWorkspaceFileSearchActiveIndex,
  shouldShowWorkspaceFileSearchDropdown,
  syncWorkspaceFileSearchState,
  updateWorkspaceFileSearchQuery,
  withWorkspaceFileSearchDropdownStyle
} from "./file-search-actions";
import { startAgent, sendAgentInput } from "../../services/http/agent.service";
import { withFallback } from "../../services/http/client";
import {
  commitGitChanges,
  discardAllGitChanges,
  discardGitFile,
  stageAllGitChanges,
  stageGitFile,
  unstageAllGitChanges,
  unstageGitFile
} from "../../services/http/git.service";
import {
} from "../../services/http/session.service";
import { checkCommandAvailability } from "../../services/http/system.service";
import {
  activateWorkspace as activateWorkspaceRequest,
  closeWorkspace as closeWorkspaceRequest,
  getWorkbenchBootstrap,
  getWorkspaceSnapshot,
  listSessionHistory,
  listClaudeSlashSkills,
  rejectWorkspaceTakeover,
  requestWorkspaceTakeover,
  updateWorkbenchLayout,
  updateWorkspaceView
} from "../../services/http/workspace.service";
import {
  applyWorkbenchUiState,
  applyWorkspaceControllerEvent,
  applyWorkspaceRuntimeSnapshot,
  buildWorkbenchStateFromBootstrap,
  upsertWorkspaceSnapshot,
  workbenchLayoutToBackend
} from "../../shared/utils/workspace";
import {
  AGENT_SPECIAL_KEY_MAP,
  replaceLeadingSlashToken
} from "../../shared/app/constants";
import {
  formatClaudeRuntimeCommand,
  resolveClaudeRuntimeProfile,
} from "../../shared/app/claude-settings.ts";
import { stripAnsi } from "../../shared/utils/ansi";
import { inferEditorLanguage } from "../../shared/utils/editor";
import { estimateTerminalGrid, type TerminalGridSize } from "../../shared/utils/terminal";
import {
  collectPaneLeaves,
  findPaneIdBySessionId,
  findPaneSessionId,
  remapPaneSession,
  removePaneNode,
  replacePaneNode,
} from "../../shared/utils/panes";
import {
  displayPathName,
  fileParentLabel,
  sanitizeGitRelativePath,
} from "../../shared/utils/path";
import {
  createSessionFromBackend,
  formatRelativeSessionTime,
  isForegroundActiveStatus,
  isDraftSession,
  isHiddenDraftPlaceholder,
  nowLabel,
  parseNumericId,
  resolveVisibleStatus,
  restoreVisibleStatus,
  sessionCompletionRatio,
  sessionTone,
  toBackgroundStatus
} from "../../shared/utils/session";
import { sortTreeNodes } from "../../shared/utils/tree";
import { buildWorkspaceShellSummary } from "./workspace-shell-summary";
import type {
  AgentStartResult,
  AppSettings,
  AppTheme,
  ClaudeSlashMenuItem,
  ClaudeSlashSkillEntry,
  CommandAvailability,
  CommandPaletteAction,
  FolderBrowserState,
  GitChangeAction,
  GitChangeEntry,
  SessionHistoryRecord,
  Toast,
  WorkspaceControllerLease,
  WorktreeModalState,
  WorktreeView,
} from "../../types/app";

const withServiceFallback = async <T,>(operation: () => Promise<T>, fallback: T): Promise<T> => withFallback(operation, fallback);

type WorkspaceScreenProps = {
  locale: Locale;
  appSettings: AppSettings;
  onOpenSettings: () => void;
};

const formatExecTargetLabel = (target: ExecTarget, t: ReturnType<typeof createTranslator>) =>
  target.type === "wsl"
    ? target.distro?.trim()
      ? `WSL (${target.distro.trim()})`
      : "WSL"
    : t("nativeTarget");

const resolveTargetClaudeCommand = (
  settings: AppSettings,
  target: ExecTarget,
) => formatClaudeRuntimeCommand(resolveClaudeRuntimeProfile(settings, target));

const REQUIRED_RUNTIME_COMMANDS = [
  { id: "git", command: "git" },
] as const satisfies ReadonlyArray<{
  id: RuntimeRequirementStatus["id"];
  command: string;
}>;

type RuntimeRequirementSpec = {
  id: RuntimeRequirementStatus["id"];
  command: string;
  deferred?: boolean;
  detailText?: string;
};

const parseRuntimeCommandBinary = (command: string) => {
  const trimmed = command.trim();
  if (!trimmed) return "";

  let token = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const ch of trimmed) {
    if (escaped) {
      token += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\" && !inSingle) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === "\"" && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (token) break;
      continue;
    }
    token += ch;
  }

  return token.trim();
};

const commandUsesWorkspaceRelativePath = (binary: string) => {
  return binary.startsWith("./")
    || binary.startsWith("../")
    || binary.startsWith(".\\")
    || binary.startsWith("..\\");
};

const buildRuntimeRequirementSpecs = (
  agentCommand: string,
  t: ReturnType<typeof createTranslator>,
): RuntimeRequirementSpec[] => {
  const trimmedAgentCommand = agentCommand.trim();
  const commandBinary = parseRuntimeCommandBinary(trimmedAgentCommand);
  const claudeRequirement: RuntimeRequirementSpec = {
    id: "claude",
    command: trimmedAgentCommand,
  };

  if (commandBinary.includes("{path}") || commandUsesWorkspaceRelativePath(commandBinary)) {
    claudeRequirement.deferred = true;
    claudeRequirement.detailText = t("runtimeCheckClaudeDeferredHint");
  }

  return [claudeRequirement, ...REQUIRED_RUNTIME_COMMANDS];
};

const serializeRuntimeValidationKey = (target: ExecTarget, agentCommand: string) =>
  target.type === "wsl"
    ? `wsl:${target.distro?.trim() ?? ""}:${agentCommand.trim()}`
    : `native:${agentCommand.trim()}`;

const createRuntimeRequirementStatus = (
  agentCommand: string,
  t: ReturnType<typeof createTranslator>,
): RuntimeRequirementStatus[] =>
  buildRuntimeRequirementSpecs(agentCommand, t).map(({ id, command, deferred, detailText }) => ({
    id,
    command,
    available: deferred ? true : null,
    detailText,
  }));

const createRuntimeValidationState = (
  agentCommand: string,
  t: ReturnType<typeof createTranslator>,
  targetKey = "",
  status: RuntimeValidationState["status"] = "idle",
): RuntimeValidationState => ({
  status,
  targetKey,
  requirements: createRuntimeRequirementStatus(agentCommand, t),
});

const isTextInputTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

export default function WorkspaceScreen({ locale, appSettings, onOpenSettings }: WorkspaceScreenProps) {
  const [state, setState] = useRelaxState(workbenchState);
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId: routeWorkspaceParam } = useParams<{ workspaceId?: string }>();
  const routeWorkspaceId = useMemo(() => {
    if (routeWorkspaceParam) {
      return routeWorkspaceParam;
    }
    const browserPathname = typeof window === "undefined"
      ? location.pathname
      : window.location.pathname;
    const workspacePathname = browserPathname.startsWith("/workspace/")
      ? browserPathname
      : location.pathname;
    if (!workspacePathname.startsWith("/workspace/")) {
      return undefined;
    }
    const raw = workspacePathname.slice("/workspace/".length).trim();
    return raw ? decodeURIComponent(raw) : undefined;
  }, [location.pathname, routeWorkspaceParam]);
  const theme: AppTheme = "dark";
  const [commitMessage, setCommitMessage] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [worktreeModal, setWorktreeModal] = useState<WorktreeModalState | null>(null);
  const [worktreeView, setWorktreeView] = useState<WorktreeView>("status");
  const [previewMode, setPreviewMode] = useState<"preview" | "diff">("preview");
  const [codeSidebarView, setCodeSidebarView] = useState<"files" | "git">("files");
  const [isCodeExpanded, setIsCodeExpanded] = useState(false);
  const [overlayCanUseWsl, setOverlayCanUseWsl] = useState(false);
  const [folderBrowser, setFolderBrowser] = useState<FolderBrowserState>({
    loading: false,
    currentPath: "",
    homePath: "",
    roots: [],
    entries: []
  });
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteActiveIndex, setCommandPaletteActiveIndex] = useState(0);
  const [fileSearchState, setFileSearchState] = useState(createInitialWorkspaceFileSearchState);
  const [draftPromptInputs, setDraftPromptInputs] = useState<Record<string, string>>({});
  const [draftPaneModes, setDraftPaneModes] = useState<Record<string, "new" | "restore">>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<SessionHistoryRecord[]>([]);
  const [historyExpandedGroups, setHistoryExpandedGroups] = useState<Record<string, boolean>>({});
  const [sessionSort, setSessionSort] = useState<"time" | "name">("time");
  const [repoCollapsedPaths, setRepoCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [worktreeCollapsedPaths, setWorktreeCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [selectedGitChangeKey, setSelectedGitChangeKey] = useState<string>("");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuPaneId, setSlashMenuPaneId] = useState<string | null>(null);
  const [slashMenuLoading, setSlashMenuLoading] = useState(false);
  const [slashSkillItems, setSlashSkillItems] = useState<ClaudeSlashSkillEntry[]>([]);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [controllerActionBusy, setControllerActionBusy] = useState<"takeover" | "reject" | null>(null);
  const [optimisticTakeoverWorkspaceId, setOptimisticTakeoverWorkspaceId] = useState<string | null>(null);
  const t = useMemo(() => createTranslator(locale), [locale]);
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const clientId = useMemo(() => getOrCreateClientId(), []);
  const terminalCompatibilityMode = appSettings.general.terminalCompatibilityMode;
  const [runtimeValidation, setRuntimeValidation] = useState<RuntimeValidationState>(() => createRuntimeValidationState(
    resolveTargetClaudeCommand(appSettings, { type: "native" }),
    t,
  ));
  const stateRef = useRef(state);
  const appRef = useRef<HTMLDivElement | null>(null);
  const fileSearchShellRef = useRef<HTMLDivElement | null>(null);
  const fileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null);
  const draftPromptInputRefs = useRef(new Map<string, HTMLInputElement | null>());
  const shellTerminalRef = useRef<XtermBaseHandle | null>(null);
  const shellTerminalViewportRef = useRef<HTMLDivElement | null>(null);
  const emptyTabRef = useRef<Tab | null>(null);
  const agentTerminalRefs = useRef(new Map<string, XtermBaseHandle | null>());
  const agentTerminalQueueRef = useRef(new Map<string, Promise<void>>());
  const agentTerminalFitSchedulerRef = useRef<ReturnType<typeof createAgentTerminalFitScheduler> | null>(null);
  const agentPaneSizeRef = useRef(new Map<string, { cols: number; rows: number }>());
  const agentRuntimeSizeRef = useRef(new Map<string, { cols: number; rows: number }>());
  const agentResizeStateRef = useRef(new Map<string, {
    inflight: boolean;
    pending?: { cols: number; rows: number };
  }>());
  const agentTitleTrackerRef = useRef(new Map<string, {
    draftSessionId?: string;
    buffer: string;
    locked: boolean;
  }>());
  const terminalSizeRef = useRef<{ id?: string; cols: number; rows: number }>({ cols: 0, rows: 0 });
  const runningAgentKeysRef = useRef(new Set<string>());
  const autoTerminalWorkspaceIdsRef = useRef(new Set<string>());
  const validatedRuntimeTargetsRef = useRef(new Set<string>());
  const runtimeValidationRequestIdRef = useRef(0);
  const persistedLayoutRef = useRef<string>("");
  const persistedWorkspaceViewsRef = useRef(new Map<string, string>());
  const agentStartupStateRef = useRef(new Map<string, {
    token: number;
    startedAt: number;
    lastEventAt: number;
    sawOutput: boolean;
    sawReady: boolean;
    exited: boolean;
  }>());
  const agentStartupTokenRef = useRef(0);
  const getTargetClaudeCommand = useCallback(
    (target: ExecTarget) => resolveTargetClaudeCommand(appSettings, target),
    [appSettings],
  );
  const runRuntimeValidation = useCallback(async (target: ExecTarget) => {
    const command = getTargetClaudeCommand(target);
    const targetKey = serializeRuntimeValidationKey(target, command);
    const requirementSpecs = buildRuntimeRequirementSpecs(command, t);
    const requestId = ++runtimeValidationRequestIdRef.current;
    setRuntimeValidation(createRuntimeValidationState(command, t, targetKey, "checking"));

    const results = await Promise.all(
      requirementSpecs.map(async ({ id, command, deferred, detailText }) => {
        if (deferred) {
          return {
            id,
            command,
            available: true,
            detailText,
          } satisfies RuntimeRequirementStatus;
        }
        try {
          const result = await checkCommandAvailability(command, target);
          return {
            id,
            command,
            available: result.available,
            resolvedPath: result.resolved_path ?? undefined,
            error: result.error ?? undefined,
            detailText,
          } satisfies RuntimeRequirementStatus;
        } catch (error) {
          return {
            id,
            command,
            available: false,
            error: error instanceof Error ? error.message : String(error),
            detailText,
          } satisfies RuntimeRequirementStatus;
        }
      }),
    );

    if (runtimeValidationRequestIdRef.current !== requestId) return;

    const nextStatus: RuntimeValidationState["status"] = results.every((item) => item.available)
      ? "ready"
      : "failed";

    if (nextStatus === "ready") {
      validatedRuntimeTargetsRef.current.add(targetKey);
    }

    setRuntimeValidation({
      status: nextStatus,
      targetKey,
      requirements: results,
    });
  }, [getTargetClaudeCommand, t]);
  const editorMetrics = useMemo(() => {
    if (typeof window === "undefined") {
      return { fontSize: 13, paddingY: 12, terminalFontSize: 12 };
    }
    const source = appRef.current ?? document.documentElement;
    const styles = window.getComputedStyle(source);
    return {
      fontSize: Number.parseInt(styles.getPropertyValue("--editor-font-size"), 10) || 13,
      paddingY: Number.parseInt(styles.getPropertyValue("--editor-padding-y"), 10) || 12,
      terminalFontSize: Number.parseInt(styles.getPropertyValue("--terminal-font-size"), 10) || 12
    };
  }, [theme]);
  const measureWorkspaceTerminalSize = useCallback(
    () => estimateTerminalGrid(
      shellTerminalViewportRef.current,
      editorMetrics.terminalFontSize,
      terminalCompatibilityMode,
    ),
    [editorMetrics.terminalFontSize, terminalCompatibilityMode],
  );
  const resolveAgentInitialSize = useCallback((paneId?: string | null): TerminalGridSize | null => {
    if (!paneId) return null;

    const liveSize = agentPaneSizeRef.current.get(paneId)
      ?? agentTerminalRefs.current.get(paneId)?.size();
    if (liveSize) {
      return liveSize;
    }

    const draftInput = draftPromptInputRefs.current.get(paneId);
    const draftPane = draftInput?.closest(".agent-pane-body");
    if (!(draftPane instanceof HTMLElement)) {
      return null;
    }

    return estimateTerminalGrid(
      draftPane,
      editorMetrics.terminalFontSize,
      terminalCompatibilityMode,
    );
  }, [editorMetrics.terminalFontSize, terminalCompatibilityMode]);

  const updateState = (updater: (current: WorkbenchState) => WorkbenchState) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
  };

  const agentRuntimeRefs = useMemo(() => ({
    draftPromptInputRefs,
    agentTerminalRefs,
    agentTerminalQueueRef,
    agentPaneSizeRef,
    agentRuntimeSizeRef,
    agentResizeStateRef,
    agentTitleTrackerRef,
    runningAgentKeysRef,
    agentStartupStateRef,
    agentStartupTokenRef
  }), []);

  if (!agentTerminalFitSchedulerRef.current && typeof window !== "undefined") {
    agentTerminalFitSchedulerRef.current = createAgentTerminalFitScheduler(
      window.requestAnimationFrame.bind(window),
      window.cancelAnimationFrame.bind(window),
    );
  }

  const runWorkspaceAgentFit = useCallback(() => {
    fitAgentTerminals(agentRuntimeRefs);
  }, [agentRuntimeRefs]);

  const scheduleWorkspaceAgentFit = useCallback(() => {
    const scheduler = agentTerminalFitSchedulerRef.current;
    if (!scheduler) {
      runWorkspaceAgentFit();
      return;
    }
    scheduler.schedule(runWorkspaceAgentFit);
  }, [runWorkspaceAgentFit]);

  const flushWorkspaceAgentFit = useCallback(() => {
    const scheduler = agentTerminalFitSchedulerRef.current;
    if (!scheduler) {
      runWorkspaceAgentFit();
      return;
    }
    scheduler.schedule(runWorkspaceAgentFit);
    scheduler.flush();
  }, [runWorkspaceAgentFit]);

  const registerAgentTerminalRef = (paneId: string, handle: XtermBaseHandle | null) => {
    setAgentTerminalRef(agentRuntimeRefs, paneId, handle);
  };

  const registerDraftPromptInputRef = (paneId: string, element: HTMLInputElement | null) => {
    setDraftPromptInputRef(agentRuntimeRefs, paneId, element);
  };

  const focusWorkspaceAgentPane = (paneId = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeTabId)?.activePaneId) => {
    focusAgentTerminal(agentRuntimeRefs, paneId);
  };

  const commitTrackedAgentSessionTitle = (paneId: string, tabId: string, sessionId: string, rawInput: string) => {
    const appliedTitle = commitAgentSessionTitle({
      refs: agentRuntimeRefs,
      paneId,
      tabId,
      sessionId,
      rawInput,
      locale,
      t,
      updateTab
    });
    if (!appliedTitle) return;
    void syncSessionPatch(tabId, sessionId, { title: appliedTitle });
  };

  const openCommandPalette = () => {
    setCommandPaletteOpen(true);
    setCommandPaletteQuery("");
    setCommandPaletteActiveIndex(0);
  };

  const closeCommandPalette = () => {
    setCommandPaletteOpen(false);
    setCommandPaletteQuery("");
    setCommandPaletteActiveIndex(0);
  };

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => () => {
    agentTerminalFitSchedulerRef.current?.dispose();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const bootstrap = await withServiceFallback(() => getWorkbenchBootstrap(deviceId, clientId), null);
      if (cancelled || !bootstrap) {
        if (!cancelled) {
          setBootstrapReady(true);
        }
        return;
      }
      const nextState = buildWorkbenchStateFromBootstrap(stateRef.current, bootstrap, locale, appSettings);

      if (routeWorkspaceId) {
        const uiState = await withServiceFallback(
          () => activateWorkspaceRequest(routeWorkspaceId, deviceId, clientId),
          null,
        );
        const runtimeSnapshot = uiState
          ? await attachWorkspaceRuntimeWithRetry(
            routeWorkspaceId,
            deviceId,
            clientId,
            withServiceFallback,
          )
          : null;

        if (cancelled) {
          return;
        }

        if (uiState && runtimeSnapshot) {
          updateState(() => applyWorkspaceRuntimeSnapshot(
            nextState,
            runtimeSnapshot,
            locale,
            appSettings,
            deviceId,
            clientId,
            uiState,
          ));
        } else {
          updateState(() => nextState);
        }
      } else {
        updateState(() => nextState);
      }
      if (!cancelled) {
        setBootstrapReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appSettings, clientId, deviceId, locale, routeWorkspaceId]);

  useEffect(() => {
    if (!bootstrapReady) return;
    if (routeWorkspaceId) {
      const existing = stateRef.current.tabs.find((tab) => tab.id === routeWorkspaceId);
      if (existing) {
        let cancelled = false;
        const attachRouteRuntime = () => {
          void attachWorkspaceRuntimeWithRetry(
            routeWorkspaceId,
            deviceId,
            clientId,
            withServiceFallback,
          ).then((runtimeSnapshot) => {
            if (cancelled || !runtimeSnapshot) return;
            updateState((current) => applyWorkspaceRuntimeSnapshot(
              current,
              runtimeSnapshot,
              locale,
              appSettings,
              deviceId,
              clientId,
            ));
          });
        };

        if (stateRef.current.activeTabId !== routeWorkspaceId) {
          switchWorkspaceLocally(routeWorkspaceId);
          void withServiceFallback(() => activateWorkspaceRequest(routeWorkspaceId, deviceId, clientId), null).then((uiState) => {
            if (!uiState) return;
            updateState((current) => applyWorkbenchUiState(current, uiState));
          });
        }
        attachRouteRuntime();
        const timer = window.setTimeout(attachRouteRuntime, 1000);
        void ensureWorkspaceTerminal(routeWorkspaceId);
        return () => {
          cancelled = true;
          window.clearTimeout(timer);
        };
      }

      let cancelled = false;
      void (async () => {
        const uiState = await withServiceFallback(() => activateWorkspaceRequest(routeWorkspaceId, deviceId, clientId), null);
        if (!uiState || cancelled) {
          if (!cancelled) {
            navigate("/workspace", { replace: true });
          }
          return;
        }
        const runtimeSnapshot = await attachWorkspaceRuntimeWithRetry(
          routeWorkspaceId,
          deviceId,
          clientId,
          withServiceFallback,
        );
        if (!runtimeSnapshot || cancelled) {
          if (!cancelled) {
            navigate("/workspace", { replace: true });
          }
          return;
        }
        updateState((current) => applyWorkspaceRuntimeSnapshot(
          current,
          runtimeSnapshot,
          locale,
          appSettings,
          deviceId,
          clientId,
          uiState,
        ));
        void ensureWorkspaceTerminal(routeWorkspaceId);
      })();
      return () => {
        cancelled = true;
      };
    }

    if (stateRef.current.activeTabId) {
      navigate(`/workspace/${stateRef.current.activeTabId}`, { replace: true });
    }
  }, [appSettings, bootstrapReady, clientId, deviceId, locale, navigate, routeWorkspaceId]);

  useEffect(() => {
    if (!bootstrapReady) return;
    const serializedLayout = JSON.stringify(workbenchLayoutToBackend(state.layout));
    if (persistedLayoutRef.current === serializedLayout) return;
    persistedLayoutRef.current = serializedLayout;
    void withServiceFallback(
      () => updateWorkbenchLayout(workbenchLayoutToBackend(state.layout), deviceId, clientId),
      null,
    );
  }, [
    bootstrapReady,
    state.layout.leftWidth,
    state.layout.rightWidth,
    state.layout.rightSplit,
    state.layout.showCodePanel,
    state.layout.showTerminalPanel,
  ]);

  const refreshHistoryRecords = useCallback(async () => {
    setHistoryLoading(true);
    const records = await withServiceFallback(() => listSessionHistory(), null);
    if (records) {
      setHistoryRecords(records);
    }
    setHistoryLoading(false);
  }, []);

  useEffect(() => {
    if (!bootstrapReady) return;
    void refreshHistoryRecords();
  }, [bootstrapReady, refreshHistoryRecords]);

  useEffect(() => {
    if (!bootstrapReady || !historyOpen) return;
    void refreshHistoryRecords();
  }, [bootstrapReady, historyOpen, refreshHistoryRecords]);

  useEffect(() => {
    if (!bootstrapReady) return;
    const liveWorkspaceIds = new Set(state.tabs.map((tab) => tab.id));
    state.tabs.forEach((tab) => {
      if (tab.status !== "ready" || !tab.project?.path) return;
      if (!canMutateWorkspace(tab.controller, "switch_pane")) return;
      const patch = {
        active_session_id: tab.activeSessionId,
        active_pane_id: tab.activePaneId,
        active_terminal_id: tab.activeTerminalId,
        pane_layout: tab.paneLayout,
        file_preview: tab.filePreview,
      };
      const serialized = JSON.stringify(patch);
      if (persistedWorkspaceViewsRef.current.get(tab.id) === serialized) return;
      persistedWorkspaceViewsRef.current.set(tab.id, serialized);
      void withServiceFallback(
        () => updateWorkspaceView(tab.id, patch, tab.controller),
        null,
      );
    });
    Array.from(persistedWorkspaceViewsRef.current.keys()).forEach((workspaceId) => {
      if (!liveWorkspaceIds.has(workspaceId)) {
        persistedWorkspaceViewsRef.current.delete(workspaceId);
      }
    });
  }, [bootstrapReady, state.tabs]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!slashMenuRef.current?.contains(event.target as Node)) {
        setSlashMenuOpen(false);
        setSlashMenuPaneId(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSlashMenuOpen(false);
        setSlashMenuPaneId(null);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [slashMenuOpen]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    requestAnimationFrame(() => {
      commandPaletteInputRef.current?.focus();
      commandPaletteInputRef.current?.select();
    });
  }, [commandPaletteOpen]);

  useEffect(() => {
    if (state.overlay.visible) {
      closeCommandPalette();
    }
  }, [state.overlay.visible]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

  useEffect(() => {
    if (!overlayCanUseWsl && stateRef.current.overlay.target.type === "wsl") {
      updateState((current) => ({
        ...current,
        overlay: { ...current.overlay, target: { type: "native" } }
      }));
    }
  }, [overlayCanUseWsl]);

  useEffect(() => {
    if (!state.overlay.visible || state.overlay.mode === "local") return;
    updateState((current) => ({
      ...current,
      overlay: {
        ...current.overlay,
        mode: "local",
        input: "",
      },
    }));
  }, [state.overlay.mode, state.overlay.visible]);

  useEffect(() => {
    if (!bootstrapReady || !state.overlay.visible) return;
    const command = getTargetClaudeCommand(state.overlay.target);
    const targetKey = serializeRuntimeValidationKey(state.overlay.target, command);
    if (validatedRuntimeTargetsRef.current.has(targetKey)) {
      return;
    }
    void runRuntimeValidation(state.overlay.target);
  }, [
    bootstrapReady,
    getTargetClaudeCommand,
    runRuntimeValidation,
    state.overlay.target.type,
    state.overlay.target.type === "wsl" ? state.overlay.target.distro : "",
    state.overlay.visible,
  ]);

  const activeTab = useMemo(() => {
    const existing = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
    if (existing) return existing;
    if (!emptyTabRef.current) {
      const fallback = createTab(1, locale);
      emptyTabRef.current = {
        ...fallback,
        agent: {
          ...fallback.agent,
          provider: appSettings.agentProvider,
          command: resolveTargetClaudeCommand(appSettings, { type: "native" }),
        },
        idlePolicy: { ...appSettings.idlePolicy },
      };
    }
    return emptyTabRef.current;
  }, [appSettings, locale, state.activeTabId, state.tabs]);
  const overlayVisible = bootstrapReady && state.overlay.visible;
  const overlayCommand = getTargetClaudeCommand(state.overlay.target);
  const runtimeValidationTargetKey = serializeRuntimeValidationKey(state.overlay.target, overlayCommand);
  const runtimeValidatedForTarget = validatedRuntimeTargetsRef.current.has(runtimeValidationTargetKey);
  const runtimeValidationView = runtimeValidation.targetKey === runtimeValidationTargetKey
    ? runtimeValidation
    : createRuntimeValidationState(overlayCommand, t, runtimeValidationTargetKey, "checking");
  const showRuntimeValidationOverlay = overlayVisible && !runtimeValidatedForTarget;
  const showWorkspaceLaunchOverlay = overlayVisible && runtimeValidatedForTarget;
  const hasOpenWorkspace = state.tabs.length > 0;
  const showCodePanel = state.layout.showCodePanel;
  const showTerminalPanel = state.layout.showTerminalPanel;

  const activeSession = useMemo(
    () => activeTab.sessions.find((s) => s.id === activeTab.activeSessionId) ?? activeTab.sessions[0],
    [activeTab]
  );
  const activePaneSessionId = useMemo(
    () => findPaneSessionId(activeTab.paneLayout, activeTab.activePaneId) ?? activeTab.activeSessionId,
    [activeTab]
  );
  const activePaneSession = useMemo(
    () => activeTab.sessions.find((session) => session.id === activePaneSessionId) ?? activeSession,
    [activePaneSessionId, activeSession, activeTab.sessions]
  );
  const activeTabSessionIdsKey = useMemo(
    () => activeTab.sessions.map((session) => session.id).join("|"),
    [activeTab.sessions]
  );
  const mountedSessionIds = useMemo(
    () => new Set(collectPaneLeaves(activeTab.paneLayout).map((leaf) => leaf.sessionId)),
    [activeTab.paneLayout]
  );
  const historyGroups = useMemo(
    () => groupSessionHistory(historyRecords, activeTab.id),
    [activeTab.id, historyRecords]
  );
  const restoreCandidates = useMemo(
    () => listRestoreCandidatesForWorkspace({
      workspaceId: activeTab.id,
      mountedSessionIds,
      records: historyRecords,
    }),
    [activeTab.id, activeTabSessionIdsKey, historyRecords, mountedSessionIds]
  );
  const fileSearchQuery = fileSearchState.query;
  const fileSearchActiveIndex = fileSearchState.activeIndex;
  const fileSearchDropdownStyle = fileSearchState.dropdownStyle;
  const normalizedFileSearchQuery = normalizeWorkspaceFileSearchQuery(fileSearchState.query);
  const fileSearchResults = useMemo(
    () => buildWorkspaceFileSearchResults(activeTab.fileTree, activeTab.project?.path, fileSearchState.query),
    [activeTab.fileTree, activeTab.project?.path, fileSearchState.query]
  );
  const showFileSearchDropdown = shouldShowWorkspaceFileSearchDropdown(fileSearchState);
  const controllerWorkspaceId = routeWorkspaceId ?? activeTab.id;
  const isObserverMode = activeTab.controller.role === "observer";
  const hasControllerTakeoverPending = activeTab.controller.takeoverPending && activeTab.controller.takeoverRequestedBySelf;
  const hasOptimisticTakeoverPending = optimisticTakeoverWorkspaceId === controllerWorkspaceId
    && isObserverMode
    && !hasControllerTakeoverPending;
  const hasSelfTakeoverPending = hasControllerTakeoverPending || hasOptimisticTakeoverPending;
  const isTakeoverRequesting = isObserverMode && controllerActionBusy === "takeover" && !hasSelfTakeoverPending;
  const hasIncomingTakeoverRequest = activeTab.controller.role === "controller"
    && activeTab.controller.takeoverPending
    && !activeTab.controller.takeoverRequestedBySelf;

  const addToast = useCallback((toast: Toast) => {
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 4000);
  }, []);

  const onRequestWorkspaceTakeover = useCallback(async () => {
    if (!controllerWorkspaceId || controllerActionBusy) return;
    setControllerActionBusy("takeover");
    try {
      const controller = await requestWorkspaceTakeover(controllerWorkspaceId, deviceId, clientId);
      updateState((current) => applyWorkspaceControllerEvent(current, {
        workspace_id: controllerWorkspaceId,
        controller,
      }, deviceId, clientId));
      const nextController = createWorkspaceControllerStateFromLease(controller, deviceId, clientId);
      setOptimisticTakeoverWorkspaceId(
        nextController.role === "controller" || (nextController.takeoverPending && nextController.takeoverRequestedBySelf)
          ? null
          : controllerWorkspaceId,
      );
    } catch (error) {
      setOptimisticTakeoverWorkspaceId(null);
      const detail = error instanceof Error ? error.message : String(error);
      addToast({
        id: createId("toast"),
        text: `${t("workspaceTakeoverRequestFailed")}: ${detail}`,
        sessionId: activeSession.id,
      });
    } finally {
      setControllerActionBusy(null);
    }
  }, [activeSession.id, addToast, clientId, controllerActionBusy, controllerWorkspaceId, deviceId, t, updateState]);

  const onRejectWorkspaceTakeover = useCallback(async () => {
    if (!controllerWorkspaceId || controllerActionBusy) return;
    setControllerActionBusy("reject");
    try {
      const controller = await withServiceFallback(
        () => rejectWorkspaceTakeover(controllerWorkspaceId, deviceId, clientId),
        null,
      );
      if (!controller) return;
      updateState((current) => applyWorkspaceControllerEvent(current, {
        workspace_id: controllerWorkspaceId,
        controller,
      }, deviceId, clientId));
    } finally {
      setControllerActionBusy(null);
    }
  }, [clientId, controllerActionBusy, controllerWorkspaceId, deviceId, updateState]);

  useEffect(() => {
    if (optimisticTakeoverWorkspaceId !== controllerWorkspaceId) {
      return;
    }
    if (!isObserverMode || hasControllerTakeoverPending) {
      setOptimisticTakeoverWorkspaceId(null);
    }
  }, [controllerWorkspaceId, hasControllerTakeoverPending, isObserverMode, optimisticTakeoverWorkspaceId]);

  useEffect(() => {
    setFileSearchState((current) => syncWorkspaceFileSearchState(current, fileSearchResults.length));
  }, [fileSearchResults.length, normalizedFileSearchQuery]);

  useEffect(() => {
    if (!showFileSearchDropdown) {
      setFileSearchState((current) => withWorkspaceFileSearchDropdownStyle(current, null));
      return;
    }

    const updateDropdownPosition = () => {
      const anchor = fileSearchShellRef.current;
      if (!anchor) return;
      setFileSearchState((current) => withWorkspaceFileSearchDropdownStyle(
        current,
        resolveWorkspaceFileSearchDropdownStyle(anchor.getBoundingClientRect(), window.innerWidth, window.innerHeight)
      ));
    };

    updateDropdownPosition();
    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);

    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [showFileSearchDropdown, state.layout.rightWidth, showCodePanel, isCodeExpanded]);

  useEffect(() => {
    if (!showFileSearchDropdown) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (fileSearchShellRef.current?.contains(target)) return;
      if ((target as Element).closest?.(".workspace-search-dropdown")) return;
      setFileSearchState((current) => closeWorkspaceFileSearch(current));
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [showFileSearchDropdown]);

  const displayWorkspaceTitle = (value: string) => localizeWorkspaceTitle(value, locale);
  const displaySessionTitle = (value: string) => localizeSessionTitle(value, locale);
  const displayTerminalTitle = (value: string) => localizeTerminalTitle(value, locale);
  const hasPreviewFile = Boolean(activeTab.filePreview.path);

  const archivedEntry = activeTab.viewingArchiveId
    ? activeTab.archive.find((entry) => entry.id === activeTab.viewingArchiveId)
    : undefined;
  const sessionForView = archivedEntry ? archivedEntry.snapshot : activeSession;
  const isArchiveView = Boolean(archivedEntry);
  const viewedSession = isArchiveView ? sessionForView : activeSession;
  const viewedSessionPlainStream = stripAnsi(viewedSession.stream);

  useEffect(() => {
    updateTab(activeTab.id, (tab) => {
      const leaves = collectPaneLeaves(tab.paneLayout);
      const covered = new Set(leaves.map((leaf) => leaf.sessionId));
      const missingSessions = tab.sessions.filter((session) => !covered.has(session.id));
      if (missingSessions.length === 0) return tab;

      let nextLayout = tab.paneLayout;
      missingSessions.forEach((session) => {
        const nextLeaf = createPaneLeaf(session.id);
        nextLayout = {
          type: "split",
          id: createId("split"),
          axis: "vertical",
          ratio: 0.5,
          first: nextLayout,
          second: nextLeaf
        };
      });

      const nextActivePaneId = findPaneIdBySessionId(nextLayout, tab.activeSessionId)
        ?? collectPaneLeaves(nextLayout)[0]?.id
        ?? tab.activePaneId;

      return {
        ...tab,
        paneLayout: nextLayout,
        activePaneId: nextActivePaneId
      };
    });
  }, [activeTab.id, activeTabSessionIdsKey]);

  const invokeAgent = async <T,>(operation: () => Promise<T>, sessionId: string, label: string) => {
    try {
      return await operation();
    } catch (error) {
      addToast({
        id: createId("toast"),
        text: `${label}: ${String(error)}`,
        sessionId
      });
      return null;
    }
  };

  const loadSlashSkills = async (cwd?: string) => {
    setSlashMenuLoading(true);
    const items = await withServiceFallback(
      () => listClaudeSlashSkills(cwd ?? activeTab.project?.path ?? ""),
      []
    );
    setSlashSkillItems(items);
    setSlashMenuLoading(false);
  };

  const updateTab = (tabId: string, updater: (tab: Tab) => Tab) => {
    updateState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab))
    }));
  };

  const guardWorkspaceMutation = (
    action:
      | "switch_session"
      | "switch_pane"
      | "switch_terminal"
      | "resize_terminal"
      | "shell_input"
      | "agent_input"
      | "close_session"
      | "close_terminal"
      | "close_workspace"
      | "create_terminal",
    tabId = stateRef.current.activeTabId,
    sessionId = activeSession.id,
  ) => {
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    if (canMutateWorkspace(tab?.controller, action)) {
      return true;
    }
    addToast({
      id: createId("toast"),
      text: t("workspaceReadOnlyToast"),
      sessionId,
    });
    return false;
  };

  const {
    archiveSessionForTab,
    createDraftSessionForTab,
    deleteSessionFromHistory,
    materializeSession,
    onCloseAgentPane: closeAgentPaneSession,
    onNewSession: createNewSessionInActiveTab,
    onSwitchSession: switchSessionInActiveTab,
    restoreSessionIntoPane,
    syncSessionPatch,
    touchSession
  } = createWorkspaceSessionActions({
    appSettings,
    locale,
    t,
    stateRef,
    updateTab,
    withServiceFallback,
    addToast,
  });

  const onNewSession = async () => {
    if (!guardWorkspaceMutation("switch_session")) return;
    await createNewSessionInActiveTab();
  };

  const { refreshWorkspaceArtifacts } = useWorkspaceArtifactsSync({
    activeTabId: activeTab.id,
    activeProjectPath: activeTab.project?.path,
    bootstrapReady,
    codeSidebarView,
    stateRef,
    updateTab,
    withServiceFallback,
  });

  const ensureWorkspaceTerminal = useCallback(async (workspaceId: string) => {
    const tab = stateRef.current.tabs.find((item) => item.id === workspaceId);
    if (!tab?.project?.path || tab.terminals.length > 0) return;
    if (!canMutateWorkspace(tab.controller, "create_terminal")) return;
    if (autoTerminalWorkspaceIdsRef.current.has(workspaceId)) return;
    if (stateRef.current.activeTabId !== workspaceId) return;
    if (!stateRef.current.layout.showTerminalPanel || isCodeExpanded) return;

    const initialSize = measureWorkspaceTerminalSize();
    if (!initialSize) return;

    autoTerminalWorkspaceIdsRef.current.add(workspaceId);
    const created = await addWorkspaceTerminal({
      tab,
      locale,
      updateTab,
      withServiceFallback,
      addToast,
      activeSessionId: tab.activeSessionId,
      createToastId: () => createId("toast"),
      t,
      initialSize,
    });
    if (!created) {
      autoTerminalWorkspaceIdsRef.current.delete(workspaceId);
    }
  }, [isCodeExpanded, locale, measureWorkspaceTerminalSize, t]);

  const switchWorkspaceLocally = (workspaceId: string) => {
    updateState((current) => {
      const targetTab = current.tabs.find((tab) => tab.id === workspaceId);
      if (!targetTab) return current;
      const previousActiveTabId = current.activeTabId;
      return {
        ...current,
        activeTabId: workspaceId,
        overlay: {
          ...current.overlay,
          visible: false,
        },
        tabs: current.tabs.map((tab) => {
          if (tab.id === workspaceId) {
            return {
              ...tab,
              sessions: tab.sessions.map((session) =>
                session.id === tab.activeSessionId
                  ? { ...session, unread: 0, status: restoreVisibleStatus(session), lastActiveAt: Date.now() }
                  : session
              )
            };
          }
          if (tab.id === previousActiveTabId) {
            return {
              ...tab,
              sessions: tab.sessions.map((session) =>
                session.id === tab.activeSessionId ? { ...session, status: toBackgroundStatus(session.status) } : session
              )
            };
          }
          return tab;
        })
      };
    });
  };

  const onAddTab = () => {
    updateState((current) => ({
      ...current,
      overlay: {
        ...current.overlay,
        visible: true,
        mode: "local",
        input: "",
        target: current.overlay.target,
      },
    }));
    if (!hasOpenWorkspace) {
      navigate("/workspace", { replace: true });
    }
  };

  const onRemoveTab = async (tabId: string) => {
    const currentTabs = stateRef.current.tabs;
    const currentIndex = currentTabs.findIndex((tab) => tab.id === tabId);
    if (currentIndex === -1) return;
    if (!guardWorkspaceMutation("close_workspace", tabId)) return;
    const remainingIds = currentTabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id);
    const fallbackActiveId = stateRef.current.activeTabId === tabId
      ? (remainingIds[Math.max(0, currentIndex - 1)] ?? remainingIds[0] ?? null)
      : stateRef.current.activeTabId;
    const fallbackUiState = {
      open_workspace_ids: remainingIds,
      active_workspace_id: fallbackActiveId,
      layout: workbenchLayoutToBackend(stateRef.current.layout),
    };
    const uiState = await withServiceFallback(
      () => closeWorkspaceRequest(tabId, currentTabs[currentIndex].controller),
      fallbackUiState,
    );
    autoTerminalWorkspaceIdsRef.current.delete(tabId);
    updateState((current) => {
      const next = applyWorkbenchUiState(current, uiState);
      return {
        ...next,
        overlay: {
          ...next.overlay,
          visible: next.tabs.length === 0,
        },
      };
    });
    if (uiState.active_workspace_id) {
      void refreshHistoryRecords();
      navigate(`/workspace/${uiState.active_workspace_id}`);
      void ensureWorkspaceTerminal(uiState.active_workspace_id);
      return;
    }
    void refreshHistoryRecords();
    navigate("/workspace");
  };

  const onSwitchWorkspace = (tabId: string) => {
    const targetTab = stateRef.current.tabs.find((tab) => tab.id === tabId);
    if (!targetTab) return;
    switchWorkspaceLocally(tabId);
    navigate(`/workspace/${tabId}`);
    void withServiceFallback(
      () => activateWorkspaceRequest(tabId, deviceId, clientId),
      null,
    ).then((uiState) => {
      if (!uiState) return;
      updateState((current) => applyWorkbenchUiState(current, uiState));
    });
    void ensureWorkspaceTerminal(tabId);
  };

  const ensureWorkspaceReady = async (workspaceId: string) => {
    let nextTab: Tab | null = null;
    const uiState = await withServiceFallback(
      () => activateWorkspaceRequest(workspaceId, deviceId, clientId),
      null,
    );
    if (!uiState) return null;

    const runtimeSnapshot = await attachWorkspaceRuntimeWithRetry(
      workspaceId,
      deviceId,
      clientId,
      withServiceFallback,
    );

    if (runtimeSnapshot) {
      updateState((current) => {
        const next = applyWorkspaceRuntimeSnapshot(
          current,
          runtimeSnapshot,
          locale,
          appSettings,
          deviceId,
          clientId,
          uiState,
        );
        nextTab = next.tabs.find((tab) => tab.id === workspaceId) ?? null;
        return next;
      });
    } else {
      const snapshot = await withServiceFallback(() => getWorkspaceSnapshot(workspaceId), null);
      if (snapshot) {
        updateState((current) => {
          const next = upsertWorkspaceSnapshot(current, snapshot, locale, appSettings, uiState);
          nextTab = next.tabs.find((tab) => tab.id === workspaceId) ?? null;
          return next;
        });
      } else {
        updateState((current) => {
          const next = applyWorkbenchUiState(current, uiState);
          nextTab = next.tabs.find((tab) => tab.id === workspaceId) ?? null;
          return next;
        });
      }
    }

    navigate(`/workspace/${workspaceId}`, { replace: true });
    return nextTab ?? stateRef.current.tabs.find((tab) => tab.id === workspaceId) ?? null;
  };

  const onToggleHistory = () => {
    if (!historyOpen) {
      setHistoryExpandedGroups(createInitialHistoryExpansion(historyGroups, activeTab.id));
    }
    setHistoryOpen((open) => !open);
  };

  useEffect(() => {
    if (!historyOpen) return;

    setHistoryExpandedGroups((current) => {
      const defaults = createInitialHistoryExpansion(historyGroups, activeTab.id);
      const next = historyGroups.reduce<Record<string, boolean>>((expansion, group) => {
        expansion[group.workspaceId] = Object.prototype.hasOwnProperty.call(current, group.workspaceId)
          ? current[group.workspaceId]
          : defaults[group.workspaceId];
        return expansion;
      }, {});

      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      const changed = currentKeys.length !== nextKeys.length
        || nextKeys.some((workspaceId) => current[workspaceId] !== next[workspaceId]);

      return changed ? next : current;
    });
  }, [activeTab.id, historyGroups, historyOpen]);

  const handleHistoryRecordSelect = async (record: SessionHistoryRecord) => {
    const targetTab = await ensureWorkspaceReady(record.workspaceId);
    if (!targetTab) return;

    const currentTab = stateRef.current.tabs.find((tab) => tab.id === record.workspaceId) ?? targetTab;
    const action = selectHistoryPrimaryAction(record);
    if (action === "focus" && currentTab.sessions.some((session) => session.id === record.sessionId)) {
      switchSessionInActiveTab(currentTab, record.sessionId);
      setHistoryOpen(false);
      return;
    }

    const restored = await restoreSessionIntoPane(record.workspaceId, record.sessionId);
    if (!restored) return;
    void refreshHistoryRecords();
    setHistoryOpen(false);
  };

  const handleHistoryRecordDelete = async (record: SessionHistoryRecord) => {
    const confirmed = typeof window === "undefined"
      ? true
      : window.confirm(t("historyDeleteConfirm", { title: record.title }));
    if (!confirmed) return;

    const deleted = await deleteSessionFromHistory(record.workspaceId, record.sessionId);
    if (!deleted) return;

    await refreshHistoryRecords();
  };

  const onCycleWorkspace = (direction: number) => {
    const tabs = stateRef.current.tabs;
    if (tabs.length < 2) return;
    const activeIndex = tabs.findIndex((tab) => tab.id === stateRef.current.activeTabId);
    if (activeIndex < 0) return;
    const delta = direction >= 0 ? 1 : -1;
    const nextIndex = (activeIndex + delta + tabs.length) % tabs.length;
    onSwitchWorkspace(tabs[nextIndex].id);
  };

  const onOverlayUpdateTarget = (target: ExecTarget) => {
    updateState((current) => updateWorkspaceOverlayTarget(current, target));
  };

  const browseOverlayDirectory = useCallback(async (target: ExecTarget, path?: string, selectCurrent = false) => {
    await browseWorkspaceOverlayDirectory({
      target,
      path,
      selectCurrent,
      locale,
      t,
      setFolderBrowser,
      setOverlayCanUseWsl,
      updateOverlayInput: (value) => {
        updateState((current) => updateWorkspaceOverlayInput(current, value));
      }
    });
  }, [locale, t]);

  const onBrowseOverlayDirectory = (path?: string, selectCurrent = false) => {
    void browseOverlayDirectory(stateRef.current.overlay.target, path, selectCurrent);
  };

  useEffect(() => {
    if (!state.overlay.visible || state.overlay.mode !== "local") return;
    void browseOverlayDirectory(
      state.overlay.target,
      state.overlay.input || undefined,
      !state.overlay.input
    );
  }, [
    state.overlay.visible,
    state.overlay.mode,
    state.overlay.target.type,
    state.overlay.target.type === "wsl" ? state.overlay.target.distro : "",
    browseOverlayDirectory
  ]);

  const onStartWorkspace = async () => {
    const launched = await startWorkspaceLaunch({
      overlay: stateRef.current.overlay,
      locale,
      appSettings,
      deviceId,
      clientId,
      updateState,
      withServiceFallback,
      refreshWorkspaceArtifacts,
    });
    if (!launched) return;
    const runtimeSnapshot = await attachWorkspaceRuntimeWithRetry(
      launched.workspaceId,
      deviceId,
      clientId,
      withServiceFallback,
    );
    if (runtimeSnapshot) {
      updateState((current) => applyWorkspaceRuntimeSnapshot(
        current,
        runtimeSnapshot,
        locale,
        appSettings,
        deviceId,
        clientId,
      ));
    }
    navigate(`/workspace/${launched.workspaceId}`);
    void ensureWorkspaceTerminal(launched.workspaceId);
    if (launched.firstFile) {
      await onFileSelect(launched.firstFile, launched.workspaceId);
    }
  };

  const buildAgentCommand = (tab: Tab) => (
    resolveTargetClaudeCommand(appSettings, tab.project?.target ?? { type: "native" })
  );

  const agentStartMaybe = async (tab: Tab, session: Session, paneId?: string | null) => {
    if (!guardWorkspaceMutation("agent_input", tab.id, session.id)) return false;
    const project = tab.project;
    if (!project?.path) return false;
    const command = buildAgentCommand(tab);
    const target = project.target;
    const initialSize = resolveAgentInitialSize(paneId);
    const availability = await withServiceFallback<CommandAvailability | null>(
      () => checkCommandAvailability(command, target, project.path),
      null
    );
    if (availability && !availability.available) {
      addToast({
        id: createId("toast"),
        text: `${t("agentStartFailed")}: ${availability.error ?? t("launchCommandMissing", { runtime: formatExecTargetLabel(target, t) })}`,
        sessionId: session.id
      });
      return false;
    }
    const startupToken = armAgentStartupGate(agentRuntimeRefs, tab.id, session.id);
    const result = await invokeAgent<AgentStartResult>(() => startAgent({
      workspaceId: tab.id,
      controller: tab.controller,
      sessionId: session.id,
      provider: tab.agent.provider,
      cols: initialSize?.cols,
      rows: initialSize?.rows,
    }), session.id, t("agentStartFailed"));
    if (!result) {
      clearAgentStartupGate(agentRuntimeRefs, tab.id, session.id, startupToken);
      return false;
    }
    markAgentRuntimeStarted(agentRuntimeRefs, tab.id, session.id);
    if (!result.started) {
      clearAgentStartupGate(agentRuntimeRefs, tab.id, session.id, startupToken);
    }
    return {
      ok: true,
      started: result.started,
      startupToken: result.started ? startupToken : null
    };
  };

  const agentSend = async (tab: Tab, session: Session, input: string) => {
    if (!guardWorkspaceMutation("agent_input", tab.id, session.id)) return false;
    const lastActiveAt = Date.now();
    updateTab(tab.id, (current) => ({
      ...current,
      sessions: current.sessions.map((s) =>
        s.id === session.id ? { ...s, status: resolveVisibleStatus(current, s, "waiting"), lastActiveAt } : s
      )
    }));
    void syncSessionPatch(tab.id, session.id, { status: "waiting", last_active_at: lastActiveAt });
    const sent = await invokeAgent(
      () => sendAgentInput(tab.id, tab.controller, session.id, input, true),
      session.id,
      t("agentSendFailed")
    );
    return sent !== null;
  };

  const sendAgentRawChunk = async (tab: Tab, session: Session, input: string) => {
    if (!guardWorkspaceMutation("agent_input", tab.id, session.id)) return false;
    const lastActiveAt = Date.now();
    updateTab(tab.id, (current) => ({
      ...current,
      sessions: current.sessions.map((item) =>
        item.id === session.id ? { ...item, lastActiveAt } : item
      )
    }));
    void syncSessionPatch(tab.id, session.id, { last_active_at: lastActiveAt });
    const sent = await invokeAgent(
      () => sendAgentInput(tab.id, tab.controller, session.id, input, false),
      session.id,
      t("agentKeySendFailed")
    );
    return sent !== null;
  };

  const sendRawAgentInput = async (tab: Tab, session: Session, input: string) => {
    if (!guardWorkspaceMutation("agent_input", tab.id, session.id)) return;
    const lastActiveAt = Date.now();
    updateTab(tab.id, (current) => ({
      ...current,
      sessions: current.sessions.map((item) =>
        item.id === session.id ? { ...item, lastActiveAt } : item
      )
    }));
    void syncSessionPatch(tab.id, session.id, { last_active_at: lastActiveAt });
    const started = await agentStartMaybe(tab, session);
    if (!started) return;
    if (started.started && started.startupToken !== null) {
      await waitForAgentStartupDrain(agentRuntimeRefs, tab.id, session.id, started.startupToken);
    }
    await sendAgentRawChunk(tab, session, input);
  };

  const onRecoverActiveSession = async () => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    const session = currentTab.sessions.find((item) => item.id === activePaneSession.id) ?? activePaneSession;
    const started = await agentStartMaybe(currentTab, session, currentTab.activePaneId);
    if (!started) return;
    if (started.started && started.startupToken !== null) {
      await waitForAgentStartupDrain(agentRuntimeRefs, currentTab.id, session.id, started.startupToken);
    }
  };

  const onSwitchSession = (sessionId: string) => {
    if (!guardWorkspaceMutation("switch_session")) return;
    switchSessionInActiveTab(activeTab, sessionId);
  };

  const onCloseAgentPane = (paneId: string, sessionId: string) => {
    if (!guardWorkspaceMutation("close_session", activeTab.id, sessionId)) return;
    closeAgentPaneSession(activeTab, paneId, sessionId);
    window.setTimeout(() => {
      void refreshHistoryRecords();
    }, 0);
  };

  const onArchiveSession = async (sessionId: string) => {
    if (!guardWorkspaceMutation("close_session", activeTab.id, sessionId)) return;
    await archiveSessionForTab(activeTab.id, sessionId);
    void refreshHistoryRecords();
  };

  const onDraftPaneModeChange = (paneId: string, mode: "new" | "restore") => {
    setDraftPaneModes((current) => ({
      ...current,
      [paneId]: mode,
    }));
  };

  const onRestoreDraftSession = (paneId: string, sessionId: string) => {
    void restoreSessionIntoPane(activeTab.id, sessionId, paneId).then((restored) => {
      if (!restored) return;
      void refreshHistoryRecords();
    });
  };

  const onSelectArchive = (entryId: string) => {
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      viewingArchiveId: entryId
    }));
  };

  const onExitArchive = () => {
    updateTab(activeTab.id, (tab) => ({ ...tab, viewingArchiveId: undefined }));
  };

  const onFileSelect = async (node: TreeNode, workspaceId?: string) => {
    if (node.kind !== "file") return;
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === (workspaceId ?? activeTab.id)) ?? activeTab;
    if (!guardWorkspaceMutation("switch_pane", currentTab.id)) return;
    const segments = node.path.split(/[\/]+/).filter(Boolean);
    if (segments.length > 1) {
      setRepoCollapsedPaths((current) => {
        const next = new Set(current);
        let prefix = "";
        for (const segment of segments.slice(0, -1)) {
          prefix = prefix ? `${prefix}/${segment}` : segment;
          next.add(prefix);
        }
        return next;
      });
    }

    await loadWorkspaceFilePreview({
      tab: currentTab,
      node,
      updateTab,
      withServiceFallback,
      t,
    });
    setSelectedGitChangeKey("");
    setPreviewMode("preview");
  };

  const openPreviewPath = async (path: string, options?: { clearGitSelection?: boolean; statusLabel?: string; parentPath?: string }) => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    if (!guardWorkspaceMutation("switch_pane", currentTab.id)) return;
    await openWorkspacePreviewPath({
      tab: currentTab,
      path,
      updateTab,
      withServiceFallback,
      t,
      options,
    });
    if (options?.clearGitSelection ?? false) {
      setSelectedGitChangeKey("");
    }
    setPreviewMode("preview");
  };

  const onFileSearchSelect = async (node: TreeNode) => {
    setFileSearchState((current) => resetWorkspaceFileSearch(current));
    setCodeSidebarView("files");
    await onFileSelect(node);
    requestAnimationFrame(() => {
      fileSearchInputRef.current?.blur();
    });
  };

  const onFileSearchBlur = () => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof Node && fileSearchShellRef.current?.contains(active)) return;
      setFileSearchState((current) => closeWorkspaceFileSearch(current));
    });
  };

  const onFileSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!normalizedFileSearchQuery) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFileSearchState((current) => moveWorkspaceFileSearchIndex(current, 1, fileSearchResults.length));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFileSearchState((current) => moveWorkspaceFileSearchIndex(current, -1, fileSearchResults.length));
      return;
    }

    if (event.key === "Enter") {
      if (!fileSearchResults.length) return;
      event.preventDefault();
      void onFileSearchSelect((fileSearchResults[fileSearchActiveIndex] ?? fileSearchResults[0]).node);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setFileSearchState((current) => closeWorkspaceFileSearch(current));
    }
  };

  const onGitChangeSelect = async (change: GitChangeEntry) => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    if (!guardWorkspaceMutation("switch_pane", currentTab.id)) return;
    const nextKey = await loadWorkspaceGitChangePreview({
      tab: currentTab,
      change,
      updateTab,
      withServiceFallback,
    });
    setPreviewMode("diff");
    setSelectedGitChangeKey(nextKey);
  };

  const onGitChangeAction = async (change: GitChangeEntry, action: GitChangeAction) => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    if (!guardWorkspaceMutation("switch_pane", currentTab.id)) return;
    const relativePath = sanitizeGitRelativePath(change.path);
    const basePayload = {
      workspaceId: currentTab.id,
      controller: currentTab.controller,
      path: currentTab.project?.path ?? "",
      target: currentTab.project?.target ?? { type: "native" },
      filePath: relativePath,
    };

    if (action === "stage") {
      await invokeGitAction(() => stageGitFile(
        basePayload.workspaceId,
        basePayload.controller,
        basePayload.path,
        basePayload.target,
        basePayload.filePath,
      ));
      return;
    }
    if (action === "unstage") {
      await invokeGitAction(() => unstageGitFile(
        basePayload.workspaceId,
        basePayload.controller,
        basePayload.path,
        basePayload.target,
        basePayload.filePath,
      ));
      return;
    }
    await invokeGitAction(() => discardGitFile(
      basePayload.workspaceId,
      basePayload.controller,
      basePayload.path,
      basePayload.target,
      basePayload.filePath,
      change.section,
    ));
  };

  const onPreviewEdit = (content: string) => {
    if (!guardWorkspaceMutation("switch_pane")) return;
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      filePreview: {
        ...tab.filePreview,
        content,
        dirty: true,
      },
    }));
  };

  const onPreviewMode = async (mode: "preview" | "diff") => {
    if (!guardWorkspaceMutation("switch_pane")) return;
    setPreviewMode(mode);
    if (mode === "preview") return;
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    await refreshWorkspaceArtifacts(currentTab.id);
    await loadWorkspaceRepositoryDiff({
      tab: currentTab,
      updateTab,
      withServiceFallback,
    });
  };

  const onSavePreview = async () => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    if (!guardWorkspaceMutation("switch_pane", currentTab.id)) return;
    await saveWorkspacePreview({
      tab: currentTab,
      activeSessionId: activeSession.id,
      updateTab,
      withServiceFallback,
      refreshWorkspaceArtifacts,
      addToast,
      t,
      createToastId: () => createId("toast"),
    });
  };

  const invokeGitAction = async (operation: () => Promise<unknown>) => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    return performWorkspaceGitOperation({
      tab: currentTab,
      activeSessionId: activeSession.id,
      selectedGitChangeKey,
      previewMode,
      updateTab,
      refreshWorkspaceArtifacts,
      onSelectGitChange: async (change) => {
        await onGitChangeSelect(change);
      },
      onReloadRepositoryDiff: async () => {
        await onPreviewMode("diff");
      },
      onClearPreviewSelection: () => {
        setSelectedGitChangeKey("");
        setPreviewMode("preview");
      },
      addToast,
      t,
      createToastId: () => createId("toast"),
      getCurrentTab: (tabId) => stateRef.current.tabs.find((tab) => tab.id === tabId),
      operation,
    });
  };

  const onGitStageAll = async () => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    if (!guardWorkspaceMutation("switch_pane", currentTab.id)) return;
    await invokeGitAction(() => stageAllGitChanges(
      currentTab.id,
      currentTab.controller,
      currentTab.project?.path ?? "",
      currentTab.project?.target ?? { type: "native" },
    ));
  };

  const onGitUnstageAll = async () => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    if (!guardWorkspaceMutation("switch_pane", currentTab.id)) return;
    await invokeGitAction(() => unstageAllGitChanges(
      currentTab.id,
      currentTab.controller,
      currentTab.project?.path ?? "",
      currentTab.project?.target ?? { type: "native" },
    ));
  };

  const onGitDiscardAll = async () => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    if (!guardWorkspaceMutation("switch_pane", currentTab.id)) return;
    const ok = await invokeGitAction(() => discardAllGitChanges(
      currentTab.id,
      currentTab.controller,
      currentTab.project?.path ?? "",
      currentTab.project?.target ?? { type: "native" },
    ));
    if (ok) {
      updateTab(currentTab.id, (tab) => ({
        ...tab,
        filePreview: createEmptyPreview(),
      }));
      setPreviewMode("preview");
    }
  };

  const onGitCommit = async () => {
    if (!commitMessage.trim()) return;
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    if (!guardWorkspaceMutation("switch_pane", currentTab.id)) return;
    const ok = await invokeGitAction(() => commitGitChanges(
      currentTab.id,
      currentTab.controller,
      currentTab.project?.path ?? "",
      currentTab.project?.target ?? { type: "native" },
      commitMessage.trim(),
    ));
    if (ok) {
      setCommitMessage("");
      addToast({
        id: createId("toast"),
        text: t("gitCommitSucceeded"),
        sessionId: activeSession.id,
      });
    }
  };

  const onAddTerminal = async () => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    if (!guardWorkspaceMutation("create_terminal", currentTab.id)) return;
    const initialSize = measureWorkspaceTerminalSize();
    await addWorkspaceTerminal({
      tab: currentTab,
      locale,
      updateTab,
      withServiceFallback,
      addToast,
      activeSessionId: activeSession.id,
      createToastId: () => createId("toast"),
      t,
      initialSize,
    });
  };

  const onTerminalSelect = (terminalId: string) => {
    if (!guardWorkspaceMutation("switch_terminal")) return;
    selectWorkspaceTerminal(updateTab, activeTab.id, terminalId);
  };

  const onCloseTerminal = async (terminalId: string) => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    if (!guardWorkspaceMutation("close_terminal", currentTab.id)) return;
    await closeWorkspaceTerminal(currentTab, terminalId, updateTab, withServiceFallback);
  };

  const onOpenWorktree = async (tree: WorktreeInfo) => {
    if (!guardWorkspaceMutation("switch_pane")) return;
    await openWorkspaceWorktree({
      tree,
      target: activeTab.project?.target ?? { type: "native" },
      fallbackTree: activeTab.fileTree,
      fallbackChanges: activeTab.changesTree,
      setWorktreeView,
      setWorktreeModal,
      withServiceFallback,
    });
  };

  const onResizeStart = (type: "left" | "right-split") => (event: React.PointerEvent) => {
    startWorkspacePanelResize({
      event,
      type,
      stateRef,
      updateState,
      shellTerminalRef,
      scheduleFitAgentTerminals: scheduleWorkspaceAgentFit,
      flushFitAgentTerminals: flushWorkspaceAgentFit,
    });
  };

  const toggleRightPane = (pane: "code" | "terminal") => {
    updateState((current) => toggleWorkspaceRightPane(current, pane));
    if (pane === "code") {
      setIsCodeExpanded(false);
    }
    requestAnimationFrame(() => {
      shellTerminalRef.current?.fit();
    });
  };

  const activeTerminal = activeTab.terminals.find((t) => t.id === activeTab.activeTerminalId) ?? activeTab.terminals[0];
  const showAgentPanel = !isCodeExpanded;

  const toggleCodeExpanded = async () => {
    if (isCodeExpanded) {
      if (codeSidebarView === "git" && activeTab.filePreview.mode === "diff" && activeTab.filePreview.path) {
        await openPreviewPath(activeTab.filePreview.path, {
          clearGitSelection: false,
          statusLabel: activeTab.filePreview.statusLabel,
          parentPath: activeTab.filePreview.parentPath
        });
      }
      setCodeSidebarView("files");
    }
    setIsCodeExpanded((value) => !value);
  };

  const setActivePane = (paneId: string, sessionId: string) => {
    if (!guardWorkspaceMutation("switch_pane", activeTab.id, sessionId)) return;
    activateWorkspacePane(updateTab, activeTab.id, paneId, sessionId);
  };

  const splitPane = (paneId: string, axis: "horizontal" | "vertical") => {
    if (!guardWorkspaceMutation("switch_pane")) return;
    splitWorkspacePane({
      tab: activeTab,
      paneId,
      axis,
      updateTab,
      createDraftSessionForTab,
      onFocusPane: focusWorkspaceAgentPane,
    });
  };

  const onPaneSplitResizeStart = (splitId: string, axis: "horizontal" | "vertical") => (event: React.PointerEvent<HTMLDivElement>) => {
    startWorkspacePaneSplitResize({
      event,
      tabId: activeTab.id,
      paneLayout: activeTab.paneLayout,
      splitId,
      axis,
      updateTab,
      scheduleFitAgentTerminals: scheduleWorkspaceAgentFit,
      flushFitAgentTerminals: flushWorkspaceAgentFit,
    });
  };

  const onToggleSlashMenu = async (paneId: string) => {
    const nextOpen = !(slashMenuOpen && slashMenuPaneId === paneId);
    setSlashMenuPaneId(nextOpen ? paneId : null);
    setSlashMenuOpen(nextOpen);
    if (nextOpen) {
      await loadSlashSkills(activeTab.project?.path);
    }
  };

  const onSelectSlashMenuItem = (item: ClaudeSlashMenuItem) => {
    setSlashMenuOpen(false);
    setSlashMenuPaneId(null);
    void onAgentTerminalData(activeTab.activePaneId, `${item.command} `);
    focusWorkspaceAgentPane(activeTab.activePaneId);
  };

  const onRunCommandPaletteAction = (action: CommandPaletteAction | undefined) => {
    if (!action) return;
    closeCommandPalette();
    action.run();
  };

  const ensureAgentPaneSessionReady = async (paneId: string, firstInput = "") => {
    if (isArchiveView) return null;
    const activeTabSnapshot = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeTabId);
    if (!activeTabSnapshot) return null;
    const paneSessionId = findPaneSessionId(activeTabSnapshot.paneLayout, paneId) ?? activeTabSnapshot.activeSessionId;
    const activeSessionSnapshot = activeTabSnapshot.sessions.find((session) => session.id === paneSessionId);
    if (!activeSessionSnapshot) return null;

    const materialized = isDraftSession(activeSessionSnapshot)
      ? await materializeSession(activeTabSnapshot.id, activeSessionSnapshot.id, firstInput)
      : { tab: activeTabSnapshot, session: activeSessionSnapshot };
    const tabSnapshot = materialized?.tab ?? activeTabSnapshot;
    const sessionSnapshot = materialized?.session ?? activeSessionSnapshot;
    if (!tabSnapshot || !sessionSnapshot) return null;

    if (!isAgentRuntimeRunning(agentRuntimeRefs, tabSnapshot.id, sessionSnapshot.id)) {
      const started = await agentStartMaybe(tabSnapshot, sessionSnapshot, paneId);
      if (!started) return null;
      if (started.started) {
        syncAgentPaneSize(
          agentRuntimeRefs,
          paneId,
          tabSnapshot.controller,
          tabSnapshot.id,
          sessionSnapshot.id,
        );
      }
      if (started.started && started.startupToken !== null) {
        await waitForAgentStartupDrain(agentRuntimeRefs, tabSnapshot.id, sessionSnapshot.id, started.startupToken);
      }
    }

    syncAgentPaneSize(
      agentRuntimeRefs,
      paneId,
      tabSnapshot.controller,
      tabSnapshot.id,
      sessionSnapshot.id,
    );
    touchSession(tabSnapshot.id, sessionSnapshot.id);
    return { tab: tabSnapshot, session: sessionSnapshot };
  };

  const onAgentTerminalData = async (paneId: string, data: string) => {
    if (isArchiveView || !data) return;
    if (!guardWorkspaceMutation("agent_input")) return;
    const activeTabSnapshot = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeTabId);
    const paneSessionId = activeTabSnapshot
      ? (findPaneSessionId(activeTabSnapshot.paneLayout, paneId) ?? activeTabSnapshot.activeSessionId)
      : null;
    const currentSessionSnapshot = paneSessionId && activeTabSnapshot
      ? activeTabSnapshot.sessions.find((session) => session.id === paneSessionId) ?? null
      : null;
    const titleTracking = currentSessionSnapshot
      ? trackAgentInitialTitleInput(agentRuntimeRefs, paneId, currentSessionSnapshot, data)
      : { committedTitle: null, materializeTitle: "" };
    const currentQueue = agentTerminalQueueRef.current.get(paneId) ?? Promise.resolve();
    const nextQueue = currentQueue
      .catch(() => undefined)
      .then(async () => {
        const ready = await ensureAgentPaneSessionReady(paneId, titleTracking.materializeTitle);
        if (!ready) return;
        if (titleTracking.committedTitle) {
          commitTrackedAgentSessionTitle(paneId, ready.tab.id, ready.session.id, titleTracking.committedTitle);
        }
        await sendAgentRawChunk(ready.tab, ready.session, data);
      });
    agentTerminalQueueRef.current.set(paneId, nextQueue);
    await nextQueue;
  };

  const onSubmitDraftPrompt = async (paneId: string) => {
    if (!guardWorkspaceMutation("agent_input")) return;
    const content = (
      draftPromptInputRefs.current.get(paneId)?.value
      ?? draftPromptInputs[paneId]
      ?? ""
    ).trim();
    if (!content) return;
    setDraftPromptInputs((current) => ({
      ...current,
      [paneId]: ""
    }));
    await onAgentTerminalData(paneId, `${content}\r`);
  };

  const onSendSpecialAgentKey = async (paneId: string, sequence: string) => {
    if (!guardWorkspaceMutation("agent_input")) return;
    const ready = await ensureAgentPaneSessionReady(paneId);
    if (!ready) return;
    await sendAgentRawChunk(ready.tab, ready.session, sequence);
    focusWorkspaceAgentPane(paneId);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const hasModifier = event.metaKey || event.ctrlKey;
      const isEditableTarget = isTextInputTarget(event.target);

      if (hasModifier && key === "k") {
        event.preventDefault();
        if (commandPaletteOpen) {
          closeCommandPalette();
        } else {
          openCommandPalette();
          setSlashMenuOpen(false);
          setSlashMenuPaneId(null);
        }
        return;
      }

      if (commandPaletteOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeCommandPalette();
        }
        return;
      }

      if (hasModifier && key === "s") {
        if (!activeTab.filePreview.path) return;
        event.preventDefault();
        void onSavePreview();
        return;
      }

      if (hasModifier && key === "n") {
        event.preventDefault();
        onAddTab();
        return;
      }

      if (hasModifier && event.shiftKey && (event.key === "[" || event.key === "{")) {
        event.preventDefault();
        onCycleWorkspace(-1);
        return;
      }

      if (hasModifier && event.shiftKey && (event.key === "]" || event.key === "}")) {
        event.preventDefault();
        onCycleWorkspace(1);
        return;
      }

      if (!hasModifier && !event.altKey && !event.shiftKey && key === "f" && !isEditableTarget && !isArchiveView) {
        event.preventDefault();
        setIsFocusMode((value) => !value);
        return;
      }

      if (!hasModifier && !event.altKey && !event.shiftKey && event.key === "Escape" && isFocusMode) {
        event.preventDefault();
        setIsFocusMode(false);
        return;
      }

      if (isArchiveView) return;
      const isMacPlatform = typeof navigator !== "undefined" && (navigator.platform || "").toLowerCase().includes("mac");
      const isSplitShortcut = isMacPlatform
        ? event.metaKey && !event.ctrlKey && !event.altKey && key === "d"
        : event.altKey && !event.ctrlKey && !event.metaKey && key === "d";
      if (!isSplitShortcut) return;
      if (event.repeat) return;
      event.preventDefault();
      const splitAxis: "horizontal" | "vertical" = event.shiftKey ? "horizontal" : "vertical";
      splitPane(activeTab.activePaneId, splitAxis);
      setSlashMenuOpen(false);
      setSlashMenuPaneId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeTab.activePaneId,
    activeTab.filePreview.path,
    activeTab.filePreview.dirty,
    activeTab.filePreview.content,
    activeSession.id,
    commandPaletteOpen,
    isArchiveView,
    isFocusMode
  ]);

  useEffect(() => {
    if (!isArchiveView) {
      focusWorkspaceAgentPane();
    }
  }, [activeTab.activePaneId, activePaneSession.id, isArchiveView]);

  useEffect(() => {
    setCommitMessage("");
    setSelectedGitChangeKey("");
    setSlashMenuOpen(false);
    setSlashMenuPaneId(null);
  }, [activeTab.id]);

  useEffect(() => {
    if (!activeTab.project?.path) return;
    if (!showTerminalPanel || isCodeExpanded) return;
    void ensureWorkspaceTerminal(activeTab.id);
  }, [activeTab.id, activeTab.project?.path, ensureWorkspaceTerminal, isCodeExpanded, showTerminalPanel]);

  const onShellTerminalSize = useCallback((size: { cols: number; rows: number }) => {
    if (!canMutateWorkspace(activeTab.controller, "resize_terminal")) return;
    syncWorkspaceTerminalSize(
      terminalSizeRef,
      activeTab.id,
      activeTab.controller,
      activeTerminal?.id,
      size.cols,
      size.rows
    );
  }, [activeTab.controller, activeTerminal?.id, activeTab.id]);

  const onShellTerminalData = useCallback((data: string) => {
    if (!guardWorkspaceMutation("shell_input")) return;
    writeWorkspaceTerminalData(activeTab.id, activeTab.controller, activeTerminal?.id, data);
  }, [activeTerminal?.id, activeTab.controller, activeTab.id, guardWorkspaceMutation]);

  const onAgentTerminalSize = useCallback((
    paneId: string,
    tabId: string,
    sessionId: string,
    size: { cols: number; rows: number }
  ) => {
    agentPaneSizeRef.current.set(paneId, size);
    if (!isAgentRuntimeRunning(agentRuntimeRefs, tabId, sessionId)) return;
    const controller = stateRef.current.tabs.find((tab) => tab.id === tabId)?.controller;
    if (!controller || controller.role !== "controller") return;
    syncAgentRuntimeSize(agentRuntimeRefs, controller, tabId, sessionId, size);
  }, []);

  useEffect(() => {
    if (!showTerminalPanel || isCodeExpanded) return;
    requestAnimationFrame(() => {
      shellTerminalRef.current?.fit();
    });
  }, [showTerminalPanel, isCodeExpanded, state.layout.rightSplit]);

  useEffect(() => {
    if (activeTerminal && showTerminalPanel && !isCodeExpanded) {
      shellTerminalRef.current?.focus();
    }
  }, [activeTerminal?.id, showTerminalPanel, isCodeExpanded]);

  useEffect(() => {
    if (activeTerminal) return;
    terminalSizeRef.current = { id: undefined, cols: 0, rows: 0 };
  }, [activeTerminal?.id]);
  const layoutStyle = {
    ["--left-w" as string]: `${state.layout.leftWidth}px`,
    ["--right-w" as string]: `${state.layout.rightWidth}px`,
    ["--right-split" as string]: `${state.layout.rightSplit}%`
  };
  const workspaceUiReady = bootstrapReady && (state.tabs.length > 0 || state.overlay.visible);

  const workspaceTabs = state.tabs.map((tab) => {
    const sessions = [...tab.sessions].sort((left, right) => {
      if (sessionSort === "name") {
        return displaySessionTitle(left.title).localeCompare(displaySessionTitle(right.title), locale === "zh" ? "zh-CN" : "en");
      }
      return right.lastActiveAt - left.lastActiveAt;
    });
    const hasRunning = sessions.some((session) => ["running", "waiting", "background"].includes(session.status));
    const unread = sessions.reduce((sum, session) => sum + session.unread, 0);
    return {
      id: tab.id,
      label: displayPathName(tab.project?.path) || displayWorkspaceTitle(tab.title),
      active: tab.id === state.activeTabId,
      hasRunning,
      unread,
      sessions
    };
  });
  const commandPaletteActions = buildCommandPaletteActions({
    locale,
    t,
    route: "workspace",
    isFocusMode,
    showCodePanel,
    showTerminalPanel,
    workspaceTabs,
    onAddTab,
    onToggleFocusMode: () => setIsFocusMode((value) => !value),
    onToggleCodePanel: () => toggleRightPane("code"),
    onToggleTerminalPanel: () => toggleRightPane("terminal"),
    onFocusAgent: () => focusWorkspaceAgentPane(),
    onSplitVertical: () => splitPane(activeTab.activePaneId, "vertical"),
    onSplitHorizontal: () => splitPane(activeTab.activePaneId, "horizontal"),
    onCycleWorkspace,
    onOpenSettings,
    onCloseSettings: () => {},
    onSwitchWorkspace
  });
  const filteredCommandPaletteActions = filterCommandPaletteActions(commandPaletteActions, commandPaletteQuery);
  const activeCommandPaletteAction = filteredCommandPaletteActions[commandPaletteActiveIndex] ?? filteredCommandPaletteActions[0];

  useEffect(() => {
    if (!filteredCommandPaletteActions.length) {
      setCommandPaletteActiveIndex(0);
      return;
    }
    setCommandPaletteActiveIndex((current) => Math.min(current, filteredCommandPaletteActions.length - 1));
  }, [filteredCommandPaletteActions.length]);

  const gitChangeGroups = buildWorkspaceGitChangeGroups(activeTab.gitChanges, t);
  const previewGitChange = findPreviewGitChange(activeTab.filePreview.path, activeTab.gitChanges);
  const activeGitChangeKey = previewGitChange
    ? `${previewGitChange.section}:${previewGitChange.path}:${previewGitChange.code}`
    : selectedGitChangeKey;
  const gitSummary = {
    changes: gitChangeGroups.find((group) => group.key === "changes")?.items.length ?? 0,
    staged: gitChangeGroups.find((group) => group.key === "staged")?.items.length ?? 0,
    untracked: gitChangeGroups.find((group) => group.key === "untracked")?.items.length ?? 0
  };
  const previewFileName = displayPathName(activeTab.filePreview.path);
  const previewPathLabel = resolveWorkspacePreviewPathLabel(
    activeTab.filePreview.path,
    activeTab.project?.path,
    previewFileName
  );

  const currentFileChangeCount = activeTab.git.changes;
  const workspaceShellSummary = buildWorkspaceShellSummary({
    branchName: activeTab.git.branch,
    changeCount: currentFileChangeCount,
    target: activeTab.project?.target,
    sessions: activeTab.sessions,
    locale,
  });
  const hasStructuredDiffContent = Boolean(
    (activeTab.filePreview.originalContent && activeTab.filePreview.originalContent.length > 0)
    || (activeTab.filePreview.modifiedContent && activeTab.filePreview.modifiedContent.length > 0)
  );
  const hasTerminalOutput = Boolean(activeTerminal?.output?.trim());
  const terminalProgressPercent = activeTerminal
    ? (hasTerminalOutput ? 88 : 52)
    : 8;
  const terminalProgressTone = activeTerminal
    ? (hasTerminalOutput ? "live" : "steady")
    : "idle";
  const agentRecoveryAction = resolveAgentRecoveryAction(activeTab.controller, isArchiveView ? null : activePaneSession);
  const terminalRecoveryAction = resolveTerminalRecoveryAction(activeTab.controller, activeTerminal);
  const workspaceStatusBanner = isObserverMode ? (
    <div
      className="workspace-status-banner read-only"
      data-testid="workspace-read-only-banner"
    >
      <div className="workspace-status-banner-copy">
        <span className="workspace-status-banner-title">{t("workspaceReadOnlyTitle")}</span>
        <span className="workspace-status-banner-text">
          {hasSelfTakeoverPending
            ? t("workspaceTakeoverPending")
            : (
              isTakeoverRequesting
                ? t("workspaceTakeoverRequesting")
                : t("workspaceReadOnlyBody")
            )}
        </span>
      </div>
      <div className="workspace-status-banner-actions">
        <button
          type="button"
          className="workspace-status-banner-btn primary"
          onClick={() => {
            void onRequestWorkspaceTakeover();
          }}
          disabled={controllerActionBusy !== null || hasSelfTakeoverPending}
        >
          {t("workspaceTakeoverAction")}
        </button>
      </div>
    </div>
  ) : hasIncomingTakeoverRequest ? (
    <div
      className="workspace-status-banner takeover"
      data-testid="workspace-takeover-request-banner"
    >
      <div className="workspace-status-banner-copy">
        <span className="workspace-status-banner-title">{t("workspaceTakeoverIncomingTitle")}</span>
        <span className="workspace-status-banner-text">{t("workspaceTakeoverIncomingBody")}</span>
      </div>
      <div className="workspace-status-banner-actions">
        <button
          type="button"
          className="workspace-status-banner-btn"
          onClick={() => {
            void onRejectWorkspaceTakeover();
          }}
          disabled={controllerActionBusy !== null}
        >
          {t("workspaceTakeoverReject")}
        </button>
      </div>
    </div>
  ) : (agentRecoveryAction || terminalRecoveryAction) ? (
    <>
      {agentRecoveryAction && (
        <div
          className="workspace-status-banner recovery"
          data-testid="workspace-agent-recovery-banner"
        >
          <div className="workspace-status-banner-copy">
            <span className="workspace-status-banner-title">{t("workspaceAgentRecoveryTitle")}</span>
            <span className="workspace-status-banner-text">
              {agentRecoveryAction.kind === "resume"
                ? t("workspaceAgentResumeBody")
                : t("workspaceAgentRestartBody")}
            </span>
          </div>
          <div className="workspace-status-banner-actions">
            <button
              type="button"
              className="workspace-status-banner-btn primary"
              data-testid="workspace-agent-recovery-action"
              onClick={() => {
                void onRecoverActiveSession();
              }}
              disabled={controllerActionBusy !== null}
            >
              {agentRecoveryAction.kind === "resume"
                ? t("workspaceAgentResumeAction")
                : t("workspaceAgentRestartAction")}
            </button>
          </div>
        </div>
      )}
      {terminalRecoveryAction && (
        <div
          className="workspace-status-banner recovery"
          data-testid="workspace-terminal-recovery-banner"
        >
          <div className="workspace-status-banner-copy">
            <span className="workspace-status-banner-title">{t("workspaceTerminalRecoveryTitle")}</span>
            <span className="workspace-status-banner-text">{t("workspaceTerminalRecoveryBody")}</span>
          </div>
          <div className="workspace-status-banner-actions">
            <button
              type="button"
              className="workspace-status-banner-btn"
              data-testid="workspace-terminal-recovery-action"
              onClick={() => {
                void onAddTerminal();
              }}
              disabled={controllerActionBusy !== null}
            >
              {t("workspaceTerminalRecoveryAction")}
            </button>
          </div>
        </div>
      )}
    </>
  ) : null;
  const workspaceAgentPanel = (
    <AgentWorkspaceFeature
      visible={showAgentPanel}
      locale={locale}
      activeTab={activeTab}
      activePaneSession={activePaneSession}
      viewedSession={viewedSession}
      isArchiveView={isArchiveView}
      showCodePanel={showCodePanel}
      theme={theme}
      terminalFontSize={editorMetrics.terminalFontSize}
      terminalCompatibilityMode={terminalCompatibilityMode}
      draftPromptInputs={draftPromptInputs}
      draftPaneModes={draftPaneModes}
      restoreCandidates={restoreCandidates}
      displaySessionTitle={displaySessionTitle}
      onExitArchive={onExitArchive}
      onSetActivePane={setActivePane}
      onSplitPane={splitPane}
      onCloseAgentPane={onCloseAgentPane}
      onDraftPaneModeChange={onDraftPaneModeChange}
      onRestoreDraftSession={onRestoreDraftSession}
      onSubmitDraftPrompt={(paneId) => {
        void onSubmitDraftPrompt(paneId);
      }}
      onDraftPromptChange={(paneId, value) => {
        setDraftPromptInputs((current) => ({
          ...current,
          [paneId]: value
        }));
      }}
      setDraftPromptInputRef={registerDraftPromptInputRef}
      setAgentTerminalRef={registerAgentTerminalRef}
      onAgentTerminalData={(paneId, data) => {
        void onAgentTerminalData(paneId, data);
      }}
      onAgentTerminalSize={onAgentTerminalSize}
      onPaneSplitResizeStart={onPaneSplitResizeStart}
      onCodeResizeStart={onResizeStart("left")}
      t={t}
    />
  );

  const workspaceEditorContent = hasPreviewFile ? (
    activeTab.filePreview.mode === "diff" ? (
      activeTab.filePreview.source === "git" && Boolean(activeTab.filePreview.section) && hasStructuredDiffContent ? (
        <div className="editor-surface diff-editor-surface" data-testid="preview-diff-editor">
          <DiffEditor
            key={`${activeTab.filePreview.path}:${activeTab.filePreview.section ?? "diff"}`}
            height="100%"
            original={activeTab.filePreview.originalContent ?? ""}
            modified={activeTab.filePreview.modifiedContent ?? ""}
            originalModelPath={`${activeTab.filePreview.path}.original`}
            modifiedModelPath={activeTab.filePreview.path}
            language={inferEditorLanguage(activeTab.filePreview.path)}
            theme="vs-dark"
            options={{
              automaticLayout: true,
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              scrollbar: {
                verticalScrollbarSize: 6,
                horizontalScrollbarSize: 6,
                useShadows: false,
                alwaysConsumeMouseWheel: false
              },
              wordWrap: "on",
              fontFamily: "JetBrains Mono, Cascadia Mono, ui-monospace, monospace",
              fontSize: editorMetrics.fontSize,
              lineNumbersMinChars: 3,
              renderWhitespace: "selection"
            }}
          />
        </div>
      ) : (
        <pre className="diff code-surface">{activeTab.filePreview.diff || t("noDiffAvailable")}</pre>
      )
    ) : (
      <div className="editor-surface" data-testid="preview-editor">
        <Editor
          key={activeTab.filePreview.path}
          height="100%"
          path={activeTab.filePreview.path}
          language={inferEditorLanguage(activeTab.filePreview.path)}
          value={activeTab.filePreview.content}
          onChange={(value) => onPreviewEdit(value ?? "")}
          theme="vs-dark"
          options={{
            automaticLayout: true,
            fontFamily: "JetBrains Mono, Cascadia Mono, ui-monospace, monospace",
            fontSize: editorMetrics.fontSize,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            scrollbar: {
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
              useShadows: false,
              alwaysConsumeMouseWheel: false
            },
            wordWrap: "on",
            padding: { top: editorMetrics.paddingY, bottom: editorMetrics.paddingY },
            lineNumbersMinChars: 3,
            renderWhitespace: "selection"
          }}
        />
      </div>
    )
  ) : (
    <div className="preview-empty">{t("selectFileFromNavigator")}</div>
  );

  const workspaceCodePanel = showCodePanel ? (
    <WorkspaceCodeFeature
      container={appRef.current}
      locale={locale}
      isExpanded={isCodeExpanded}
      width={state.layout.rightWidth}
      codeSidebarView={codeSidebarView}
      previewPathLabel={previewPathLabel}
      previewFileName={previewFileName}
      editorContent={workspaceEditorContent}
      fileParentLabel={fileParentLabel}
      sidebar={{
        view: codeSidebarView,
        fileTree: activeTab.fileTree,
        rootPath: activeTab.project?.path,
        branchName: activeTab.git.branch,
        selectedPath: activeTab.filePreview.path,
        repoCollapsedPaths,
        gitChangeGroups,
        activeGitChangeKey,
        commitMessage,
        onCommitMessageChange: setCommitMessage,
        onFileSelect,
        onToggleRepoCollapse: (path) => {
          setRepoCollapsedPaths((current) => {
            const next = new Set(current);
            if (next.has(path)) {
              next.delete(path);
            } else {
              next.add(path);
            }
            return next;
          });
        },
        onRefresh: () => {
          void refreshWorkspaceArtifacts(activeTab.id);
        },
        onStageAll: () => {
          void onGitStageAll();
        },
        onUnstageAll: () => {
          void onGitUnstageAll();
        },
        onDiscardAll: () => {
          void onGitDiscardAll();
        },
        onCommit: () => {
          void onGitCommit();
        },
        onGitChangeSelect: (change) => {
          void onGitChangeSelect(change);
        },
        onGitChangeAction: (change, action) => {
          void onGitChangeAction(change, action);
        }
      }}
      fileSearch={{
        query: fileSearchQuery,
        activeIndex: fileSearchActiveIndex,
        showDropdown: showFileSearchDropdown,
        dropdownStyle: fileSearchDropdownStyle,
        results: fileSearchResults.map(({ node }) => node),
        searchShellRef: fileSearchShellRef,
        inputRef: fileSearchInputRef,
        onChange: (nextValue) => {
          setFileSearchState((current) => updateWorkspaceFileSearchQuery(current, nextValue));
        },
        onFocus: (currentValue) => {
          setFileSearchState((current) => openWorkspaceFileSearch(current, currentValue));
        },
        onBlur: onFileSearchBlur,
        onKeyDown: onFileSearchKeyDown,
        onHover: (index) => {
          setFileSearchState((current) => setWorkspaceFileSearchActiveIndex(current, index));
        },
        onSelect: (node) => {
          const matchedNode = fileSearchResults.find((result) => result.node.absolutePath === node.absolutePath)?.node
            ?? fileSearchResults.find((result) => result.node.path === node.path)?.node;
          if (matchedNode) {
            void onFileSearchSelect(matchedNode);
          }
        }
      }}
      onSetSidebarView={setCodeSidebarView}
      onToggleExpanded={() => {
        void toggleCodeExpanded();
      }}
      t={t}
    />
  ) : null;

  const workspaceTerminalPanel = (
    <WorkspaceTerminalFeature
      visible={!isCodeExpanded && showTerminalPanel}
      progressPercent={terminalProgressPercent}
      progressTone={terminalProgressTone}
      activeTerminal={activeTerminal ? { id: activeTerminal.id, output: activeTerminal.output ?? "" } : undefined}
      terminals={activeTab.terminals.map((term) => ({
        id: term.id,
        title: displayTerminalTitle(term.title)
      }))}
      terminalViewportRef={shellTerminalViewportRef}
      shellTerminalRef={shellTerminalRef}
      theme={theme}
      fontSize={editorMetrics.terminalFontSize}
      compatibilityMode={terminalCompatibilityMode}
      autoFocus={showTerminalPanel && !isCodeExpanded}
      onTerminalData={onShellTerminalData}
      onTerminalSize={onShellTerminalSize}
      onResizeStart={onResizeStart("right-split")}
      onSelect={onTerminalSelect}
      onCloseActive={() => {
        if (activeTerminal) {
          void onCloseTerminal(activeTerminal.id);
        }
      }}
      onAdd={() => {
        void onAddTerminal();
      }}
      t={t}
    />
  );

  return (
    <div ref={appRef} className="app" style={layoutStyle} data-theme={theme}>
      {workspaceUiReady && (
        <>
          <TopBar
            isSettingsRoute={false}
            locale={locale}
            workspaceTabs={workspaceTabs}
            historyOpen={historyOpen}
            onSwitchWorkspace={onSwitchWorkspace}
            onToggleHistory={onToggleHistory}
            onAddTab={onAddTab}
            onRemoveTab={onRemoveTab}
            onOpenSettings={onOpenSettings}
            onCloseSettings={() => {}}
            onOpenCommandPalette={openCommandPalette}
            t={t}
          />

          <HistoryDrawer
            open={historyOpen}
            loading={historyLoading}
            groups={historyGroups}
            expandedGroups={historyExpandedGroups}
            onClose={() => setHistoryOpen(false)}
            onToggleGroup={(workspaceId) => {
              setHistoryExpandedGroups((current) => ({
                ...current,
                [workspaceId]: !current[workspaceId],
              }));
            }}
            onSelectRecord={(record) => {
              void handleHistoryRecordSelect(record);
            }}
            onDeleteRecord={(record) => {
              void handleHistoryRecordDelete(record);
            }}
            t={t}
          />

          <WorkspaceShell
            isFocusMode={isFocusMode}
            isCodeExpanded={isCodeExpanded}
            showAgentPanel={showAgentPanel}
            showCodePanel={showCodePanel}
            showTerminalPanel={showTerminalPanel}
            rightSplit={state.layout.rightSplit}
            statusItems={workspaceShellSummary}
            runtimeHint={locale === "zh" ? "⌘/Ctrl+K 快速操作" : "⌘/Ctrl+K actions"}
            statusBanner={workspaceStatusBanner}
            agentPanel={workspaceAgentPanel}
            codePanel={workspaceCodePanel}
            terminalPanel={workspaceTerminalPanel}
            onToggleRightPane={toggleRightPane}
            t={t}
          />

          {commandPaletteOpen && (
            <CommandPalette
              locale={locale}
              inputRef={commandPaletteInputRef}
              query={commandPaletteQuery}
              activeIndex={commandPaletteActiveIndex}
              actions={filteredCommandPaletteActions}
              activeAction={activeCommandPaletteAction}
              onClose={closeCommandPalette}
              onQueryChange={setCommandPaletteQuery}
              onActivateIndex={setCommandPaletteActiveIndex}
              onRunAction={onRunCommandPaletteAction}
            />
          )}

          <div className="toast-container">
            {toasts.map((toast) => (
              <button key={toast.id} className="toast" onClick={() => onSwitchSession(toast.sessionId)}>
                {toast.text}
              </button>
            ))}
          </div>

          {worktreeModal && (
            <WorktreeModal
              locale={locale}
              worktree={worktreeModal}
              view={worktreeView}
              collapsedPaths={worktreeCollapsedPaths}
              onClose={() => setWorktreeModal(null)}
              onViewChange={setWorktreeView}
              onFileSelect={onFileSelect}
              onToggleCollapse={(path) => {
                setWorktreeCollapsedPaths((current) => {
                  const next = new Set(current);
                  if (next.has(path)) {
                    next.delete(path);
                  } else {
                    next.add(path);
                  }
                  return next;
                });
              }}
              t={t}
            />
          )}

          <RuntimeValidationOverlay
            visible={showRuntimeValidationOverlay}
            target={state.overlay.target}
            canUseWsl={overlayCanUseWsl}
            runtimeLabel={formatExecTargetLabel(state.overlay.target, t)}
            validation={runtimeValidationView}
            onUpdateTarget={onOverlayUpdateTarget}
            onRetry={() => {
              void runRuntimeValidation(stateRef.current.overlay.target);
            }}
            t={t}
          />

          <WorkspaceLaunchOverlay
            visible={showWorkspaceLaunchOverlay}
            target={state.overlay.target}
            input={state.overlay.input}
            canUseWsl={overlayCanUseWsl}
            folderBrowser={folderBrowser}
            onUpdateTarget={onOverlayUpdateTarget}
            onBrowseDirectory={onBrowseOverlayDirectory}
            onStartWorkspace={onStartWorkspace}
            t={t}
          />
        </>
      )}
    </div>
  );
}
