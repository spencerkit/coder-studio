import taskCompleteSoundUrl from "../../assets/task-complete.wav";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRelaxState } from "@relax-state/react";
import { useNavigate } from "react-router-dom";
import type { XtermBaseHandle } from "../../components/terminal";
import { createTranslator, type Locale } from "../../i18n";
import { withFallback } from "../../services/http/client.ts";
import {
  switchSession as switchSessionRequest,
  updateSession as updateSessionRequest,
  updateIdlePolicy as updateIdlePolicyRequest,
} from "../../services/http/session.service.ts";
import {
  activateWorkspace as activateWorkspaceRequest,
  attachWorkspaceRuntime,
  heartbeatWorkspaceController,
  releaseWorkspaceControllerKeepalive,
  requestWorkspaceTakeover,
} from "../../services/http/workspace.service.ts";
import { cloneAppSettings } from "../../shared/app/settings";
import { findPaneIdBySessionId } from "../../shared/utils/panes";
import {
  isForegroundActiveStatus,
  parseNumericId,
  restoreVisibleStatus,
  toBackgroundStatus,
} from "../../shared/utils/session";
import {
  applyWorkbenchUiState,
  applyWorkspaceControllerEvent,
  applyWorkspaceRuntimeSnapshot,
} from "../../shared/utils/workspace";
import { workbenchState } from "../../state/workbench";
import type {
  Tab,
  WorkbenchState,
} from "../../state/workbench-core.ts";
import type { AppSettings } from "../../types/app";
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
} from "../workspace/workspace-controller";
import { createWorkspaceSessionActions } from "../workspace/session-actions";
import { useWorkspaceTransportSync } from "../workspace/workspace-sync-hooks";
import {
  applyAppSettingsToTabs,
  summarizeWorkbenchSettingsSync,
} from "./workbench-settings-sync";

const withServiceFallback = async <T,>(
  operation: () => Promise<T>,
  fallback: T,
): Promise<T> => withFallback(operation, fallback);

type WorkbenchRuntimeCoordinatorProps = {
  appSettings: AppSettings;
  locale: Locale;
};

