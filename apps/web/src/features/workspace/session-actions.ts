import type { MutableRefObject } from "react";
import {
  type Session,
  type SessionMode,
  type SessionStatus,
  type Tab,
  type WorkbenchState,
  createDefaultWorkbenchState,
  createId,
  createPaneLeaf,
  normalizeWorkbenchState,
} from "../../state/workbench-core";
import { formatSessionTitle, formatTerminalTitle, type Locale, type Translator } from "../../i18n";
import {
  closeSession as closeSessionRequest,
  createSession as createSessionRequest,
  deleteProviderSession as deleteProviderSessionRequest,
  removeMissingBinding as removeMissingBindingRequest,
  restoreProviderSession as restoreProviderSessionRequest,
  switchSession as switchSessionRequest,
  updateSession as updateSessionRequest,
} from "../../services/http/session.service";
import { getWorkspaceSnapshot } from "../../services/http/workspace.service";
import {
  collectPaneLeaves,
  findPaneIdBySessionId,
  findPaneSessionId,
  remapPaneSession,
  removePaneNode,
  replacePaneNode,
} from "../../shared/utils/panes";
import {
  createDraftSessionPlaceholder,
  createSessionFromBackend,
  isDraftSession,
  nowLabel,
  sessionTitleFromInput,
} from "../../shared/utils/session";
import { createTabFromWorkspaceSnapshot } from "../../shared/utils/workspace";
import type {
  AppSettings,
  SessionHistoryRecord,
  SessionPatch,
  Toast,
  WorkspaceSnapshot,
} from "../../types/app";

import type { CompletionReminderTarget } from "./completion-reminders";
import { advanceWorkspaceSyncVersion } from "./workspace-sync-version";

type UpdateTab = (tabId: string, updater: (tab: Tab) => Tab) => void;
type WithServiceFallback = <T>(operation: () => Promise<T>, fallback: T) => Promise<T>;
type RestorePaneStrategy = "reuse-draft" | "split-new";

type WorkspaceSessionActionDeps = {
  appSettings: AppSettings;
  locale: Locale;
  t: Translator;
  stateRef: MutableRefObject<WorkbenchState>;
  updateTab: UpdateTab;
  withServiceFallback: WithServiceFallback;
  addToast: (toast: Toast) => void;
  onCompletionReminder?: (target: CompletionReminderTarget) => Promise<void> | void;
};

