import type { MutableRefObject } from "react";
import {
  type ArchiveEntry,
  type Session,
  type SessionMode,
  type SessionStatus,
  type Tab,
  type WorkbenchState,
  createId,
  createPaneLeaf,
  createSession,
} from "../../state/workbench-core";
import { formatSessionTitle, formatTerminalTitle, type Locale, type Translator } from "../../i18n";
import {
  archiveSession as archiveSessionRequest,
  createSession as createSessionRequest,
  deleteSession as deleteSessionRequest,
  restoreSession as restoreSessionRequest,
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
  parseNumericId,
  resolveVisibleStatus,
  restoreVisibleStatus,
  sessionTitleFromInput,
  toBackgroundStatus,
} from "../../shared/utils/session";
import { createTabFromWorkspaceSnapshot } from "../../shared/utils/workspace";
import type { AppSettings, BackendArchiveEntry, BackendSession, SessionPatch, Toast, WorkspaceSnapshot } from "../../types/app";

import type { CompletionReminderTarget } from "./completion-reminders";
import { advanceWorkspaceSyncVersion } from "./workspace-sync-version";

type UpdateTab = (tabId: string, updater: (tab: Tab) => Tab) => void;
type WithServiceFallback = <T>(operation: () => Promise<T>, fallback: T) => Promise<T>;

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
    const inheritedProvider = tab.sessions.find((session) => session.id === tab.activeSessionId)?.provider
      ?? appSettings.agentDefaults.provider;
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

  const controllerForTab = (tabId: string) =>
    stateRef.current.tabs.find((tab) => tab.id === tabId)?.controller;

  const syncSessionPatch = async (tabId: string, sessionId: string, patch: SessionPatch) => {
    const backendSessionId = parseNumericId(sessionId);
    if (backendSessionId === null) return;
    const controller = controllerForTab(tabId);
    if (!controller || controller.role !== "controller") return;
    await withServiceFallback(
      () => updateSessionRequest(tabId, backendSessionId, patch, controller),
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

    let nextSession: Session | null = null;
    advanceWorkspaceSyncVersion(tabId);
    const created = await withServiceFallback<BackendSession | null>(
      () => createSessionRequest(
        tabId,
        currentSession.mode,
        currentSession.provider,
        currentTab.controller,
      ),
      null,
    );
    if (created) {
      nextSession = createSessionFromBackend(created, locale);
    }

    let tabSnapshot: Tab | null = null;
    let sessionSnapshot: Session | null = null;
    let titlePatch: { sessionId: string; title: string } | null = null;
    updateTab(tabId, (tab) => {
      const draftSession = tab.sessions.find((session) => session.id === sessionId);
      if (!draftSession) return tab;
      const baseSession = nextSession
        ?? createSession(tab.sessions.length + 1, draftSession.mode, locale, draftSession.provider);
      const draftTitle = draftSession.title.trim();
      const title = sessionTitleFromInput(firstInput)
        || (draftTitle && draftTitle !== t("draftSessionTitle") ? draftTitle : (baseSession.title || formatSessionTitle(baseSession.id, locale)));
      const preparedSession: Session = {
        ...baseSession,
        title,
        status: baseSession.status === "queued" ? "queued" : "idle",
        mode: draftSession.mode,
        provider: draftSession.provider,
        autoFeed: draftSession.autoFeed,
        isDraft: false,
        queue: draftSession.queue,
        messages: draftSession.messages,
        stream: draftSession.stream,
        unread: 0,
        lastActiveAt: Date.now(),
        resumeId: baseSession.resumeId,
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
        viewingArchiveId: undefined,
      };
      if (title !== baseSession.title && parseNumericId(preparedSession.id) !== null) {
        titlePatch = {
          sessionId: preparedSession.id,
          title,
        };
      }
      sessionSnapshot = preparedSession;
      return tabSnapshot;
    });

    if (!tabSnapshot || !sessionSnapshot) return null;
    const pendingTitlePatch = titlePatch;
    if (pendingTitlePatch) {
      await syncSessionPatch(tabId, pendingTitlePatch.sessionId, { title: pendingTitlePatch.title });
    }
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
  ): { paneId: string; replacedSessionId: string } | null => {
    let target: { paneId: string; replacedSessionId: string } | null = null;

    updateTab(tabId, (tab) => {
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
        viewingArchiveId: undefined,
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
      const updatedSessions = tab.sessions.map((session) => (
        session.id === tab.activeSessionId
          ? { ...session, status: toBackgroundStatus(session.status) }
          : session
      ));
      return {
        ...tab,
        sessions: [newSession, ...updatedSessions],
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
        viewingArchiveId: undefined,
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
              status: restoreVisibleStatus(session),
              lastActiveAt: nextActiveAt,
            };
          }
          if (session.id === currentTab.activeSessionId) {
            return { ...session, status: toBackgroundStatus(session.status) };
          }
          return session;
        }),
      viewingArchiveId: undefined,
    }));

    const backendSessionId = parseNumericId(sessionId);
    if (backendSessionId !== null) {
      void switchSessionRequest(tab.id, backendSessionId, tab.controller).catch(() => {
        // The active session already changed locally.
      });
    }
    const nextStatus = restoreVisibleStatus(nextSession);
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
            ? { ...item, unread: 0, status: restoreVisibleStatus(item), lastActiveAt: nextActiveAt }
            : item
        )),
        paneLayout: nextLayout,
        activePaneId: nextPaneId,
        activeSessionId: nextActiveId,
        viewingArchiveId: undefined,
      };
    });

    if (nextActiveSessionId) {
      const backendSessionId = parseNumericId(nextActiveSessionId);
      if (backendSessionId !== null) {
        void switchSessionRequest(tab.id, backendSessionId, tab.controller).catch(() => {
          // The pane switch already happened locally.
        });
      }
    }

    if (!isDraftSession(session)) {
      const backendSessionId = parseNumericId(session.id);
      if (backendSessionId !== null) {
        void archiveSessionRequest(tab.id, backendSessionId, tab.controller).catch(() => {
          // Session has already been archived locally.
        });
      }
    }
  };

  const archiveSessionForTab = async (tabId: string, sessionId: string) => {
    const currentTab = stateRef.current.tabs.find((item) => item.id === tabId);
    const session = currentTab?.sessions.find((item) => item.id === sessionId);
    if (!currentTab || !session) return;

    const wasActiveSession = currentTab.activeSessionId === sessionId;
    if (isDraftSession(session)) {
      const nextSession = currentTab.sessions.find((item) => item.id !== sessionId);
      const nextActiveAt = Date.now();
      updateTab(tabId, (tab) => {
        let remaining = tab.sessions.filter((item) => item.id !== sessionId);
        if (remaining.length === 0) {
          remaining = [createDraftSessionForTab(tab, "branch")];
        }
        const nextActiveId = remaining[0]?.id ?? sessionId;
        return {
          ...tab,
          sessions: remaining.map((item) => (
            item.id === nextActiveId && item.status === "background"
              ? { ...item, status: restoreVisibleStatus(item), unread: 0, lastActiveAt: Date.now() }
              : item
          )),
          paneLayout: remapPaneSession(tab.paneLayout, sessionId, nextActiveId),
          activeSessionId: nextActiveId,
          viewingArchiveId: undefined,
        };
      });
      if (nextSession) {
        const nextStatus = restoreVisibleStatus(nextSession);
        void syncSessionPatch(tabId, nextSession.id, {
          status: nextStatus,
          last_active_at: nextActiveAt,
        });
      }
      return;
    }

    const backendSessionId = parseNumericId(sessionId);
    const archived = backendSessionId !== null
      ? await withServiceFallback<BackendArchiveEntry | null>(
        () => archiveSessionRequest(tabId, backendSessionId, currentTab.controller),
        null,
      )
      : null;

    const nextActiveAt = Date.now();
    let nextActiveSessionId: string | null = null;
    let nextActiveStatus: SessionStatus | null = null;
    updateTab(tabId, (tab) => {
      const index = tab.sessions.findIndex((item) => item.id === sessionId);
      if (index === -1) return tab;
      const entry: ArchiveEntry = {
        id: archived ? String(archived.id) : createId("archive"),
        sessionId: session.id,
        time: archived?.time ?? nowLabel(),
        mode: archived?.mode ?? session.mode,
        snapshot: session,
      };
      const existingSessions = tab.sessions
        .filter((item) => item.id !== sessionId)
        .map((item) => ({ ...item, status: toBackgroundStatus(item.status) }));
      let remaining = existingSessions;
      if (wasActiveSession) {
        const draftSession = createDraftSessionForTab(tab, "branch");
        remaining = [draftSession, ...existingSessions];
      } else if (remaining.length === 0) {
        remaining = [createDraftSessionForTab(tab, "branch")];
      }
      const nextActive = remaining[0]?.id ?? sessionId;
      nextActiveSessionId = nextActive;
      nextActiveStatus = remaining[0] ? restoreVisibleStatus(remaining[0]) : null;
      return {
        ...tab,
        sessions: remaining.map((item) => (
          item.id === nextActive && item.status === "background"
            ? { ...item, status: restoreVisibleStatus(item), unread: 0, lastActiveAt: nextActiveAt }
            : item.id === nextActive && wasActiveSession
              ? { ...item, unread: 0, lastActiveAt: nextActiveAt }
              : item
        )),
        archive: [entry, ...tab.archive],
        paneLayout: remapPaneSession(tab.paneLayout, sessionId, nextActive),
        activeSessionId: nextActive,
        viewingArchiveId: undefined,
      };
    });

    if (wasActiveSession && nextActiveSessionId) {
      const nextBackendSessionId = parseNumericId(nextActiveSessionId);
      if (nextBackendSessionId !== null) {
        void switchSessionRequest(tabId, nextBackendSessionId, currentTab.controller).catch(() => {
          // Active session already updated locally.
        });
      }
      if (nextActiveStatus) {
        void syncSessionPatch(tabId, nextActiveSessionId, {
          status: nextActiveStatus,
          last_active_at: nextActiveAt,
        });
      }
    }
  };

  const restoreSessionIntoPane = async (
    tabId: string,
    sessionId: string,
    preferredPaneId?: string,
  ) => {
    const numericSessionId = parseNumericId(sessionId);
    if (numericSessionId === null) return null;

    const target = ensureRestorePane(tabId, preferredPaneId);
    if (!target) return null;

    advanceWorkspaceSyncVersion(tabId);
    const restored = await withServiceFallback(
      () => restoreSessionRequest(tabId, numericSessionId, controllerForTab(tabId)),
      null,
    );
    if (!restored) return null;

    if (restored.alreadyActive) {
      await refreshTabFromBackend(tabId);
      const nextTab = stateRef.current.tabs.find((tab) => tab.id === tabId);
      if (nextTab) {
        onSwitchSession(nextTab, sessionId);
      }
      return restored.session;
    }

    const nextActiveAt = Date.now();
    updateTab(tabId, (tab) => {
      const existingSession = tab.sessions.find((session) => session.id === sessionId);
      const nextSession = {
        ...createSessionFromBackend(restored.session, locale, existingSession),
        unread: 0,
        lastActiveAt: nextActiveAt,
      };
      const remainingSessions = tab.sessions
        .filter((session) => (
          session.id !== target.replacedSessionId
          && session.id !== nextSession.id
        ))
        .map((session) => (
          session.id === tab.activeSessionId
            ? { ...session, status: toBackgroundStatus(session.status) }
            : session
        ));
      return {
        ...tab,
        sessions: [
          { ...nextSession, status: restoreVisibleStatus(nextSession) },
          ...remainingSessions,
        ],
        paneLayout: replacePaneNode(tab.paneLayout, target.paneId, (leaf) => ({
          ...leaf,
          sessionId: nextSession.id,
        })),
        activePaneId: target.paneId,
        activeSessionId: nextSession.id,
        viewingArchiveId: undefined,
      };
    });

    return restored.session;
  };

  const deleteSessionFromHistory = async (workspaceId: string, sessionId: string) => {
    const numericSessionId = parseNumericId(sessionId);
    if (numericSessionId === null) return false;

    const controller = controllerForTab(workspaceId);
    const deleted = await withServiceFallback(
      async () => {
        await deleteSessionRequest(workspaceId, numericSessionId, controller);
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

    if (!note && session.status !== "idle") {
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

  const settleSessionAfterExit = async (tabId: string, sessionId: string) => {
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    const session = tab?.sessions.find((item) => item.id === sessionId);
    if (!tab || !session) return;

    if (session.status !== "idle") {
      await markSessionIdle(tabId, sessionId, t("agentExited"));
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
    archiveSessionForTab,
    restoreSessionIntoPane,
    deleteSessionFromHistory,
    markSessionIdle,
    settleSessionAfterExit,
  };
};

export default createWorkspaceSessionActions;