export const WorkbenchRuntimeCoordinator = ({
  appSettings,
  locale,
}: WorkbenchRuntimeCoordinatorProps) => {
  const navigate = useNavigate();
  const [state, setState] = useRelaxState(workbenchState);
  const stateRef = useRef(state);
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
  const t = useMemo(() => createTranslator(locale), [locale]);
  const deviceId = useMemo(() => getWorkspaceDeviceId(), []);
  const clientId = useMemo(() => getWorkspaceClientId(), []);

  const agentRuntimeRefs = useMemo<AgentRuntimeRefs>(() => ({
    draftPromptInputRefs,
    agentTerminalRefs,
    agentTerminalQueueRef,
    agentPaneSizeRef,
    agentRuntimeSizeRef,
    agentResizeStateRef,
    agentTitleTrackerRef,
    runningAgentKeysRef,
    agentStartupStateRef,
    agentStartupTokenRef,
  }), []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

    syncVisibility();
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
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, [setState]);

  const updateTab = useCallback((tabId: string, updater: (tab: Tab) => Tab) => {
    updateState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)),
    }));
  }, [updateState]);

  const syncSessionPatch = useCallback(async (
    tabId: string,
    sessionId: string,
    patch: {
      status?: string;
      last_active_at?: number;
      claude_session_id?: string;
    },
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
    const previousTabSnapshot = currentState.tabs.find((tab) => tab.id === currentState.activeTabId);
    const previousSession = previousTabSnapshot?.sessions.find((session) => session.id === previousTabSnapshot.activeSessionId);
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

    if (previousTabSnapshot && previousSession && isForegroundActiveStatus(previousSession.status)) {
      void syncSessionPatch(previousTabSnapshot.id, previousSession.id, { status: "background" });
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
    if (!appSettings.completionNotifications.enabled) {
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

    if (appSettings.completionNotifications.onlyWhenBackground && !isBackgroundCase) {
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
  }, [appSettings.completionNotifications, isDocumentVisible, isWindowFocused, switchWorkspaceSessionFromReminder, t]);

  const {
    markSessionIdle,
    refreshTabFromBackend,
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

  useWorkspaceTransportSync({
    agentRuntimeRefs,
    bootstrapReady: state.tabs.length > 0,
    clientId,
    deviceId,
    refreshTabFromBackend,
    markSessionIdle,
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
    if (!attachedWorkspaceFingerprint) {
      return;
    }

    let cancelled = false;
    const workspaceIds = state.tabs
      .filter((tab) => tab.status === "ready")
      .map((tab) => tab.id);

    void Promise.all(workspaceIds.map(async (workspaceId) => {
      const runtimeSnapshot = await withServiceFallback(
        () => attachWorkspaceRuntime(workspaceId, deviceId, clientId),
        null,
      );
      if (!runtimeSnapshot || cancelled) return;
      updateState((current) => applyWorkspaceRuntimeSnapshot(
        current,
        runtimeSnapshot,
        locale,
        appSettings,
        deviceId,
        clientId,
      ));
    }));

    return () => {
      cancelled = true;
    };
  }, [appSettings, attachedWorkspaceFingerprint, clientId, deviceId, locale, updateState]);

  const controllerHeartbeatFingerprint = useMemo(
    () => state.tabs
      .filter((tab) => tab.status === "ready" && tab.controller.role === "controller")
      .map((tab) => `${tab.id}:${tab.controller.fencingToken}`)
      .join("|"),
    [state.tabs],
  );

  useEffect(() => {
    if (!controllerHeartbeatFingerprint) {
      return;
    }

    const controllerWorkspaceIds = () => stateRef.current.tabs
      .filter((tab) => tab.status === "ready" && tab.controller.role === "controller")
      .map((tab) => tab.id);

    const sendHeartbeat = () => {
      controllerWorkspaceIds().forEach((workspaceId) => {
        void heartbeatWorkspaceController(workspaceId, deviceId, clientId)
          .then((controller) => {
            updateState((current) => applyWorkspaceControllerEvent(current, {
              workspace_id: workspaceId,
              controller,
            }, deviceId, clientId));
          })
          .catch(() => {
            // The WS controller stream or next attach will converge the UI.
          });
      });
    };

    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 10000);
    return () => {
      window.clearInterval(timer);
    };
  }, [clientId, controllerHeartbeatFingerprint, deviceId, updateState]);

  const controllerRecoveryFingerprint = useMemo(
    () => state.tabs
      .filter((tab) =>
        tab.status === "ready"
        && tab.controller.role === "observer"
        && !tab.controller.controllerDeviceId
        && !tab.controller.controllerClientId
        && !tab.controller.takeoverPending,
      )
      .map((tab) => tab.id)
      .join("|"),
    [state.tabs],
  );

  useEffect(() => {
    if (!controllerRecoveryFingerprint) {
      return;
    }

    let cancelled = false;
    const recoverableWorkspaceIds = () => stateRef.current.tabs
      .filter((tab) =>
        tab.status === "ready"
        && tab.controller.role === "observer"
        && !tab.controller.controllerDeviceId
        && !tab.controller.controllerClientId
        && !tab.controller.takeoverPending,
      )
      .map((tab) => tab.id);

    const recoverControllers = () => {
      void Promise.all(recoverableWorkspaceIds().map(async (workspaceId) => {
        const runtimeSnapshot = await withServiceFallback(
          () => attachWorkspaceRuntime(workspaceId, deviceId, clientId),
          null,
        );
        if (!runtimeSnapshot || cancelled) return;
        updateState((current) => applyWorkspaceRuntimeSnapshot(
          current,
          runtimeSnapshot,
          locale,
          appSettings,
          deviceId,
          clientId,
        ));
      }));
    };

    recoverControllers();
    const timer = window.setInterval(recoverControllers, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [appSettings, clientId, controllerRecoveryFingerprint, deviceId, locale, updateState]);

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
    if (!takeoverPollingFingerprint) {
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
        void requestWorkspaceTakeover(workspaceId, deviceId, clientId)
          .then((controller) => {
            updateState((current) => applyWorkspaceControllerEvent(current, {
              workspace_id: workspaceId,
              controller,
            }, deviceId, clientId));
          })
          .catch(() => {
            // Keep waiting; the controller stream is the primary source of truth.
          });
      });
    };

    pollTakeover();
    const timer = window.setInterval(pollTakeover, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [clientId, deviceId, takeoverPollingFingerprint, updateState]);

  const settingsSyncFingerprint = useMemo(() => state.tabs.map((tab) => [
    tab.id,
    tab.agent.provider,
    tab.agent.command,
    tab.idlePolicy.enabled ? "1" : "0",
    String(tab.idlePolicy.idleMinutes),
    String(tab.idlePolicy.maxActive),
    tab.idlePolicy.pressure ? "1" : "0",
  ].join(":")).join("|"), [state.tabs]);

  useEffect(() => {
    const normalized = cloneAppSettings(appSettings);
    const { agentWorkspaceIds, idlePolicyWorkspaceIds } = summarizeWorkbenchSettingsSync(
      stateRef.current.tabs,
      normalized,
    );

    if (agentWorkspaceIds.length === 0 && idlePolicyWorkspaceIds.length === 0) {
      return;
    }

    updateState((current) => ({
      ...current,
      tabs: applyAppSettingsToTabs(current.tabs, normalized),
    }));

    idlePolicyWorkspaceIds.forEach((workspaceId) => {
      const tab = stateRef.current.tabs.find((item) => item.id === workspaceId);
      if (!tab || tab.controller.role !== "controller") {
        return;
      }
      void updateIdlePolicyRequest(workspaceId, normalized.idlePolicy, tab.controller).catch(() => {
        // Best effort sync; in-memory settings remain source of truth if backend lags.
      });
    });
  }, [appSettings, settingsSyncFingerprint, updateState]);

  return null;
};
