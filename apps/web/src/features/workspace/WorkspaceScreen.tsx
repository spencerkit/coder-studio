import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import type { XtermBaseHandle } from "../../components/terminal";
import { WorktreeModal } from "../../components/WorktreeModal";
import { WorkspaceLaunchOverlay } from "../../components/WorkspaceLaunchOverlay";
import { WorkspaceWelcomeScreen } from "../../components/WorkspaceWelcomeScreen";
import { WorkspaceShell } from "../../components/workspace";
import {
  AgentWorkspaceFeature,
  applyTrackedAgentSessionTitle,
  createAgentTerminalFitScheduler,
  focusAgentTerminal,
  fitAgentTerminals,
  setAgentTerminalRef,
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
  replaceWorkspaceTerminal,
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
} from "./workspace-recovery";
import { buildRuntimeRequirementStatusesFromManifest } from "../providers/runtime-helpers";
import { attachWorkspaceRuntimeWithRetry } from "./runtime-attach";
import {
  shouldAttachRouteRuntimeForExistingTab,
} from "./workspace-route-runtime";
import { filterWorkspacePanelTerminals, resolveSessionTerminalIdByRuntimeId } from "./session-runtime-bindings";
import {
  createWorkspaceViewPatchFromTab,
  createWorkspaceViewPersistScheduler,
  noteWorkspaceViewPersistRequest,
  pruneWorkspaceViewBaselines,
  rememberWorkspaceViewPatchBaseline,
  shouldPersistWorkspaceView,
  type WorkspaceViewPersistScheduler,
} from "./workspace-view-persistence";
import { createWorkspaceSessionActions } from "./session-actions";
import { useWorkspaceArtifactsSync } from "./workspace-sync-hooks";
import { startWorkspaceLaunch } from "./workspace-launch-actions";
import {
  browseWorkspaceOverlayDirectory,
  updateWorkspaceOverlayInput,
  updateWorkspaceOverlayTarget
} from "./workspace-overlay-actions";
import {
  advanceWorkspaceSyncVersion,
  isWorkspaceSyncVersionCurrent,
} from "./workspace-sync-version";
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
import { startSessionRuntime } from "../../services/http/session-runtime.service.ts";
import {
  consumeTerminalChannelInputFragment,
  sendTerminalChannelInput,
} from "../../services/terminal-channel/client.ts";
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
  checkCommandAvailability,
  getProviderRuntimePreview,
} from "../../services/http/system.service";
import {
  enableSupervisorMode,
  updateSupervisorObjective,
  pauseSupervisorMode,
  resumeSupervisorMode,
  disableSupervisorMode,
  retrySupervisorCycle,
  triggerSupervisorCycle,
  activateWorkspace as activateWorkspaceRequest,
  closeWorkspace as closeWorkspaceRequest,
  getWorkbenchBootstrap,
  getWorkspaceSnapshot,
  rejectWorkspaceTakeover,
  requestWorkspaceTakeover,
  updateWorkbenchLayout,
  updateWorkspaceView
} from "../../services/http/workspace.service";
import {
  applyWorkbenchUiState,
  applyWorkspaceBootstrapResult,
  applyWorkspaceControllerEvent,
  applyWorkspaceRuntimeSnapshot,
  upsertWorkspaceSnapshot,
  workbenchLayoutToBackend
} from "../../shared/utils/workspace";
import {
  getWorkbenchStateSnapshot,
  syncWorkbenchStateSnapshot,
  updateWorkbenchStateSnapshot,
} from "../../shared/utils/workbench-state-snapshot";
import { AGENT_SPECIAL_KEY_MAP } from "../../shared/app/constants";
import { inferEditorLanguage } from "../../shared/utils/editor";
import { estimateTerminalGrid, type TerminalGridSize } from "../../shared/utils/terminal";
import { resolveTerminalInteractionMode } from "../../shared/utils/terminal-interaction";
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
  formatRelativeSessionTime,
  isDraftSession,
  isHiddenDraftPlaceholder,
  nowLabel,
  parseNumericId,
  sessionCompletionRatio
} from "../../shared/utils/session";
import { normalizeSupervisorObjective } from "./supervisor-objective";
import {
  SupervisorObjectiveDialog,
  type SupervisorObjectiveDialogMode,
} from "./SupervisorObjectiveDialog";
import { buildWorkspaceShellSummary } from "./workspace-shell-summary";
import { ConfirmDialog, type ConfirmDialogState } from "../../components/ConfirmDialog";
import type {
  AppSettings,
  AppTheme,
  CommandPaletteAction,
  FolderBrowserState,
  GitChangeAction,
  GitChangeEntry,
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

type SupervisorObjectiveDialogState = {
  visible: boolean;
  mode: SupervisorObjectiveDialogMode;
  sessionId: string | null;
  provider: Session["provider"] | null;
  currentObjective: string;
  draftObjective: string;
};

const createInitialFolderBrowserState = (): FolderBrowserState => ({
  loading: false,
  currentPath: "",
  homePath: "",
  roots: [],
  entries: []
});

const formatExecTargetLabel = (target: ExecTarget, t: ReturnType<typeof createTranslator>) =>
  target.type === "wsl"
    ? target.distro?.trim()
      ? `WSL (${target.distro.trim()})`
      : "WSL"
    : t("nativeTarget");

const serializeRuntimeValidationKey = (target: ExecTarget, agentCommand: string) =>
  target.type === "wsl"
    ? `wsl:${target.distro?.trim() ?? ""}:${agentCommand.trim()}`
    : `native:${agentCommand.trim()}`;

const serializeRuntimeValidationRequestKey = (
  target: ExecTarget,
  settings: Pick<AppSettings, "agentDefaults" | "providers">,
) => JSON.stringify({
  target,
  provider: settings.agentDefaults.provider,
  global: settings.providers[settings.agentDefaults.provider]?.global ?? null,
});

type RuntimeValidationModel = RuntimeValidationState & {
  requestKey: string;
};

const createRuntimeRequirementStatus = (
  agentCommand: string,
  provider: Session["provider"],
  t: ReturnType<typeof createTranslator>,
): RuntimeRequirementStatus[] =>
  buildRuntimeRequirementStatusesFromManifest(
    provider,
    agentCommand,
    (key, params) => t(key as never, params),
  );

const createRuntimeValidationState = (
  agentCommand: string,
  provider: Session["provider"],
  t: ReturnType<typeof createTranslator>,
  requestKey = "",
  targetKey = "",
  status: RuntimeValidationState["status"] = "idle",
): RuntimeValidationModel => ({
  requestKey,
  status,
  targetKey,
  requirements: createRuntimeRequirementStatus(agentCommand, provider, t),
});

const isTextInputTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

export default function WorkspaceScreen({ locale, appSettings, onOpenSettings }: WorkspaceScreenProps) {
  const [storeState, setStoreState] = useRelaxState(workbenchState);
  const [state, setRenderState] = useState(storeState);
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
  const [folderBrowser, setFolderBrowser] = useState<FolderBrowserState>(createInitialFolderBrowserState);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteActiveIndex, setCommandPaletteActiveIndex] = useState(0);
  const [fileSearchState, setFileSearchState] = useState(createInitialWorkspaceFileSearchState);
  const [sessionSort, setSessionSort] = useState<"time" | "name">("time");
  const [repoCollapsedPaths, setRepoCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [worktreeCollapsedPaths, setWorktreeCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [selectedGitChangeKey, setSelectedGitChangeKey] = useState<string>("");
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [controllerActionBusy, setControllerActionBusy] = useState<"takeover" | "reject" | null>(null);
  const [agentRecoveryBusy, setAgentRecoveryBusy] = useState<{
    sessionId: string;
    kind: "resume" | "restart";
  } | null>(null);
  const [optimisticTakeoverWorkspaceId, setOptimisticTakeoverWorkspaceId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    visible: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });
  const [supervisorObjectiveDialog, setSupervisorObjectiveDialog] = useState<SupervisorObjectiveDialogState>({
    visible: false,
    mode: "enable",
    sessionId: null,
    provider: null,
    currentObjective: "",
    draftObjective: "",
  });
  const t = useMemo(() => createTranslator(locale), [locale]);
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const clientId = useMemo(() => getOrCreateClientId(), []);
  const terminalCompatibilityMode = appSettings.general.terminalCompatibilityMode;
  const [runtimeValidation, setRuntimeValidation] = useState<RuntimeValidationModel>(() => createRuntimeValidationState(
    appSettings.agentDefaults.provider,
    appSettings.agentDefaults.provider,
    t,
    serializeRuntimeValidationRequestKey({ type: "native" }, appSettings),
  ));
  const stateRef = useRef(state);
  const appRef = useRef<HTMLDivElement | null>(null);
  const fileSearchShellRef = useRef<HTMLDivElement | null>(null);
  const fileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null);
  const terminalRecoveryAttemptsRef = useRef(new Set<string>());
  const draftPromptInputRefs = useRef(new Map<string, HTMLInputElement | null>());
  const shellTerminalRef = useRef<XtermBaseHandle | null>(null);
  const shellTerminalViewportRef = useRef<HTMLDivElement | null>(null);
  const emptyTabRef = useRef<Tab | null>(null);
  const agentTerminalRefs = useRef(new Map<string, XtermBaseHandle | null>());
  const agentTerminalInputBufferRef = useRef(new Map<string, string>());
  const agentTerminalInputFlushTimerRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const agentTerminalQueueRef = useRef(new Map<string, Promise<void>>());
  const agentTerminalFitSchedulerRef = useRef<ReturnType<typeof createAgentTerminalFitScheduler> | null>(null);
  const agentPaneSizeRef = useRef(new Map<string, { cols: number; rows: number }>());
  const agentRuntimeSizeRef = useRef(new Map<string, { cols: number; rows: number }>());
  const agentResizeStateRef = useRef(new Map<string, {
    inflight: boolean;
    pending?: { cols: number; rows: number };
  }>());
  const workspaceViewPersistSchedulerRef = useRef<WorkspaceViewPersistScheduler<Tab["controller"]> | null>(null);
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
  const overlayBrowseRequestIdRef = useRef(0);
  const persistedLayoutRef = useRef<string>("");
  const workbenchStateVersionRef = useRef(0);
  const agentStartupStateRef = useRef(new Map<string, {
    token: number;
    startedAt: number;
    lastEventAt: number;
    sawOutput: boolean;
    sawReady: boolean;
    exited: boolean;
  }>());
  const agentStartupTokenRef = useRef(0);
  const getRuntimeValidationRequestKey = useCallback(
    (target: ExecTarget) => serializeRuntimeValidationRequestKey(target, appSettings),
    [appSettings],
  );
  const runRuntimeValidation = useCallback(async (target: ExecTarget) => {
    const provider = appSettings.agentDefaults.provider;
    const requestKey = getRuntimeValidationRequestKey(target);
    const requestId = ++runtimeValidationRequestIdRef.current;
    setRuntimeValidation(createRuntimeValidationState(
      provider,
      provider,
      t,
      requestKey,
      "",
      "checking",
    ));

    let command = provider;

    try {
      const preview = await getProviderRuntimePreview(provider, target);
      command = preview.display_command.trim() || provider;
    } catch (error) {
      if (runtimeValidationRequestIdRef.current !== requestId) return;

      const message = error instanceof Error ? error.message : String(error);
      const requirements = createRuntimeRequirementStatus(provider, provider, t).map((requirement, index) => (
        index === 0
          ? {
            ...requirement,
            available: false,
            error: message,
          } satisfies RuntimeRequirementStatus
          : requirement
      ));

      setRuntimeValidation({
        requestKey,
        status: "failed",
        targetKey: serializeRuntimeValidationKey(target, provider),
        requirements,
      });
      return;
    }

    if (runtimeValidationRequestIdRef.current !== requestId) return;

    const targetKey = serializeRuntimeValidationKey(target, command);
    const requirements = createRuntimeRequirementStatus(command, provider, t);
    setRuntimeValidation({
      requestKey,
      status: "checking",
      targetKey,
      requirements,
    });

    const results = await Promise.all(
      requirements.map(async (requirement) => {
        if (requirement.available === true) {
          return requirement;
        }
        try {
          const result = await checkCommandAvailability(requirement.command, target);
          return {
            ...requirement,
            available: result.available,
            resolvedPath: result.resolved_path ?? undefined,
            error: result.error ?? undefined,
          } satisfies RuntimeRequirementStatus;
        } catch (error) {
          return {
            ...requirement,
            available: false,
            error: error instanceof Error ? error.message : String(error),
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
      requestKey,
      status: nextStatus,
      targetKey,
      requirements: results,
    });
  }, [appSettings, getRuntimeValidationRequestKey, t]);
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
    const current = getWorkbenchStateSnapshot();
    const next = updateWorkbenchStateSnapshot(updater);
    if (
      next !== current
      && (
        next.tabs !== current.tabs
        || next.activeTabId !== current.activeTabId
        || next.layout !== current.layout
      )
    ) {
      workbenchStateVersionRef.current += 1;
    }
    stateRef.current = next;
    setRenderState(next);
    setStoreState(next);
  };

  const agentRuntimeRefs = useMemo(() => ({
    draftPromptInputRefs,
    agentTerminalRefs,
    agentTerminalQueueRef,
    agentPaneSizeRef,
    agentTitleTrackerRef,
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

  const flushWorkspaceAgentFit = useCallback(() => {
    const scheduler = agentTerminalFitSchedulerRef.current;
    if (!scheduler) {
      runWorkspaceAgentFit();
      return;
    }
    scheduler.schedule(runWorkspaceAgentFit);
    scheduler.flush();
  }, [runWorkspaceAgentFit]);

  const fitVisibleWorkspaceTerminals = useCallback(() => {
    shellTerminalRef.current?.fit();
    flushWorkspaceAgentFit();
  }, [flushWorkspaceAgentFit]);

  const persistWorkspaceView = useCallback((
    workspaceId: string,
    patch: ReturnType<typeof createWorkspaceViewPatchFromTab>,
    controller: Tab["controller"],
  ) => {
    rememberWorkspaceViewPatchBaseline(workspaceId, patch);
    noteWorkspaceViewPersistRequest(workspaceId, patch);
    void withServiceFallback(
      () => updateWorkspaceView(workspaceId, patch, controller),
      null,
    );
  }, []);

  if (!workspaceViewPersistSchedulerRef.current && typeof window !== "undefined") {
    workspaceViewPersistSchedulerRef.current = createWorkspaceViewPersistScheduler(
      persistWorkspaceView,
      window.setTimeout.bind(window),
      window.clearTimeout.bind(window),
    );
  }

  const registerAgentTerminalRef = (paneId: string, handle: XtermBaseHandle | null) => {
    setAgentTerminalRef(agentRuntimeRefs, paneId, handle);
  };

  const focusWorkspaceAgentPane = (paneId = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeTabId)?.activePaneId) => {
    focusAgentTerminal(agentRuntimeRefs, paneId);
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

  useLayoutEffect(() => {
    stateRef.current = storeState;
    syncWorkbenchStateSnapshot(storeState);
    setRenderState((current) => (current === storeState ? current : storeState));
  }, [storeState]);

  useEffect(() => () => {
    workspaceViewPersistSchedulerRef.current?.flush();
    workspaceViewPersistSchedulerRef.current?.dispose();
    agentTerminalFitSchedulerRef.current?.dispose();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const bootstrapStateVersion = workbenchStateVersionRef.current;
    void (async () => {
      const bootstrap = await withServiceFallback(() => getWorkbenchBootstrap(deviceId, clientId), null);
      if (cancelled || !bootstrap) {
        if (!cancelled) {
          setBootstrapReady(true);
        }
        return;
      }
      if (routeWorkspaceId) {
        const syncVersion = advanceWorkspaceSyncVersion(routeWorkspaceId);
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

        if (cancelled || !isWorkspaceSyncVersionCurrent(routeWorkspaceId, syncVersion)) {
          return;
        }
        if (workbenchStateVersionRef.current !== bootstrapStateVersion) {
          setBootstrapReady(true);
          return;
        }

        if (uiState && runtimeSnapshot) {
          updateState((current) => applyWorkspaceBootstrapResult(
            current,
            bootstrap,
            locale,
            appSettings,
            {
              deviceId,
              clientId,
              uiState,
              runtimeSnapshot,
            },
          ));
        } else {
          updateState((current) => applyWorkspaceBootstrapResult(
            current,
            bootstrap,
            locale,
            appSettings,
            {
              deviceId,
              clientId,
              uiState,
            },
          ));
        }
      } else {
        updateState((current) => applyWorkspaceBootstrapResult(
          current,
          bootstrap,
          locale,
          appSettings,
        ));
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
      const syncVersion = advanceWorkspaceSyncVersion(routeWorkspaceId);
      const existing = stateRef.current.tabs.find((tab) => tab.id === routeWorkspaceId);
      if (existing && !shouldAttachRouteRuntimeForExistingTab(existing)) {
        let cancelled = false;
        if (stateRef.current.activeTabId !== routeWorkspaceId) {
          switchWorkspaceLocally(routeWorkspaceId);
          void withServiceFallback(() => activateWorkspaceRequest(routeWorkspaceId, deviceId, clientId), null).then((uiState) => {
            if (!uiState || cancelled || !isWorkspaceSyncVersionCurrent(routeWorkspaceId, syncVersion)) return;
            updateState((current) => applyWorkbenchUiState(current, uiState));
          });
        }
        void ensureWorkspaceTerminal(routeWorkspaceId);
        return () => {
          cancelled = true;
        };
      }

      let cancelled = false;
      void (async () => {
        const uiState = await withServiceFallback(() => activateWorkspaceRequest(routeWorkspaceId, deviceId, clientId), null);
        if (cancelled || !isWorkspaceSyncVersionCurrent(routeWorkspaceId, syncVersion)) {
          return;
        }
        if (!uiState) {
          navigate("/workspace", { replace: true });
          return;
        }
        const runtimeSnapshot = await attachWorkspaceRuntimeWithRetry(
          routeWorkspaceId,
          deviceId,
          clientId,
          withServiceFallback,
        );
        if (cancelled || !isWorkspaceSyncVersionCurrent(routeWorkspaceId, syncVersion)) {
          return;
        }
        if (!runtimeSnapshot) {
          const snapshot = await withServiceFallback(() => getWorkspaceSnapshot(routeWorkspaceId), null);
          if (cancelled || !isWorkspaceSyncVersionCurrent(routeWorkspaceId, syncVersion)) {
            return;
          }
          if (snapshot) {
            updateState((current) => upsertWorkspaceSnapshot(
              current,
              snapshot,
              locale,
              appSettings,
              uiState,
            ));
            void ensureWorkspaceTerminal(routeWorkspaceId);
            return;
          }
          navigate("/workspace", { replace: true });
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
  }, [
    advanceWorkspaceSyncVersion,
    appSettings,
    bootstrapReady,
    clientId,
    deviceId,
    isWorkspaceSyncVersionCurrent,
    locale,
    navigate,
    routeWorkspaceId,
  ]);

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

  useEffect(() => {
    if (!bootstrapReady) return;
    const scheduler = workspaceViewPersistSchedulerRef.current;
    const liveWorkspaceIds = new Set(state.tabs.map((tab) => tab.id));
    state.tabs.forEach((tab) => {
      if (tab.status !== "ready" || !tab.project?.path) {
        scheduler?.cancel(tab.id);
        return;
      }
      if (!canMutateWorkspace(tab.controller, "switch_pane")) {
        scheduler?.cancel(tab.id);
        return;
      }
      if (!shouldPersistWorkspaceView(tab)) {
        scheduler?.cancel(tab.id);
        return;
      }
      const patch = createWorkspaceViewPatchFromTab(tab);
      if (!scheduler) {
        persistWorkspaceView(tab.id, patch, tab.controller);
        return;
      }
      scheduler.schedule(tab.id, patch, tab.controller);
    });
    scheduler?.prune(liveWorkspaceIds);
    pruneWorkspaceViewBaselines(liveWorkspaceIds);
  }, [bootstrapReady, persistWorkspaceView, state.tabs]);

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

  const currentRuntimeValidationRequestKey = getRuntimeValidationRequestKey(state.overlay.target);

  useEffect(() => {
    if (!bootstrapReady || !state.overlay.visible) return;
    if (runtimeValidation.requestKey === currentRuntimeValidationRequestKey) {
      if (runtimeValidation.status === "checking" || runtimeValidation.status === "failed") {
        return;
      }
      if (
        runtimeValidation.status === "ready"
        && runtimeValidation.targetKey
        && validatedRuntimeTargetsRef.current.has(runtimeValidation.targetKey)
      ) {
        return;
      }
    }
    void runRuntimeValidation(state.overlay.target);
  }, [
    bootstrapReady,
    currentRuntimeValidationRequestKey,
    runRuntimeValidation,
    runtimeValidation.requestKey,
    runtimeValidation.status,
    runtimeValidation.targetKey,
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
        idlePolicy: { ...appSettings.general.idlePolicy },
      };
    }
    return emptyTabRef.current;
  }, [appSettings, locale, state.activeTabId, state.tabs]);
  const overlayVisible = bootstrapReady && state.overlay.visible;
  const showWelcomeScreen = bootstrapReady && state.tabs.length === 0;
  const runtimeValidatedForTarget = runtimeValidation.requestKey === currentRuntimeValidationRequestKey
    && runtimeValidation.status === "ready"
    && runtimeValidation.targetKey.length > 0
    && validatedRuntimeTargetsRef.current.has(runtimeValidation.targetKey);
  const runtimeValidationView = runtimeValidation.requestKey === currentRuntimeValidationRequestKey
    ? runtimeValidation
    : createRuntimeValidationState(
      appSettings.agentDefaults.provider,
      appSettings.agentDefaults.provider,
      t,
      currentRuntimeValidationRequestKey,
      "",
      "checking",
    );
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
  }, [activeTab.id, activeTab.sessions]);

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
    createDraftSessionForTab,
    materializeSession,
    onCloseAgentPane: closeAgentPaneSession,
    onNewSession: createNewSessionInActiveTab,
    onSwitchSession: switchSessionInActiveTab,
    refreshTabFromBackend,
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

  const runSupervisorMutation = useCallback(async (
    sessionId: string,
    operation: () => Promise<unknown>,
    fallbackMessage: string,
  ) => {
    if (!guardWorkspaceMutation("session_update", activeTab.id, sessionId)) return false;
    const result = await withServiceFallback(async () => {
      await operation();
      return true;
    }, false);
    if (!result) {
      addToast({
        id: createId("toast"),
        text: fallbackMessage,
        sessionId,
      });
      return false;
    }
    await refreshTabFromBackend(activeTab.id);
    return true;
  }, [activeTab.id, addToast, guardWorkspaceMutation, refreshTabFromBackend]);

  const closeSupervisorObjectiveDialog = useCallback(() => {
    setSupervisorObjectiveDialog((current) => ({
      ...current,
      visible: false,
      sessionId: null,
      provider: null,
      currentObjective: "",
      draftObjective: "",
    }));
  }, []);

  const submitSupervisorObjectiveDialog = useCallback(async () => {
    const sessionId = supervisorObjectiveDialog.sessionId;
    if (!sessionId) return;

    if (supervisorObjectiveDialog.mode === "disable") {
      await runSupervisorMutation(
        sessionId,
        () => disableSupervisorMode(activeTab.id, activeTab.controller, sessionId),
        "Failed to disable supervisor mode.",
      );
      closeSupervisorObjectiveDialog();
      return;
    }

    const objectiveText = normalizeSupervisorObjective(supervisorObjectiveDialog.draftObjective);
    if (!objectiveText) return;

    if (supervisorObjectiveDialog.mode === "edit" && objectiveText === supervisorObjectiveDialog.currentObjective.trim()) {
      closeSupervisorObjectiveDialog();
      return;
    }

    if (supervisorObjectiveDialog.mode === "enable") {
      const provider = supervisorObjectiveDialog.provider;
      if (!provider) return;
      await runSupervisorMutation(
        sessionId,
        () => enableSupervisorMode(activeTab.id, activeTab.controller, sessionId, provider, objectiveText),
        "Failed to enable supervisor mode.",
      );
      closeSupervisorObjectiveDialog();
      return;
    }

    await runSupervisorMutation(
      sessionId,
      () => updateSupervisorObjective(activeTab.id, activeTab.controller, sessionId, objectiveText),
      "Failed to update supervisor objective.",
    );
    closeSupervisorObjectiveDialog();
  }, [
    activeTab.controller,
    activeTab.id,
    closeSupervisorObjectiveDialog,
    runSupervisorMutation,
    supervisorObjectiveDialog,
  ]);

  const onEnableSupervisor = useCallback(async (sessionId: string, provider: Session["provider"]) => {
    setSupervisorObjectiveDialog({
      visible: true,
      mode: "enable",
      sessionId,
      provider,
      currentObjective: "",
      draftObjective: "Keep the business agent focused on the current task.",
    });
  }, []);

  const onEditSupervisorObjective = useCallback(async (sessionId: string, currentObjective: string) => {
    setSupervisorObjectiveDialog({
      visible: true,
      mode: "edit",
      sessionId,
      provider: null,
      currentObjective,
      draftObjective: currentObjective,
    });
  }, []);

  const onPauseSupervisor = useCallback(async (sessionId: string) => {
    await runSupervisorMutation(
      sessionId,
      () => pauseSupervisorMode(activeTab.id, activeTab.controller, sessionId),
      "Failed to pause supervisor mode.",
    );
  }, [activeTab.controller, activeTab.id, runSupervisorMutation]);

  const onResumeSupervisor = useCallback(async (sessionId: string) => {
    await runSupervisorMutation(
      sessionId,
      () => resumeSupervisorMode(activeTab.id, activeTab.controller, sessionId),
      "Failed to resume supervisor mode.",
    );
  }, [activeTab.controller, activeTab.id, runSupervisorMutation]);

  const onDisableSupervisor = useCallback(async (sessionId: string) => {
    setSupervisorObjectiveDialog({
      visible: true,
      mode: "disable",
      sessionId,
      provider: null,
      currentObjective: "",
      draftObjective: "",
    });
  }, []);

  const onRetrySupervisor = useCallback(async (sessionId: string) => {
    await runSupervisorMutation(
      sessionId,
      () => retrySupervisorCycle(activeTab.id, activeTab.controller, sessionId),
      "Failed to retry supervisor cycle.",
    );
  }, [activeTab.controller, activeTab.id, runSupervisorMutation]);

  const onTriggerSupervisor = useCallback(async (sessionId: string) => {
    await runSupervisorMutation(
      sessionId,
      () => triggerSupervisorCycle(activeTab.id, activeTab.controller, sessionId),
      "Failed to trigger supervisor cycle.",
    );
  }, [activeTab.controller, activeTab.id, runSupervisorMutation]);

  const { refreshWorkspaceArtifacts } = useWorkspaceArtifactsSync({
    activeTabId: activeTab.id,
    activeProjectPath: activeTab.project?.path,
    bootstrapReady,
    codeSidebarView,
    showCodePanel,
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
                  ? { ...session, unread: 0, status: session.status, lastActiveAt: Date.now() }
                  : session
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

  const onOpenWorkspacePicker = () => {
    onAddTab();
  };

  const onRemoveTab = async (tabId: string) => {
    const currentTabs = stateRef.current.tabs;
    const currentIndex = currentTabs.findIndex((tab) => tab.id === tabId);
    if (currentIndex === -1) return;
    if (!guardWorkspaceMutation("close_workspace", tabId)) return;
    advanceWorkspaceSyncVersion(tabId);
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
          visible: false,
        },
      };
    });
    if (uiState.active_workspace_id) {
      navigate(`/workspace/${uiState.active_workspace_id}`);
      void ensureWorkspaceTerminal(uiState.active_workspace_id);
      return;
    }
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
    const syncVersion = advanceWorkspaceSyncVersion(workspaceId);
    const uiState = await withServiceFallback(
      () => activateWorkspaceRequest(workspaceId, deviceId, clientId),
      null,
    );
    if (!uiState || !isWorkspaceSyncVersionCurrent(workspaceId, syncVersion)) return null;

    const runtimeSnapshot = await attachWorkspaceRuntimeWithRetry(
      workspaceId,
      deviceId,
      clientId,
      withServiceFallback,
    );
    if (!isWorkspaceSyncVersionCurrent(workspaceId, syncVersion)) return null;

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
      if (!isWorkspaceSyncVersionCurrent(workspaceId, syncVersion)) return null;
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

    if (!isWorkspaceSyncVersionCurrent(workspaceId, syncVersion)) return null;
    navigate(`/workspace/${workspaceId}`, { replace: true });
    return nextTab ?? stateRef.current.tabs.find((tab) => tab.id === workspaceId) ?? null;
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

  const onCloseWorkspaceOverlay = useCallback(() => {
    overlayBrowseRequestIdRef.current += 1;
    setFolderBrowser(createInitialFolderBrowserState());
    updateState((current) => ({
      ...current,
      overlay: {
        ...current.overlay,
        visible: false,
        input: "",
      },
    }));
  }, []);

  const browseOverlayDirectory = useCallback(async (target: ExecTarget, path?: string, selectCurrent = false) => {
    const requestId = ++overlayBrowseRequestIdRef.current;
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
      },
      shouldApplyResult: () => overlayBrowseRequestIdRef.current === requestId,
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
    const syncVersion = advanceWorkspaceSyncVersion(launched.workspaceId);
    const runtimeSnapshot = await attachWorkspaceRuntimeWithRetry(
      launched.workspaceId,
      deviceId,
      clientId,
      withServiceFallback,
    );
    if (runtimeSnapshot && isWorkspaceSyncVersionCurrent(launched.workspaceId, syncVersion)) {
      updateState((current) => applyWorkspaceRuntimeSnapshot(
        current,
        runtimeSnapshot,
        locale,
        appSettings,
        deviceId,
        clientId,
      ));
    }
    if (!isWorkspaceSyncVersionCurrent(launched.workspaceId, syncVersion)) return;
    navigate(`/workspace/${launched.workspaceId}`);
    void ensureWorkspaceTerminal(launched.workspaceId);
    if (launched.firstFile) {
      await onFileSelect(launched.firstFile, launched.workspaceId);
    }
  };

  const startSessionRuntimeInPane = async (paneId: string | null | undefined, tab: Tab, session: Session) => {
    if (session.unavailableReason) {
      addToast({
        id: createId("toast"),
        text: session.unavailableReason,
        sessionId: session.id,
      });
      return null;
    }
    if (!guardWorkspaceMutation("agent_input", tab.id, session.id)) return false;
    const syncVersion = advanceWorkspaceSyncVersion(tab.id);
    const initialSize = resolveAgentInitialSize(paneId);
    const result = await invokeAgent(() => startSessionRuntime({
      workspaceId: tab.id,
      controller: tab.controller,
      sessionId: session.id,
      cols: initialSize?.cols,
      rows: initialSize?.rows,
    }), session.id, t("agentStartFailed"));
    if (!result) {
      return null;
    }
    const terminalRuntimeId = result.terminal_runtime_id ?? session.terminalRuntimeId;
    const terminalId = result.terminal_runtime_id
      ? undefined
      : `term-${result.terminal_id}`;
    let nextSession = {
      ...session,
      terminalId,
      terminalRuntimeId,
    };
    let nextTab = {
      ...tab,
      terminals: terminalId && !tab.terminals.some((terminal) => terminal.id === terminalId)
        ? [
            ...tab.terminals,
            {
              id: terminalId,
              title: formatTerminalTitle(tab.terminals.length + 1, locale),
              output: "",
              recoverable: true,
            },
          ]
        : tab.terminals,
      sessions: tab.sessions.map((item) => (
        item.id === session.id
          ? nextSession
          : item
      )),
    };
    updateTab(tab.id, (current) => {
      nextTab = {
        ...current,
        terminals: terminalId && !current.terminals.some((terminal) => terminal.id === terminalId)
          ? [
              ...current.terminals,
              {
                id: terminalId,
                title: formatTerminalTitle(current.terminals.length + 1, locale),
                output: "",
                recoverable: true,
              },
            ]
          : current.terminals,
        sessions: current.sessions.map((item) => (
          item.id === session.id
            ? {
                ...item,
                terminalId,
                terminalRuntimeId: terminalRuntimeId ?? item.terminalRuntimeId,
              }
            : item
        )),
      };
      nextSession = nextTab.sessions.find((item) => item.id === session.id) ?? nextSession;
      return nextTab;
    });
    if (typeof window !== "undefined") {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    }
    if (terminalRuntimeId) {
      updateState((current) => ({
        ...current,
        tabs: current.tabs.map((item) => item.id !== tab.id ? item : {
          ...item,
          sessions: item.sessions.map((entry) => entry.id !== session.id ? entry : {
            ...entry,
            terminalRuntimeId: terminalRuntimeId,
          }),
        }),
      }));
    }
    const latestTabBeforeAttach = stateRef.current.tabs.find((item) => item.id === tab.id);
    if (latestTabBeforeAttach && canMutateWorkspace(latestTabBeforeAttach.controller, "switch_pane")) {
      const viewPatch = createWorkspaceViewPatchFromTab(latestTabBeforeAttach);
      workspaceViewPersistSchedulerRef.current?.cancel(latestTabBeforeAttach.id);
      rememberWorkspaceViewPatchBaseline(latestTabBeforeAttach.id, viewPatch);
      noteWorkspaceViewPersistRequest(latestTabBeforeAttach.id, viewPatch);
      await withServiceFallback(
        () => updateWorkspaceView(latestTabBeforeAttach.id, viewPatch, latestTabBeforeAttach.controller),
        null,
      );
    }
    const runtimeSnapshot = await attachWorkspaceRuntimeWithRetry(
      tab.id,
      deviceId,
      clientId,
      withServiceFallback,
      {
        force: true,
        successReuseMs: 0,
      },
    );
    if (runtimeSnapshot && isWorkspaceSyncVersionCurrent(tab.id, syncVersion)) {
      updateState((current) => {
        const next = applyWorkspaceRuntimeSnapshot(
          current,
          runtimeSnapshot,
          locale,
          appSettings,
          deviceId,
          clientId,
        );
        nextTab = next.tabs.find((item) => item.id === tab.id) ?? nextTab;
        nextSession = nextTab.sessions.find((item) => item.id === session.id) ?? nextSession;
        return next;
      });
    }
    if (!isWorkspaceSyncVersionCurrent(tab.id, syncVersion)) {
      return null;
    }
    focusAgentTerminal(agentRuntimeRefs, paneId);
    return { tab: nextTab, session: nextSession };
  };

  const sendAgentRawChunk = async (tab: Tab, session: Session, input: string) => {
    if (!guardWorkspaceMutation("agent_input", tab.id, session.id)) return false;
    if (!session.terminalRuntimeId) return false;
    const lastActiveAt = Date.now();
    updateTab(tab.id, (current) => ({
      ...current,
      sessions: current.sessions.map((item) =>
        item.id === session.id ? { ...item, lastActiveAt } : item
      )
    }));
    void syncSessionPatch(tab.id, session.id, { last_active_at: lastActiveAt });
    sendTerminalChannelInput(tab.id, tab.controller.deviceId, tab.controller.clientId, tab.controller.fencingToken, session.terminalRuntimeId, input);
    return true;
  };

  const onRecoverActiveSession = async () => {
    let currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    let session = currentTab.sessions.find((item) => item.id === activePaneSession.id) ?? activePaneSession;
    const syncVersion = advanceWorkspaceSyncVersion(currentTab.id);
    const runtimeSnapshot = await attachWorkspaceRuntimeWithRetry(
      currentTab.id,
      deviceId,
      clientId,
      withServiceFallback,
    );
    if (runtimeSnapshot && isWorkspaceSyncVersionCurrent(currentTab.id, syncVersion)) {
      let nextTab: Tab | null = null;
      updateState((current) => {
        const next = applyWorkspaceRuntimeSnapshot(
          current,
          runtimeSnapshot,
          locale,
          appSettings,
          deviceId,
          clientId,
        );
        nextTab = next.tabs.find((tab) => tab.id === currentTab.id) ?? null;
        return next;
      });
      const refreshedTab = nextTab;
      if (refreshedTab) {
        currentTab = refreshedTab;
        session = refreshedTab.sessions.find((item) => item.id === session.id) ?? session;
      }
    }
    if (!isWorkspaceSyncVersionCurrent(currentTab.id, syncVersion)) return;
    const recoveryAction = resolveAgentRecoveryAction(currentTab.controller, session);
    if (!recoveryAction) return;
    setAgentRecoveryBusy({
      sessionId: session.id,
      kind: recoveryAction.kind,
    });
    try {
      await startSessionRuntimeInPane(currentTab.activePaneId, currentTab, session);
    } finally {
      setAgentRecoveryBusy((current) => (
        current?.sessionId === session.id ? null : current
      ));
    }
  };

  const onSwitchSession = (sessionId: string) => {
    if (!guardWorkspaceMutation("switch_session")) return;
    switchSessionInActiveTab(activeTab, sessionId);
  };

  const onCloseAgentPane = (paneId: string, sessionId: string) => {
    if (!guardWorkspaceMutation("close_session", activeTab.id, sessionId)) return;
    closeAgentPaneSession(activeTab, paneId, sessionId);
  };

  const onDraftProviderChange = (paneId: string, provider: Session["provider"]) => {
    const sessionId = findPaneSessionId(activeTab.paneLayout, paneId);
    if (!sessionId) return;
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      sessions: tab.sessions.map((session) => (
        session.id === sessionId && session.isDraft
          ? { ...session, provider }
          : session
      )),
    }));
  };

  const startAgentSessionInPane = async (paneId: string, tab: Tab, session: Session) => {
    const started = await startSessionRuntimeInPane(paneId, tab, session);
    if (!started) return false;
    touchSession(started.tab.id, started.session.id);
    focusWorkspaceAgentPane(paneId);
    return true;
  };

  const onStartDraftSession = async (paneId: string, provider: Session["provider"]) => {
    if (!guardWorkspaceMutation("agent_input")) return;

    onDraftProviderChange(paneId, provider);
    const tabSnapshot = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeTabId);
    if (!tabSnapshot) return;
    const paneSessionId = findPaneSessionId(tabSnapshot.paneLayout, paneId) ?? tabSnapshot.activeSessionId;
    const sessionSnapshot = tabSnapshot.sessions.find((session) => session.id === paneSessionId);
    if (!sessionSnapshot || !isDraftSession(sessionSnapshot)) return;

    const materialized = await materializeSession(tabSnapshot.id, sessionSnapshot.id, "");
    if (!materialized) return;
    await startAgentSessionInPane(paneId, materialized.tab, materialized.session);
  };

  const onRemoveUnavailableSession = (sessionId: string) => {
    const pane = activeTab.panes.find((item) => item.sessionId === sessionId);
    if (!pane) return;
    if (!guardWorkspaceMutation("close_session", activeTab.id, sessionId)) return;
    closeAgentPaneSession(activeTab, pane.id, sessionId);
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
      flushFitAgentTerminals: flushWorkspaceAgentFit,
    });
  };

  const toggleRightPane = (pane: "code" | "terminal") => {
    updateState((current) => toggleWorkspaceRightPane(current, pane));
    if (pane === "code") {
      setIsCodeExpanded(false);
    }
    requestAnimationFrame(() => {
      fitVisibleWorkspaceTerminals();
    });
  };

  const visiblePanelTerminals = filterWorkspacePanelTerminals(activeTab.terminals, activeTab.sessions);
  const activeTerminal = visiblePanelTerminals.find((t) => t.id === activeTab.activeTerminalId) ?? visiblePanelTerminals[0];
  const showAgentPanel = !isCodeExpanded;

  useEffect(() => {
    if (!activeTerminal || activeTerminal.recoverable) {
      return;
    }
    if (!canMutateWorkspace(activeTab.controller, "create_terminal")) {
      return;
    }

    const attemptKey = `${activeTab.id}:${activeTerminal.id}`;
    if (terminalRecoveryAttemptsRef.current.has(attemptKey)) {
      return;
    }
    terminalRecoveryAttemptsRef.current.add(attemptKey);

    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    const initialSize = measureWorkspaceTerminalSize();
    void replaceWorkspaceTerminal({
      tab: currentTab,
      terminalId: activeTerminal.id,
      updateTab,
      addToast,
      activeSessionId: activeSession.id,
      createToastId: () => createId("toast"),
      t,
      initialSize,
    });
  }, [
    activeSession.id,
    activeTab,
    activeTerminal,
    addToast,
    measureWorkspaceTerminalSize,
    t,
  ]);

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
      flushFitAgentTerminals: flushWorkspaceAgentFit,
    });
  };

  const onRunCommandPaletteAction = (action: CommandPaletteAction | undefined) => {
    if (!action) return;
    closeCommandPalette();
    action.run();
  };

  const ensureAgentPaneSessionReady = async (paneId: string) => {
    const activeTabSnapshot = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeTabId);
    if (!activeTabSnapshot) return null;
    const paneSessionId = findPaneSessionId(activeTabSnapshot.paneLayout, paneId) ?? activeTabSnapshot.activeSessionId;
    const activeSessionSnapshot = activeTabSnapshot.sessions.find((session) => session.id === paneSessionId);
    if (!activeSessionSnapshot) return null;
    if (activeSessionSnapshot.unavailableReason) return null;

    const materialized = isDraftSession(activeSessionSnapshot)
      ? await materializeSession(activeTabSnapshot.id, activeSessionSnapshot.id, "")
      : { tab: activeTabSnapshot, session: activeSessionSnapshot };
    let tabSnapshot = materialized?.tab ?? activeTabSnapshot;
    let sessionSnapshot = materialized?.session ?? activeSessionSnapshot;
    if (!tabSnapshot || !sessionSnapshot) return null;

    if (!sessionSnapshot.terminalRuntimeId) {
      const started = await startSessionRuntimeInPane(paneId, tabSnapshot, sessionSnapshot);
      if (!started) return null;
      tabSnapshot = started.tab;
      sessionSnapshot = started.session;
    }

    touchSession(tabSnapshot.id, sessionSnapshot.id);
    return { tab: tabSnapshot, session: sessionSnapshot };
  };

  const forwardAgentTerminalInput = async (paneId: string, data: string) => {
    if (!data) return;
    if (!guardWorkspaceMutation("agent_input")) return;
    const ready = await ensureAgentPaneSessionReady(paneId);
    if (!ready) return;
    applyTrackedAgentSessionTitle({
      refs: agentRuntimeRefs,
      paneId,
      tabId: ready.tab.id,
      sessionId: ready.session.id,
      session: ready.session,
      data,
      locale,
      t,
      updateTab,
      persistTitle: (title) => {
        void syncSessionPatch(ready.tab.id, ready.session.id, { title });
      },
    });
    await sendAgentRawChunk(ready.tab, ready.session, data);
  };

  const clearAgentTerminalInputFlushTimer = (paneId: string) => {
    const timer = agentTerminalInputFlushTimerRef.current.get(paneId);
    if (timer === undefined) return;
    clearTimeout(timer);
    agentTerminalInputFlushTimerRef.current.delete(paneId);
  };

  const scheduleAgentTerminalEscapeFlush = (paneId: string) => {
    clearAgentTerminalInputFlushTimer(paneId);
    const timer = setTimeout(() => {
      agentTerminalInputFlushTimerRef.current.delete(paneId);
      const pending = agentTerminalInputBufferRef.current.get(paneId);
      if (pending !== "\u001b") return;
      agentTerminalInputBufferRef.current.delete(paneId);
      void forwardAgentTerminalInput(paneId, pending);
    }, 24);
    agentTerminalInputFlushTimerRef.current.set(paneId, timer);
  };

  const onAgentTerminalData = async (paneId: string, data: string) => {
    if (!data) return;
    clearAgentTerminalInputFlushTimer(paneId);
    const bufferedInput = agentTerminalInputBufferRef.current.get(paneId) ?? "";
    const { forwarded, pending } = consumeTerminalChannelInputFragment(bufferedInput, data);
    if (pending) {
      agentTerminalInputBufferRef.current.set(paneId, pending);
      if (pending === "\u001b") {
        scheduleAgentTerminalEscapeFlush(paneId);
      }
    } else {
      agentTerminalInputBufferRef.current.delete(paneId);
    }
    if (!forwarded) return;
    await forwardAgentTerminalInput(paneId, forwarded);
  };

  const onSendSpecialAgentKey = async (paneId: string, sequence: string) => {
    if (!guardWorkspaceMutation("agent_input")) return;
    const ready = await ensureAgentPaneSessionReady(paneId);
    if (!ready) return;
    await sendAgentRawChunk(ready.tab, ready.session, sequence);
    focusWorkspaceAgentPane(paneId);
  };

  useEffect(() => {
    return () => {
      for (const timer of agentTerminalInputFlushTimerRef.current.values()) {
        clearTimeout(timer);
      }
      agentTerminalInputFlushTimerRef.current.clear();
      agentTerminalInputBufferRef.current.clear();
    };
  }, []);

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

      if (!hasModifier && !event.altKey && !event.shiftKey && key === "f" && !isEditableTarget) {
        event.preventDefault();
        setIsFocusMode((value) => !value);
        return;
      }

      if (!hasModifier && !event.altKey && !event.shiftKey && event.key === "Escape" && isFocusMode) {
        event.preventDefault();
        setIsFocusMode(false);
        return;
      }

      const isMacPlatform = typeof navigator !== "undefined" && (navigator.platform || "").toLowerCase().includes("mac");
      const isSplitShortcut = isMacPlatform
        ? event.metaKey && !event.ctrlKey && !event.altKey && key === "d"
        : event.altKey && !event.ctrlKey && !event.metaKey && key === "d";
      if (!isSplitShortcut) return;
      if (event.repeat) return;
      event.preventDefault();
      const splitAxis: "horizontal" | "vertical" = event.shiftKey ? "horizontal" : "vertical";
      splitPane(activeTab.activePaneId, splitAxis);
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
    isFocusMode
  ]);

  useEffect(() => {
    focusWorkspaceAgentPane();
  }, [activeTab.activePaneId, activePaneSession.id]);

  useEffect(() => {
    setCommitMessage("");
    setSelectedGitChangeKey("");
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
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    const session = tab?.sessions.find((item) => item.id === sessionId);
    if (!tab || !session?.terminalRuntimeId) return;
    if (!canMutateWorkspace(tab.controller, "resize_terminal")) return;
    const terminalId = resolveSessionTerminalIdByRuntimeId(tab.sessions, session.terminalRuntimeId, tab.terminals)
      ?? session.terminalId;
    if (!terminalId) return;
    syncWorkspaceTerminalSize(
      terminalSizeRef,
      tab.id,
      tab.controller,
      terminalId,
      size.cols,
      size.rows,
    );
  }, []);

  useEffect(() => {
    if (!showTerminalPanel || isCodeExpanded) return;
    requestAnimationFrame(() => {
      fitVisibleWorkspaceTerminals();
    });
  }, [fitVisibleWorkspaceTerminals, showTerminalPanel, isCodeExpanded, state.layout.rightSplit]);

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
  const workspaceUiReady = bootstrapReady && (state.tabs.length > 0 || state.overlay.visible || showWelcomeScreen);

  const workspaceTabs = state.tabs.map((tab) => {
    const sessions = [...tab.sessions].sort((left, right) => {
      if (sessionSort === "name") {
        return displaySessionTitle(left.title).localeCompare(displaySessionTitle(right.title), locale === "zh" ? "zh-CN" : "en");
      }
      return right.lastActiveAt - left.lastActiveAt;
    });
    const hasRunning = sessions.some((session) => session.status === "running");
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
  const previewPathLabel = resolveWorkspacePreviewPathLabel(
    activeTab.filePreview.path,
    activeTab.project?.path
  );

  const currentFileChangeCount = activeTab.git.changes;
  const workspaceShellSummary = buildWorkspaceShellSummary({
    branchName: activeTab.git.branch,
    changeCount: currentFileChangeCount,
    target: activeTab.project?.target,
    sessions: activeTab.sessions,
    t,
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
  const agentRecoveryAction = resolveAgentRecoveryAction(activeTab.controller, activePaneSession);
  const activeAgentRecoveryBusy = agentRecoveryBusy?.sessionId === activePaneSession.id
    ? agentRecoveryBusy
    : null;
  const visibleAgentRecoveryAction = agentRecoveryAction ?? activeAgentRecoveryBusy;
  const shellTerminalMode = resolveTerminalInteractionMode(
    showTerminalPanel && !isCodeExpanded,
    canMutateWorkspace(activeTab.controller, "shell_input"),
  );
  const agentInputEnabled = canMutateWorkspace(activeTab.controller, "agent_input");
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
  ) : visibleAgentRecoveryAction ? (
    <>
      {visibleAgentRecoveryAction && (
        <div
          className="workspace-status-banner recovery"
          data-testid="workspace-agent-recovery-banner"
        >
          <div className="workspace-status-banner-copy">
            <span className="workspace-status-banner-title">{t("workspaceAgentRecoveryTitle")}</span>
            <span className="workspace-status-banner-text">
              {visibleAgentRecoveryAction.kind === "resume"
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
              disabled={controllerActionBusy !== null || activeAgentRecoveryBusy !== null}
            >
              {visibleAgentRecoveryAction.kind === "resume"
                ? t("workspaceAgentResumeAction")
                : t("workspaceAgentRestartAction")}
            </button>
          </div>
        </div>
      )}
    </>
  ) : null;
  const workspaceAgentPanel = (
    <AgentWorkspaceFeature
      visible={showAgentPanel}
      agentInputEnabled={agentInputEnabled}
      locale={locale}
      activeTab={activeTab}
      activePaneSession={activePaneSession}
      showCodePanel={showCodePanel}
      theme={theme}
      terminalFontSize={editorMetrics.terminalFontSize}
      terminalCompatibilityMode={terminalCompatibilityMode}
      displaySessionTitle={displaySessionTitle}
      onRemoveUnavailableSession={(sessionId) => {
        void onRemoveUnavailableSession(sessionId);
      }}
      onSetActivePane={setActivePane}
      onSplitPane={splitPane}
      onCloseAgentPane={onCloseAgentPane}
      onStartDraftSession={(paneId, provider) => {
        void onStartDraftSession(paneId, provider);
      }}
      onEnableSupervisor={(sessionId, provider) => {
        void onEnableSupervisor(sessionId, provider);
      }}
      onEditSupervisorObjective={(sessionId, currentObjective) => {
        void onEditSupervisorObjective(sessionId, currentObjective);
      }}
      onPauseSupervisor={(sessionId) => {
        void onPauseSupervisor(sessionId);
      }}
      onResumeSupervisor={(sessionId) => {
        void onResumeSupervisor(sessionId);
      }}
      onDisableSupervisor={(sessionId) => {
        void onDisableSupervisor(sessionId);
      }}
      onRetrySupervisor={(sessionId) => {
        void onRetrySupervisor(sessionId);
      }}
      onTriggerSupervisor={(sessionId) => {
        void onTriggerSupervisor(sessionId);
      }}
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
      t={t}
    />
  ) : null;

  const workspaceTerminalPanel = (
    <WorkspaceTerminalFeature
      visible={!isCodeExpanded && showTerminalPanel}
      progressPercent={terminalProgressPercent}
      progressTone={terminalProgressTone}
      activeTerminal={activeTerminal ? { id: activeTerminal.id, output: activeTerminal.output ?? "" } : undefined}
      mode={shellTerminalMode}
      terminals={visiblePanelTerminals.map((term) => ({
        id: term.id,
        title: displayTerminalTitle(term.title)
      }))}
      terminalViewportRef={shellTerminalViewportRef}
      shellTerminalRef={shellTerminalRef}
      theme={theme}
      fontSize={editorMetrics.terminalFontSize}
      compatibilityMode={terminalCompatibilityMode}
      autoFocus={shellTerminalMode === "interactive"}
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
            onSwitchWorkspace={onSwitchWorkspace}
            onAddTab={onOpenWorkspacePicker}
            onRemoveTab={onRemoveTab}
            onOpenSettings={onOpenSettings}
            onCloseSettings={() => {}}
            onOpenCommandPalette={openCommandPalette}
            t={t}
          />

          <ConfirmDialog state={confirmDialog} locale={locale} t={t} />
          <SupervisorObjectiveDialog
            visible={supervisorObjectiveDialog.visible}
            mode={supervisorObjectiveDialog.mode}
            t={t}
            objectiveText={supervisorObjectiveDialog.draftObjective}
            onObjectiveTextChange={(value) => {
              setSupervisorObjectiveDialog((current) => ({
                ...current,
                draftObjective: value,
              }));
            }}
            onCancel={closeSupervisorObjectiveDialog}
            onConfirm={() => {
              void submitSupervisorObjectiveDialog();
            }}
          />

          {showWelcomeScreen ? (
            <WorkspaceWelcomeScreen
              onOpenWorkspacePicker={onOpenWorkspacePicker}
              onOpenSettings={onOpenSettings}
              t={t}
            />
          ) : hasOpenWorkspace ? (
            <WorkspaceShell
              isFocusMode={isFocusMode}
              isCodeExpanded={isCodeExpanded}
              showAgentPanel={showAgentPanel}
              showCodePanel={showCodePanel}
              showTerminalPanel={showTerminalPanel}
              rightSplit={state.layout.rightSplit}
              statusItems={workspaceShellSummary}
              statusBanner={workspaceStatusBanner}
              agentPanel={workspaceAgentPanel}
              codePanel={workspaceCodePanel}
              terminalPanel={workspaceTerminalPanel}
              onToggleRightPane={toggleRightPane}
              onToggleCodeExpanded={() => {
                void toggleCodeExpanded();
              }}
              t={t}
            />
          ) : null}

          {commandPaletteOpen && (
            <CommandPalette
              locale={locale}
              t={t}
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
            onClose={onCloseWorkspaceOverlay}
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
            onClose={onCloseWorkspaceOverlay}
            onStartWorkspace={onStartWorkspace}
            t={t}
          />
        </>
      )}
    </div>
  );
}
