import taskCompleteSoundUrl from "../../assets/task-complete.wav";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRelaxState } from "@relax-state/react";
import { useNavigate } from "react-router-dom";
import type { XtermBaseHandle } from "../../components/terminal";
import { createTranslator, type Locale } from "../../i18n";
import { withFallback } from "../../services/http/client";
import {
  switchSession as switchSessionRequest,
  updateSession as updateSessionRequest,
  updateIdlePolicy as updateIdlePolicyRequest,
} from "../../services/http/session.service";
import {
  activateWorkspace as activateWorkspaceRequest,
  heartbeatWorkspaceController,
  releaseWorkspaceControllerKeepalive,
  requestWorkspaceTakeover,
} from "../../services/http/workspace.service";
import { findPaneIdBySessionId } from "../../shared/utils/panes";
import {
  parseNumericId,
  restoreVisibleStatus,
  toBackgroundStatus,
} from "../../shared/utils/session";
import {
  applyWorkbenchUiState,
  applyWorkspaceControllerEvent,
  applyWorkspaceRuntimeSnapshot,
} from "../../shared/utils/workspace";
import {
  syncWorkbenchStateSnapshot,
  updateWorkbenchStateSnapshot,
} from "../../shared/utils/workbench-state-snapshot";
import {
  getIdlePolicySyncWorkspaceIds,
} from "../../shared/app/app-settings";
import { workbenchState } from "../../state/workbench";
import type {
  Tab,
  WorkbenchState,
} from "../../state/workbench-core";
import type { AppSettings, SessionPatch } from "../../types/app";
import {
  type AgentRuntimeRefs,
} from "../agents";
import {
  isCompletionReminderBackgroundCase,
  notifyCompletionReminder,
  playCompletionReminderSound,
} from "../workspace/completion-reminders";
import {
  collectControlledWorkspaceReleasePayloads,
  getOrCreateClientId as getWorkspaceClientId,
  getOrCreateDeviceId as getWorkspaceDeviceId,
  shouldRecoverWorkspaceController,
} from "../workspace/workspace-controller";
import {
  attachWorkspaceRuntimeWithRetry,
  CONTROLLER_RECOVERY_ATTACH_SUCCESS_REUSE_MS,
  READY_TAB_ATTACH_SUCCESS_REUSE_MS,
  type WorkspaceRuntimeAttachRequestOptions,
} from "../workspace/runtime-attach";
import {
  READY_TAB_RUNTIME_RECOVERY_DELAYS_MS,
  collectReadyTabRuntimeRecoveryWorkspaceIds,
} from "../workspace/workspace-ready-runtime";
import { createWorkspaceSessionActions } from "../workspace/session-actions";
import {
  isWorkspaceSyncVersionCurrent,
  readWorkspaceSyncVersion,
} from "../workspace/workspace-sync-version";
import { useWorkspaceTransportSync } from "../workspace/workspace-sync-hooks";

const withServiceFallback = async <T,>(
  operation: () => Promise<T>,
  fallback: T,
): Promise<T> => withFallback(operation, fallback);

const CONTROLLER_HEARTBEAT_INTERVAL_MS = 10_000;
const HIDDEN_CONTROLLER_HEARTBEAT_INTERVAL_MS = 20_000;
const CONTROLLER_RECOVERY_INTERVAL_MS = 1_000;
const HIDDEN_CONTROLLER_RECOVERY_INTERVAL_MS = 5_000;
const TAKEOVER_POLL_INTERVAL_MS = 2_000;
const HIDDEN_TAKEOVER_POLL_INTERVAL_MS = 5_000;

type WorkbenchRuntimeCoordinatorProps = {
  appSettings: AppSettings;
  locale: Locale;
  settingsConfirmed: boolean;
};