export const createWorkspaceSessionActions = ({
  appSettings,
  locale,
  t,
  stateRef,
  updateTab,
  withServiceFallback,
  addToast,
  onCompletionReminder,
}: WorkspaceSessionActionDeps) => {
  const buildDraftSessionMessages = (tab: Tab) => createDraftSessionPlaceholder({
    locale,
    workspacePath: tab.project?.path ?? t("noWorkspace"),
    branch: tab.git.branch,
  }).messages;

  const createDraftSessionForTab = (tab: Tab, mode: SessionMode = "branch"): Session => {
    const defaultProvider = appSettings.agentDefaults?.provider
      ?? (appSettings as { agentProvider?: string }).agentProvider
      ?? "claude";
    const inheritedProvider = tab.sessions.find((session) => session.id === tab.activeSessionId)?.provider
      ?? tab.sessions[0]?.provider
      ?? defaultProvider;
    const draft = createDraftSessionPlaceholder({
      locale,
      workspacePath: tab.project?.path ?? t("noWorkspace"),
      branch: tab.git.branch,
      mode,
    });
    return {
      ...draft,
      provider: inheritedProvider,
    };
  };

  const normalizeMutatedTab = (tab: Tab): Tab => {
    const defaultWorkbenchState = createDefaultWorkbenchState();
    return normalizeWorkbenchState({
      tabs: [tab],
      activeTabId: tab.id,
      layout: defaultWorkbenchState.layout,
      overlay: defaultWorkbenchState.overlay,
    }).tabs[0];
  };

  const controllerForTab = (tabId: string) =>
    stateRef.current.tabs.find((tab) => tab.id === tabId)?.controller;

  const syncSessionPatch = async (tabId: string, sessionId: string, patch: SessionPatch) => {
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    const controller = tab?.controller;
    const session = tab?.sessions.find((item) => item.id === sessionId);
    if (!session || isDraftSession(session)) return;
    if (!controller || controller.role !== "controller") return;
    await withServiceFallback(
      () => updateSessionRequest(tabId, sessionId, patch, controller),
      null,
    );
  };

  const touchSession = (tabId: string, sessionId: string) => {
    const lastActiveAt = Date.now();
    updateTab(tabId, (tab) => ({
      ...tab,
      sessions: tab.sessions.map((session) => (
        session.id === sessionId ? { ...session, lastActiveAt } : session
      )),
    }));
    void syncSessionPatch(tabId, sessionId, { last_active_at: lastActiveAt });
  };

  const materializeSession = async (tabId: string, sessionId: string, firstInput: string) => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === tabId);
    const currentSession = currentTab?.sessions.find((session) => session.id === sessionId);
    if (!currentTab || !currentSession) return null;
    if (!isDraftSession(currentSession)) {
      return { tab: currentTab, session: currentSession };
    }

    const controller = currentTab.controller;
    if (controller?.role !== "controller") return null;

    const created = await withServiceFallback(
      () => createSessionRequest(
        tabId,
        currentSession.mode,
        currentSession.provider,
        controller,
      ),
      null,
    );
    if (!created) return null;

    let tabSnapshot: Tab | null = null;
    let sessionSnapshot: Session | null = null;
    updateTab(tabId, (tab) => {
      const draftSession = tab.sessions.find((session) => session.id === sessionId);
      if (!draftSession) return tab;
      const draftTitle = draftSession.title.trim();
      const generatedTitle = formatSessionTitle(draftSession.id, locale);
      const title = sessionTitleFromInput(firstInput)
        || (draftTitle && draftTitle !== t("draftSessionTitle") ? draftTitle : "")
        || generatedTitle;
      const backendSession = createSessionFromBackend(created, locale, draftSession);
      const preparedSession: Session = {
        ...backendSession,
        title,
        isDraft: false,
        unread: 0,
        lastActiveAt: Date.now(),
      };
      const remainingSessions = tab.sessions.filter((session) => session.id !== sessionId);
      tabSnapshot = {
        ...tab,
        sessions: [preparedSession, ...remainingSessions],
        activeSessionId: preparedSession.id,
        paneLayout: replacePaneNode(tab.paneLayout, tab.activePaneId, (leaf) => ({
          ...leaf,
          sessionId: preparedSession.id,
        })),
      };
      sessionSnapshot = preparedSession;
      return tabSnapshot;
    });

    if (!tabSnapshot || !sessionSnapshot) return null;
    return { tab: tabSnapshot, session: sessionSnapshot };
  };

  const refreshTabFromBackend = async (tabId: string) => {
    const snapshot = await withServiceFallback<WorkspaceSnapshot | null>(() => getWorkspaceSnapshot(tabId), null);
    if (!snapshot) return;

    updateTab(tabId, (tab) => createTabFromWorkspaceSnapshot(snapshot, locale, appSettings, tab));
  };

  const ensureRestorePane = (
    tabId: string,
    preferredPaneId?: string,
    strategy: RestorePaneStrategy = "reuse-draft",
  ): { paneId: string; replacedSessionId: string } | null => {
    let target: { paneId: string; replacedSessionId: string } | null = null;

    updateTab(tabId, (tab) => {
      if (strategy === "reuse-draft") {
        const preferredSessionId = preferredPaneId
          ? findPaneSessionId(tab.paneLayout, preferredPaneId)
          : null;
        if (preferredPaneId && preferredSessionId) {
          const preferredSession = tab.sessions.find((session) => session.id === preferredSessionId);
          if (isDraftSession(preferredSession)) {
            target = {
              paneId: preferredPaneId,
              replacedSessionId: preferredSessionId,
            };
            return tab;
          }
        }

        const draftSession = tab.sessions.find((session) => isDraftSession(session));
        const draftPaneId = draftSession
          ? findPaneIdBySessionId(tab.paneLayout, draftSession.id)
          : undefined;
        if (draftSession && draftPaneId) {
          target = {
            paneId: draftPaneId,
            replacedSessionId: draftSession.id,
          };
          return tab;
        }
      }

      const sourcePaneId = preferredPaneId
        ? (findPaneSessionId(tab.paneLayout, preferredPaneId) ? preferredPaneId : undefined)
        : undefined;
      const targetPaneId = sourcePaneId
        ?? findPaneIdBySessionId(tab.paneLayout, tab.activeSessionId)
        ?? collectPaneLeaves(tab.paneLayout)[0]?.id;
      if (!targetPaneId) {
        return tab;
      }

      const nextDraft = createDraftSessionForTab(tab, "branch");
      const nextLeaf = createPaneLeaf(nextDraft.id);
      target = {
        paneId: nextLeaf.id,
        replacedSessionId: nextDraft.id,
      };
      return {
        ...tab,
        sessions: [nextDraft, ...tab.sessions.filter((session) => session.id !== nextDraft.id)],
        activeSessionId: nextDraft.id,
        activePaneId: nextLeaf.id,
        paneLayout: replacePaneNode(tab.paneLayout, targetPaneId, (leaf) => ({
          type: "split",
          id: createId("split"),
          axis: "vertical",
          ratio: 0.5,
          first: leaf,
          second: nextLeaf,
        })),
      };
    });

    return target;
  };

  const onNewSession = async () => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeTabId);
    if (!currentTab) return;

    updateTab(currentTab.id, (tab) => {
      const newSession = createDraftSessionForTab(tab, "branch");
      const nextLeaf = createPaneLeaf(newSession.id);
      return {
        ...tab,
        sessions: [newSession, ...tab.sessions],
        activeSessionId: newSession.id,
        activePaneId: nextLeaf.id,
        paneLayout: replacePaneNode(tab.paneLayout, tab.activePaneId, (leaf) => ({
          type: "split",
          id: createId("split"),
          axis: "vertical",
          ratio: 0.5,
          first: leaf,
          second: nextLeaf,
        })),
      };
    });
  };

  const onSwitchSession = (tab: Tab, sessionId: string) => {
    const nextActiveAt = Date.now();
    const previousActiveId = tab.activeSessionId;
    const nextSession = tab.sessions.find((session) => session.id === sessionId);
    const targetPaneId = findPaneIdBySessionId(tab.paneLayout, sessionId);
    if (!targetPaneId || !nextSession) return;

    updateTab(tab.id, (currentTab) => ({
      ...currentTab,
      activeSessionId: sessionId,
      activePaneId: targetPaneId,
      sessions: currentTab.sessions
        .filter((session) => !(previousActiveId !== sessionId && session.id === previousActiveId && isDraftSession(session)))
        .map((session) => {
          if (session.id === sessionId) {
            return {
              ...session,
              unread: 0,
              status: session.status,
              lastActiveAt: nextActiveAt,
            };
          }
          return session;
        }),
    }));

    if (!isDraftSession(nextSession)) {
      void switchSessionRequest(tab.id, sessionId, tab.controller).catch(() => {
        // The active session already changed locally.
      });
    }
    const nextStatus = nextSession.status;
    void syncSessionPatch(tab.id, sessionId, {
      status: nextStatus,
      last_active_at: nextActiveAt,
    });
  };

  const onCloseAgentPane = (tab: Tab, paneId: string, sessionId: string) => {
    const session = tab.sessions.find((item) => item.id === sessionId);
    if (!session) return;

    const nextActiveAt = Date.now();
    let nextActiveSessionId: string | null = null;
    updateTab(tab.id, (currentTab) => {
      const sessionExists = currentTab.sessions.some((item) => item.id === sessionId);
      if (!sessionExists) return currentTab;

      const canRemovePane = collectPaneLeaves(currentTab.paneLayout).length > 1;
      const remainingSessions = currentTab.sessions.filter((item) => item.id !== sessionId);
      const hasRemaining = remainingSessions.length > 0;
      const fallbackSession = hasRemaining ? null : createDraftSessionForTab(currentTab, "branch");
      const sessions = hasRemaining ? remainingSessions : [fallbackSession!];
      const nextSessionId = sessions[0]?.id ?? sessionId;

      let nextLayout = canRemovePane ? (removePaneNode(currentTab.paneLayout, paneId) ?? currentTab.paneLayout) : currentTab.paneLayout;
      nextLayout = remapPaneSession(nextLayout, sessionId, nextSessionId);
      const leaves = collectPaneLeaves(nextLayout);
      const nextPaneId = currentTab.activePaneId === paneId
        ? (leaves[0]?.id ?? currentTab.activePaneId)
        : currentTab.activePaneId;
      const nextActiveId = findPaneSessionId(nextLayout, nextPaneId) ?? nextSessionId;
      nextActiveSessionId = nextActiveId;

      return {
        ...currentTab,
        sessions: sessions.map((item) => (
          item.id === nextActiveId
            ? { ...item, unread: 0, status: item.status, lastActiveAt: nextActiveAt }
            : item
        )),
        paneLayout: nextLayout,
        activePaneId: nextPaneId,
        activeSessionId: nextActiveId,
      };
    });

    if (nextActiveSessionId) {
      const nextActiveSession = tab.sessions.find((item) => item.id === nextActiveSessionId);
      if (nextActiveSession && !isDraftSession(nextActiveSession)) {
        void switchSessionRequest(tab.id, nextActiveSessionId, tab.controller).catch(() => {
          // The pane switch already happened locally.
        });
      }
    }

    if (!isDraftSession(session)) {
      void closeSessionRequest(tab.id, session.id, tab.controller).catch(() => {
        // Session has already been closed locally.
      });
    }
  };

  const restoreSessionIntoPane = async (
    tabId: string,
    historyRecord: Pick<SessionHistoryRecord, "provider" | "resumeId" | "title">,
    preferredPaneId?: string,
    options?: {
      strategy?: RestorePaneStrategy;
    },
  ) => {
    const strategy = options?.strategy ?? "reuse-draft";
    const tabSnapshot = stateRef.current.tabs.find((tab) => tab.id === tabId) ?? null;
    const matchingSession = tabSnapshot?.sessions.find((session) => (
      !isDraftSession(session)
      && session.provider === historyRecord.provider
      && session.resumeId === historyRecord.resumeId
    ));
    const matchingPaneId = matchingSession && tabSnapshot
      ? findPaneIdBySessionId(tabSnapshot.paneLayout, matchingSession.id)
      : null;
    const target = matchingSession && matchingPaneId
      ? {
          paneId: matchingPaneId,
          replacedSessionId: matchingSession.id,
        }
      : ensureRestorePane(tabId, preferredPaneId, strategy);
    if (!target) return null;

    const preparedTab = stateRef.current.tabs.find((tab) => tab.id === tabId) ?? null;
    const replacedSession = preparedTab?.sessions.find((session) => session.id === target.replacedSessionId);
    const needsBackendSlot = strategy === "split-new" || isDraftSession(replacedSession);
    let restoreSessionId = target.replacedSessionId;
    if (needsBackendSlot) {
      const tab = preparedTab;
      const controller = tab?.controller;
      if (controller?.role !== "controller") return null;
      const created = await withServiceFallback(
        () => createSessionRequest(
          tabId,
          replacedSession?.mode ?? "branch",
          historyRecord.provider,
          controller,
        ),
        null,
      );
      if (!created) return null;
      restoreSessionId = String(created.id);
    }

    advanceWorkspaceSyncVersion(tabId);
    const restored = await withServiceFallback(
      () => restoreProviderSessionRequest(
        tabId,
        restoreSessionId,
        historyRecord.provider,
        historyRecord.resumeId,
        controllerForTab(tabId),
      ),
      null,
    );
    if (!restored) return null;

    if (restored.alreadyActive) {
      await refreshTabFromBackend(tabId);
      const nextTab = stateRef.current.tabs.find((tab) => tab.id === tabId);
      if (nextTab) {
        onSwitchSession(nextTab, restored.session.id);
      }
      return restored.session;
    }

    await refreshTabFromBackend(tabId);
    const refreshedTab = stateRef.current.tabs.find((tab) => tab.id === tabId);
    if (!refreshedTab) {
      return restored.session;
    }

    const nextActiveAt = Date.now();
    updateTab(tabId, (tab) => {
      const sourceTab = preparedTab ?? (refreshedTab.id === tab.id ? refreshedTab : tab);
      const existingSession = sourceTab.sessions.find((session) => (
        session.id === restored.session.id || session.id === restoreSessionId
      ));
      const restoreTitleFallback = historyRecord.title.trim();
      const baseSession = createSessionFromBackend(
        restored.session,
        locale,
        restoreTitleFallback
          ? { ...existingSession, title: restoreTitleFallback }
          : existingSession,
      );
      const nextSession = {
        ...baseSession,
        title: restoreTitleFallback || baseSession.title,
        unread: 0,
        lastActiveAt: nextActiveAt,
      };
      const remainingSessions = sourceTab.sessions
        .filter((session) => (
          session.id !== target.replacedSessionId
          && session.id !== nextSession.id
        ));
      const nextTab = {
        ...sourceTab,
        sessions: [
          { ...nextSession, status: nextSession.status },
          ...remainingSessions,
        ],
        paneLayout: replacePaneNode(sourceTab.paneLayout, target.paneId, (leaf) => ({
          ...leaf,
          sessionId: nextSession.id,
        })),
        activePaneId: target.paneId,
        activeSessionId: nextSession.id,
      };
      return strategy === "split-new"
        ? nextTab
        : normalizeMutatedTab(nextTab);
    });

    return restored.session;
  };

  const deleteSessionFromHistory = async (
    workspaceId: string,
    historyRecord: Pick<SessionHistoryRecord, "provider" | "resumeId" | "state" | "sessionId">,
  ) => {
    const controller = controllerForTab(workspaceId);
    const deleted = await withServiceFallback(
      async () => {
        if (historyRecord.state === "unavailable") {
          if (!historyRecord.sessionId) return false;
          await removeMissingBindingRequest(
            workspaceId,
            historyRecord.sessionId,
            controller,
          );
          return true;
        }
        await deleteProviderSessionRequest(
          workspaceId,
          historyRecord.provider,
          historyRecord.resumeId,
          controller,
        );
        return true;
      },
      false,
    );
    if (!deleted) {
      return false;
    }

    if (stateRef.current.tabs.some((tab) => tab.id === workspaceId)) {
      await refreshTabFromBackend(workspaceId);
    }

    return true;
  };

  const markSessionIdle = async (tabId: string, sessionId: string, note?: string) => {
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    const session = tab?.sessions.find((item) => item.id === sessionId);
    if (!tab || !session) return;

    updateTab(tabId, (currentTab) => ({
      ...currentTab,
      sessions: currentTab.sessions.map((currentSession) => {
        if (currentSession.id !== sessionId) return currentSession;
        const nextUnread = currentSession.id === currentTab.activeSessionId ? 0 : currentSession.unread + 1;
        return {
          ...currentSession,
          status: "idle",
          unread: nextUnread,
          lastActiveAt: Date.now(),
          messages: note
            ? [
                ...currentSession.messages,
                {
                  id: createId("msg"),
                  role: "system" as const,
                  content: note,
                  time: nowLabel(),
                },
              ]
            : currentSession.messages,
        };
      }),
    }));

    void syncSessionPatch(tabId, sessionId, { status: "idle", last_active_at: Date.now() });

    const updatedTab = stateRef.current.tabs.find((item) => item.id === tabId);
    const updatedSession = updatedTab?.sessions.find((item) => item.id === sessionId);
    if (!updatedTab || !updatedSession) return;

    if (!note) {
      void onCompletionReminder?.({
        workspaceId: updatedTab.id,
        workspaceTitle: updatedTab.title,
        sessionId,
        sessionTitle: updatedSession.title,
      });
    }

    if (updatedTab.activeSessionId !== sessionId && session.status !== "idle") {
      addToast({
        id: createId("toast"),
        text: note ?? t("taskCompletedToast", { title: updatedSession.title }),
        sessionId,
      });
    }
  };

  return {
    buildDraftSessionMessages,
    createDraftSessionForTab,
    syncSessionPatch,
    touchSession,
    materializeSession,
    refreshTabFromBackend,
    onNewSession,
    onSwitchSession,
    onCloseAgentPane,
    restoreSessionIntoPane,
    deleteSessionFromHistory,
    markSessionIdle,
  };
};

export default createWorkspaceSessionActions;