export const WorkbenchRuntimeCoordinator = ({
  appSettings,
  locale,
  settingsConfirmed,
}: WorkbenchRuntimeCoordinatorProps) => {
  const navigate = useNavigate();
  const [storeState, setStoreState] = useRelaxState(workbenchState);
  const [state, setRenderState] = useState(storeState);
  const stateRef = useRef(state);
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === "undefined" ? true : navigator.onLine !== false
  ));
  const [isWindowFocused, setIsWindowFocused] = useState(() => (
    typeof document === "undefined" ? true : document.hasFocus()
  ));
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => (
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  ));
  const completionReminderAudioRef = useRef<HTMLAudioElement | null>(null);
  const draftPromptInputRefs = useRef(new Map<string, HTMLInputElement | null>());
  const agentTerminalRefs = useRef(new Map<string, XtermBaseHandle | null>());
  const agentTerminalQueueRef = useRef(new Map<string, Promise<void>>());
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
  const runningAgentKeysRef = useRef(new Set<string>());
  const agentStartupStateRef = useRef(new Map<string, {
    token: number;
    startedAt: number;
    lastEventAt: number;
    sawOutput: boolean;
    sawReady: boolean;
    exited: boolean;
  }>());
  const agentStartupTokenRef = useRef(0);
  const runtimeAttachInflightRef = useRef(new Map<string, Promise<void>>());
  const heartbeatInflightRef = useRef(new Set<string>());
  const takeoverPollingInflightRef = useRef(new Set<string>());
  const t = useMemo(() => createTranslator(locale), [locale]);
  const deviceId = useMemo(() => getWorkspaceDeviceId(), []);
  const clientId = useMemo(() => getWorkspaceClientId(), []);

  const agentRuntimeRefs = useMemo<AgentRuntimeRefs>(() => ({
    draftPromptInputRefs,
    agentTerminalRefs,
    agentTerminalQueueRef,
    agentPaneSizeRef,
    agentTitleTrackerRef,
    agentStartupStateRef,
    agentStartupTokenRef,
  }), []);

  useLayoutEffect(() => {
    stateRef.current = storeState;
    syncWorkbenchStateSnapshot(storeState);
    setRenderState((current) => (current === storeState ? current : storeState));
  }, [storeState]);

  useEffect(() => {
    const audio = new Audio(taskCompleteSoundUrl);
    audio.preload = "auto";
    completionReminderAudioRef.current = audio;
    return () => {
      completionReminderAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const syncVisibility = () => {
      setIsWindowFocused(document.hasFocus());
      setIsDocumentVisible(document.visibilityState === "visible");
    };

    window.addEventListener("focus", syncVisibility);
    window.addEventListener("blur", syncVisibility);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      window.removeEventListener("focus", syncVisibility);
      window.removeEventListener("blur", syncVisibility);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncOnlineState = () => {
      setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine !== false);
    };

    syncOnlineState();
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);
    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const releaseControllers = () => {
      collectControlledWorkspaceReleasePayloads(stateRef.current.tabs).forEach((payload) => {
        releaseWorkspaceControllerKeepalive(payload.workspaceId, {
          role: "controller",
          deviceId: payload.deviceId,
          clientId: payload.clientId,
          fencingToken: payload.fencingToken,
          takeoverPending: false,
          takeoverRequestedBySelf: false,
        });
      });
    };

    window.addEventListener("pagehide", releaseControllers);
    return () => {
      window.removeEventListener("pagehide", releaseControllers);
    };
  }, []);

  const updateState = useCallback((updater: (current: WorkbenchState) => WorkbenchState) => {
    const next = updateWorkbenchStateSnapshot(updater);
    stateRef.current = next;
    setRenderState(next);
    setStoreState(next);
  }, [setStoreState]);

  const hasLiveWorkspaceTab = useCallback((workspaceId: string) => (
    stateRef.current.tabs.some((tab) => tab.id === workspaceId)
  ), []);

  const updateTab = useCallback((tabId: string, updater: (tab: Tab) => Tab) => {
    updateState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
    }));
  }, [updateState]);

  const syncSessionPatch = useCallback(async (
    tabId: string,
    sessionId: string,
    patch: Pick<SessionPatch, "status" | "last_active_at" | "resume_id">,
  ) => {
    const backendSessionId = parseNumericId(sessionId);
    if (backendSessionId === null) return;
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    if (!tab || tab.controller.role !== "controller") return;
    await withServiceFallback(
      () => updateSessionRequest(tabId, backendSessionId, patch, tab.controller),
      null,
    );
  }, []);

  const switchWorkspaceSessionFromReminder = useCallback((tabId: string, sessionId: string) => {
    const currentState = stateRef.current;
    const targetTabSnapshot = currentState.tabs.find((tab) => tab.id === tabId);
    const nextSession = targetTabSnapshot?.sessions.find((session) => session.id === sessionId);
    if (!targetTabSnapshot || !nextSession) {
      return;
    }
    if (targetTabSnapshot.controller.role !== "controller") {
      navigate(`/workspace/${tabId}`);
      return;
    }

    const nextActiveAt = Date.now();
    updateState((current) => {
      const targetTab = current.tabs.find((tab) => tab.id === tabId);
      if (!targetTab) return current;

      const targetPaneId = findPaneIdBySessionId(targetTab.paneLayout, sessionId) ?? targetTab.activePaneId;
      const previousActiveTabId = current.activeTabId;
      return {
        ...current,
        activeTabId: tabId,
        overlay: {
          ...current.overlay,
          visible: false,
        },
        tabs: current.tabs.map((tab) => {
          if (tab.id === tabId) {
            return {
              ...tab,
              activeSessionId: sessionId,
              activePaneId: targetPaneId,
              viewingArchiveId: undefined,
              sessions: tab.sessions.map((session) => {
                if (session.id === sessionId) {
                  return {
                    ...session,
                    unread: 0,
                    status: restoreVisibleStatus(session),
                    lastActiveAt: nextActiveAt,
                  };
                }
                if (session.id === tab.activeSessionId) {
                  return { ...session, status: toBackgroundStatus(session.status) };
                }
                return session;
              }),
            };
          }

          if (tab.id === previousActiveTabId) {
            return {
              ...tab,
              sessions: tab.sessions.map((session) => (
                session.id === tab.activeSessionId
                  ? { ...session, status: toBackgroundStatus(session.status) }
                  : session
              )),
            };
          }

          return tab;
        }),
      };
    });

    const backendSessionId = parseNumericId(sessionId);
    if (backendSessionId !== null) {
      void switchSessionRequest(tabId, backendSessionId, targetTabSnapshot.controller).catch(() => {
        // Frontend state already switched optimistically.
      });
    }

    if (currentState.activeTabId !== tabId) {
      void withServiceFallback(() => activateWorkspaceRequest(tabId, deviceId, clientId), null).then((uiState) => {
        if (!uiState) return;
        updateState((current) => applyWorkbenchUiState(current, uiState));
      });
    }

    void syncSessionPatch(tabId, sessionId, {
      status: restoreVisibleStatus(nextSession),
      last_active_at: nextActiveAt,
    });

    navigate(`/workspace/${tabId}`);
  }, [navigate, syncSessionPatch, updateState]);

  const onCompletionReminder = useCallback(async ({
    workspaceId,
    workspaceTitle,
    sessionId,
    sessionTitle,
  }: {
    workspaceId: string;
    workspaceTitle: string;
    sessionId: string;
    sessionTitle: string;
  }) => {
    if (!appSettings.general.completionNotifications.enabled) {
      return;
    }

    const currentState = stateRef.current;
    const isBackgroundCase = isCompletionReminderBackgroundCase(
      {
        workspaceId,
        workspaceTitle,
        sessionId,
        sessionTitle,
      },
      {
        activeWorkspaceId: currentState.activeTabId,
        activeSessionId: currentState.tabs.find((tab) => tab.id === currentState.activeTabId)?.activeSessionId,
        documentVisible: isDocumentVisible,
        windowFocused: isWindowFocused,
      },
    );

    if (appSettings.general.completionNotifications.onlyWhenBackground && !isBackgroundCase) {
      return;
    }

    await playCompletionReminderSound(completionReminderAudioRef.current);
    await notifyCompletionReminder({
      title: sessionTitle,
      body: t("completionNotificationBody", { workspaceTitle }),
      onClick: () => {
        switchWorkspaceSessionFromReminder(workspaceId, sessionId);
      },
    });
  }, [
    appSettings.general.completionNotifications,
    isDocumentVisible,
    isWindowFocused,
    switchWorkspaceSessionFromReminder,
    t,
  ]);

  const {
    markSessionIdle,
    settleSessionAfterExit,
  } = createWorkspaceSessionActions({
    appSettings,
    locale,
    t,
    stateRef,
    updateTab,
    withServiceFallback,
    addToast: () => {},
    onCompletionReminder,
  });

  const reattachWorkspaceRuntime = useCallback(async (
    workspaceId: string,
    options: WorkspaceRuntimeAttachRequestOptions = {},
  ) => {
    const inflight = runtimeAttachInflightRef.current.get(workspaceId);
    if (inflight) {
      await inflight;
      return;
    }

    const task = (async () => {
      const syncVersion = readWorkspaceSyncVersion(workspaceId);
      const runtimeSnapshot = await attachWorkspaceRuntimeWithRetry(
        workspaceId,
        deviceId,
        clientId,
        withServiceFallback,
        options,
      );
      if (
        !runtimeSnapshot
        || !hasLiveWorkspaceTab(workspaceId)
        || !isWorkspaceSyncVersionCurrent(workspaceId, syncVersion)
      ) {
        return;
      }
      updateState((current) => {
        if (
          !current.tabs.some((tab) => tab.id === workspaceId)
          || !isWorkspaceSyncVersionCurrent(workspaceId, syncVersion)
        ) {
          return current;
        }
        return applyWorkspaceRuntimeSnapshot(
          current,
          runtimeSnapshot,
          locale,
          appSettings,
          deviceId,
          clientId,
        );
      });
    })().finally(() => {
      runtimeAttachInflightRef.current.delete(workspaceId);
    });

    runtimeAttachInflightRef.current.set(workspaceId, task);
    await task;
  }, [appSettings, clientId, deviceId, hasLiveWorkspaceTab, locale, updateState]);

  useWorkspaceTransportSync({
    agentRuntimeRefs,
    bootstrapReady: state.tabs.length > 0,
    clientId,
    deviceId,
    markSessionIdle,
    reattachWorkspaceRuntime,
    settleSessionAfterExit,
    syncSessionPatch,
    stateRef,
    t,
    updateState,
  });

  const attachedWorkspaceFingerprint = useMemo(
    () => state.tabs
      .filter((tab) => tab.status === "ready")
      .map((tab) => tab.id)
      .join("|"),
    [state.tabs],
  );

  useEffect(() => {
    if (!attachedWorkspaceFingerprint || !isOnline) {
      return;
    }

    let cancelled = false;
    const recoverReadyTabs = () => {
      if (cancelled) {
        return;
      }
      const workspaceIds = collectReadyTabRuntimeRecoveryWorkspaceIds(stateRef.current.tabs);
      void Promise.all(workspaceIds.map(async (workspaceId) => {
        await reattachWorkspaceRuntime(workspaceId, {
          successReuseMs: READY_TAB_ATTACH_SUCCESS_REUSE_MS,
        });
      }));
    };

    recoverReadyTabs();
    const timers = READY_TAB_RUNTIME_RECOVERY_DELAYS_MS
      .filter((delayMs) => delayMs > 0)
      .map((delayMs) => window.setTimeout(recoverReadyTabs, delayMs));

    return () => {
      cancelled = true;
      timers.forEach((timer) => {
        window.clearTimeout(timer);
      });
    };
  }, [attachedWorkspaceFingerprint, isOnline, reattachWorkspaceRuntime]);

  const controllerHeartbeatFingerprint = useMemo(
    () => state.tabs
      .filter((tab) => tab.status === "ready" && tab.controller.role === "controller")
      .map((tab) => `${tab.id}:${tab.controller.fencingToken}`)
      .join("|"),
    [state.tabs],
  );

  useEffect(() => {
    if (!controllerHeartbeatFingerprint || !isOnline) {
      return;
    }

    const controllerWorkspaceIds = () => stateRef.current.tabs
      .filter((tab) => tab.status === "ready" && tab.controller.role === "controller")
      .map((tab) => tab.id);

    const sendHeartbeat = () => {
      controllerWorkspaceIds().forEach((workspaceId) => {
        if (heartbeatInflightRef.current.has(workspaceId)) {
          return;
        }
        heartbeatInflightRef.current.add(workspaceId);
        void heartbeatWorkspaceController(workspaceId, deviceId, clientId)
          .then((controller) => {
            if (!controller) {
              return;
            }
            updateState((current) => applyWorkspaceControllerEvent(current, {
              workspace_id: workspaceId,
              controller,
            }, deviceId, clientId));
          })
          .catch(() => {
            // The WS controller stream or next attach will converge the UI.
          })
          .finally(() => {
            heartbeatInflightRef.current.delete(workspaceId);
          });
      });
    };

    sendHeartbeat();
    const timer = window.setInterval(
      sendHeartbeat,
      isDocumentVisible ? CONTROLLER_HEARTBEAT_INTERVAL_MS : HIDDEN_CONTROLLER_HEARTBEAT_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(timer);
    };
  }, [clientId, controllerHeartbeatFingerprint, deviceId, isDocumentVisible, isOnline, updateState]);

  const controllerRecoveryFingerprint = useMemo(
    () => state.tabs
      .filter((tab) =>
        tab.status === "ready"
        && shouldRecoverWorkspaceController(tab.controller),
      )
      .map((tab) => tab.id)
      .join("|"),
    [state.tabs],
  );

  useEffect(() => {
    if (!controllerRecoveryFingerprint || !isOnline) {
      return;
    }

    const recoverableWorkspaceIds = () => stateRef.current.tabs
      .filter((tab) =>
        tab.status === "ready"
        && shouldRecoverWorkspaceController(tab.controller),
      )
      .map((tab) => tab.id);

    const recoverControllers = () => {
      // Observer tabs can miss an initial runtime attach/controller event during reloads.
      // Reattaching until the tab converges keeps recovery/replay flows stable across slower environments.
      void Promise.all(recoverableWorkspaceIds().map(async (workspaceId) => {
        await reattachWorkspaceRuntime(workspaceId, {
          successReuseMs: CONTROLLER_RECOVERY_ATTACH_SUCCESS_REUSE_MS,
        });
      }));
    };

    recoverControllers();
    const timer = window.setInterval(
      recoverControllers,
      isDocumentVisible ? CONTROLLER_RECOVERY_INTERVAL_MS : HIDDEN_CONTROLLER_RECOVERY_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(timer);
    };
  }, [controllerRecoveryFingerprint, isDocumentVisible, isOnline, reattachWorkspaceRuntime]);

  const takeoverPollingFingerprint = useMemo(
    () => state.tabs
      .filter((tab) =>
        tab.status === "ready"
        && tab.controller.role === "observer"
        && tab.controller.takeoverPending
        && tab.controller.takeoverRequestedBySelf,
      )
      .map((tab) => `${tab.id}:${tab.controller.takeoverDeadlineAt ?? 0}`)
      .join("|"),
    [state.tabs],
  );

  useEffect(() => {
    if (!takeoverPollingFingerprint || !isOnline) {
      return;
    }

    const takeoverWorkspaceIds = () => stateRef.current.tabs
      .filter((tab) =>
        tab.status === "ready"
        && tab.controller.role === "observer"
        && tab.controller.takeoverPending
        && tab.controller.takeoverRequestedBySelf,
      )
      .map((tab) => tab.id);

    const pollTakeover = () => {
      takeoverWorkspaceIds().forEach((workspaceId) => {
        if (takeoverPollingInflightRef.current.has(workspaceId)) {
          return;
        }
        takeoverPollingInflightRef.current.add(workspaceId);
        void requestWorkspaceTakeover(workspaceId, deviceId, clientId)
          .then((controller) => {
            updateState((current) => applyWorkspaceControllerEvent(current, {
              workspace_id: workspaceId,
              controller,
            }, deviceId, clientId));
          })
          .catch(() => {
            // Keep waiting; the controller stream is the primary source of truth.
          })
          .finally(() => {
            takeoverPollingInflightRef.current.delete(workspaceId);
          });
      });
    };

    pollTakeover();
    const timer = window.setInterval(
      pollTakeover,
      isDocumentVisible ? TAKEOVER_POLL_INTERVAL_MS : HIDDEN_TAKEOVER_POLL_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(timer);
    };
  }, [clientId, deviceId, isDocumentVisible, isOnline, takeoverPollingFingerprint, updateState]);

  const idlePolicyFingerprint = useMemo(() => state.tabs.map((tab) => [
    tab.id,
    tab.idlePolicy.enabled ? "1" : "0",
    String(tab.idlePolicy.idleMinutes),
    String(tab.idlePolicy.maxActive),
    tab.idlePolicy.pressure ? "1" : "0",
  ].join(":")).join("|"), [state.tabs]);

  useEffect(() => {
    const idlePolicyWorkspaceIds = getIdlePolicySyncWorkspaceIds(
      stateRef.current.tabs,
      appSettings.general.idlePolicy,
      settingsConfirmed,
    );

    if (idlePolicyWorkspaceIds.length === 0) {
      return;
    }

    updateState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (
        idlePolicyWorkspaceIds.includes(tab.id)
          ? {
              ...tab,
              idlePolicy: { ...appSettings.general.idlePolicy },
            }
          : tab
      )),
    }));

    idlePolicyWorkspaceIds.forEach((workspaceId) => {
      const tab = stateRef.current.tabs.find((item) => item.id === workspaceId);
      if (!tab || tab.controller.role !== "controller") {
        return;
      }
      void updateIdlePolicyRequest(
        workspaceId,
        appSettings.general.idlePolicy,
        tab.controller,
      ).catch(() => {
        // Best effort sync; in-memory settings remain source of truth if backend lags.
      });
    });
  }, [appSettings.general.idlePolicy, idlePolicyFingerprint, settingsConfirmed, updateState]);

  return null;
};
