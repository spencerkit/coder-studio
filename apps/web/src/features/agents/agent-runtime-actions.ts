import type { MutableRefObject } from "react";
import type { Locale, Translator } from "../../i18n";
import type { Session, Tab } from "../../state/workbench";
import {
  AGENT_START_SYSTEM_MESSAGE,
  AGENT_STARTUP_DISCOVERY_MS,
  AGENT_STARTUP_MAX_WAIT_MS,
  AGENT_STARTUP_QUIET_MS,
  AGENT_TITLE_TRACK_LIMIT,
} from "../../shared/app/constants";
import { stripAnsi, stripTerminalInputEscapes } from "../../shared/utils/ansi";
import { findPaneSessionId } from "../../shared/utils/panes";
import { isDraftSession, isGeneratedSessionTitleForId, sessionTitleFromInput } from "../../shared/utils/session";
import type { AgentEvent, AgentLifecycleEvent } from "../../types/app";
import type { XtermBaseHandle } from "../../components/terminal/XtermBase";
import { fitAgentTerminalHandles } from "./agent-terminal-ref-fit";

type AgentSize = { cols: number; rows: number };

type AgentTitleTracker = {
  draftSessionId?: string;
  buffer: string;
  locked: boolean;
};

type AgentStartupState = {
  token: number;
  startedAt: number;
  lastEventAt: number;
  sawOutput: boolean;
  sawReady: boolean;
  exited: boolean;
};

type UpdateTab = (tabId: string, updater: (tab: Tab) => Tab) => void;

export type AgentRuntimeRefs = {
  draftPromptInputRefs: MutableRefObject<Map<string, HTMLInputElement | null>>;
  agentTerminalRefs: MutableRefObject<Map<string, XtermBaseHandle | null>>;
  agentTerminalQueueRef: MutableRefObject<Map<string, Promise<void>>>;
  agentPaneSizeRef: MutableRefObject<Map<string, AgentSize>>;
  agentTitleTrackerRef: MutableRefObject<Map<string, AgentTitleTracker>>;
  agentStartupStateRef: MutableRefObject<Map<string, AgentStartupState>>;
  agentStartupTokenRef: MutableRefObject<number>;
};

export const agentRuntimeKey = (tabId: string, sessionId: string) => `${tabId}:${sessionId}`;

export const fitAgentTerminals = (refs: AgentRuntimeRefs) => {
  fitAgentTerminalHandles(refs.agentTerminalRefs.current);
};

export const armAgentStartupGate = (
  refs: AgentRuntimeRefs,
  tabId: string,
  sessionId: string,
) => {
  const token = ++refs.agentStartupTokenRef.current;
  const now = Date.now();
  refs.agentStartupStateRef.current.set(agentRuntimeKey(tabId, sessionId), {
    token,
    startedAt: now,
    lastEventAt: now,
    sawOutput: false,
    sawReady: false,
    exited: false,
  });
  return token;
};

export const clearAgentStartupGate = (
  refs: AgentRuntimeRefs,
  tabId: string,
  sessionId: string,
  token?: number,
) => {
  const key = agentRuntimeKey(tabId, sessionId);
  const current = refs.agentStartupStateRef.current.get(key);
  if (!current) return;
  if (token !== undefined && current.token !== token) return;
  refs.agentStartupStateRef.current.delete(key);
};

export const clearAgentRuntimeTracking = (
  refs: AgentRuntimeRefs,
  tabId: string,
  sessionId: string,
) => {
  clearAgentStartupGate(refs, tabId, sessionId);
};

export const setAgentTerminalRef = (
  refs: AgentRuntimeRefs,
  paneId: string,
  handle: XtermBaseHandle | null,
) => {
  if (handle) {
    refs.agentTerminalRefs.current.set(paneId, handle);
    return;
  }

  refs.agentTerminalRefs.current.delete(paneId);
  refs.agentTerminalQueueRef.current.delete(paneId);
  refs.agentPaneSizeRef.current.delete(paneId);
  refs.agentTitleTrackerRef.current.delete(paneId);
};

export const waitForAgentTerminalMount = async (
  refs: AgentRuntimeRefs,
  paneId: string,
  timeoutMs = 1200,
) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (refs.agentTerminalRefs.current.get(paneId)) {
      return true;
    }
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
  }
  return false;
};

export const setDraftPromptInputRef = (
  refs: AgentRuntimeRefs,
  paneId: string,
  element: HTMLInputElement | null,
) => {
  if (element) {
    refs.draftPromptInputRefs.current.set(paneId, element);
    return;
  }
  refs.draftPromptInputRefs.current.delete(paneId);
};

export const focusAgentTerminal = (
  refs: AgentRuntimeRefs,
  paneId?: string | null,
) => {
  if (!paneId) return;
  requestAnimationFrame(() => {
    const draftInput = refs.draftPromptInputRefs.current.get(paneId);
    if (draftInput) {
      draftInput.focus();
      const length = draftInput.value.length;
      draftInput.setSelectionRange(length, length);
      return;
    }
    refs.agentTerminalRefs.current.get(paneId)?.focus();
  });
};

export const trackAgentInitialTitleInput = (
  refs: AgentRuntimeRefs,
  paneId: string,
  session: Session,
  data: string,
) => {
  const existing = refs.agentTitleTrackerRef.current.get(paneId);
  const tracker = existing ?? {
    draftSessionId: session.isDraft ? session.id : undefined,
    buffer: "",
    locked: false,
  };

  if (session.isDraft && existing?.draftSessionId !== session.id) {
    tracker.draftSessionId = session.id;
    tracker.buffer = "";
    tracker.locked = false;
  }

  if (tracker.locked) {
    refs.agentTitleTrackerRef.current.set(paneId, tracker);
    return {
      committedTitle: null,
      materializeTitle: "",
    };
  }

  const normalized = stripTerminalInputEscapes(data);
  let buffer = tracker.buffer;
  let committed: string | null = null;
  for (const char of normalized) {
    if (char === "\r" || char === "\n") {
      if (!committed && buffer.trim()) {
        committed = buffer;
      }
      buffer = "";
      continue;
    }
    if (char === "\u007f" || char === "\b") {
      buffer = buffer.slice(0, -1);
      continue;
    }
    if (char === "\t") {
      buffer += " ";
      continue;
    }
    if (char < " ") continue;
    buffer += char;
    if (buffer.length > AGENT_TITLE_TRACK_LIMIT) {
      buffer = buffer.slice(-AGENT_TITLE_TRACK_LIMIT);
    }
  }

  tracker.buffer = buffer;
  refs.agentTitleTrackerRef.current.set(paneId, tracker);
  return {
    committedTitle: committed,
    materializeTitle: committed ?? "",
  };
};

type CommitAgentSessionTitleArgs = {
  refs: AgentRuntimeRefs;
  paneId: string;
  tabId: string;
  sessionId: string;
  rawInput: string;
  locale: Locale;
  t: Translator;
  updateTab: UpdateTab;
};

type ApplyTrackedAgentSessionTitleArgs = CommitAgentSessionTitleArgs & {
  session: Session;
  data: string;
  persistTitle?: (title: string) => void;
};

export const commitAgentSessionTitle = ({
  refs,
  paneId,
  tabId,
  sessionId,
  rawInput,
  locale,
  t,
  updateTab,
}: CommitAgentSessionTitleArgs): string | null => {
  const title = sessionTitleFromInput(rawInput);
  if (!title) return null;

  let applied = false;
  updateTab(tabId, (tab) => ({
    ...tab,
    sessions: tab.sessions.map((session) => {
      if (session.id !== sessionId) return session;
      const canReplace = session.isDraft
        || session.title === t("draftSessionTitle")
        || isGeneratedSessionTitleForId(session.title, session.id);
      if (!canReplace) return session;
      applied = true;
      return { ...session, title };
    }),
  }));
  if (!applied) return null;

  const tracker = refs.agentTitleTrackerRef.current.get(paneId);
  if (tracker) {
    tracker.locked = true;
    tracker.buffer = "";
    refs.agentTitleTrackerRef.current.set(paneId, tracker);
  }

  return title;
};

export const applyTrackedAgentSessionTitle = ({
  refs,
  paneId,
  tabId,
  sessionId,
  session,
  data,
  locale,
  t,
  updateTab,
  persistTitle,
}: ApplyTrackedAgentSessionTitleArgs): string | null => {
  const tracked = trackAgentInitialTitleInput(refs, paneId, session, data);
  if (!tracked.committedTitle) {
    return null;
  }

  const appliedTitle = commitAgentSessionTitle({
    refs,
    paneId,
    tabId,
    sessionId,
    rawInput: tracked.committedTitle,
    locale,
    t,
    updateTab,
  });

  if (!appliedTitle) {
    return null;
  }

  persistTitle?.(appliedTitle);
  return appliedTitle;
};

type PreviewAgentSessionTitleArgs = {
  tabId: string;
  sessionId: string;
  rawInput: string;
  locale: Locale;
  t: Translator;
  updateTab: UpdateTab;
};

export const previewAgentSessionTitle = ({
  tabId,
  sessionId,
  rawInput,
  locale,
  t,
  updateTab,
}: PreviewAgentSessionTitleArgs): string | null => {
  const title = sessionTitleFromInput(rawInput);
  if (!title) return null;

  let applied = false;
  updateTab(tabId, (tab) => ({
    ...tab,
    sessions: tab.sessions.map((session) => {
      if (session.id !== sessionId) return session;
      const canReplace = session.isDraft
        || session.title === t("draftSessionTitle")
        || isGeneratedSessionTitleForId(session.title, session.id);
      if (!canReplace) return session;
      applied = true;
      return { ...session, title };
    }),
  }));

  return applied ? title : null;
};

export const noteAgentStartupEvent = (
  refs: AgentRuntimeRefs,
  tabId: string,
  sessionId: string,
  kind: AgentEvent["kind"],
  data: string,
) => {
  const key = agentRuntimeKey(tabId, sessionId);
  const current = refs.agentStartupStateRef.current.get(key);
  if (!current) return;

  if (kind === "exit") {
    current.exited = true;
    current.lastEventAt = Date.now();
    return;
  }

  const cleaned = stripAnsi(data).trim();
  const countsAsOutput = kind === "stdout"
    || kind === "stderr"
    || (kind === "system" && cleaned !== "" && cleaned !== AGENT_START_SYSTEM_MESSAGE);
  if (!countsAsOutput) return;
  current.sawOutput = true;
  current.lastEventAt = Date.now();
};

export const noteAgentStartupLifecycle = (
  refs: AgentRuntimeRefs,
  tabId: string,
  sessionId: string,
  kind: AgentLifecycleEvent["kind"],
) => {
  const key = agentRuntimeKey(tabId, sessionId);
  const current = refs.agentStartupStateRef.current.get(key);
  if (!current) return;

  if (kind === "session_started") {
    current.sawReady = true;
    current.lastEventAt = Date.now();
    return;
  }

  if (kind === "session_ended") {
    current.exited = true;
    current.lastEventAt = Date.now();
  }
};

export const shouldReleaseAgentStartupGate = (
  state: Pick<AgentStartupState, "startedAt" | "lastEventAt" | "sawOutput" | "sawReady" | "exited">,
  now: number,
) => {
  if (state.exited) return true;
  if (state.sawReady && now - state.lastEventAt >= 120) return true;

  if (state.sawOutput && now - state.lastEventAt >= AGENT_STARTUP_QUIET_MS) return true;
  if (!state.sawOutput && now - state.startedAt >= AGENT_STARTUP_DISCOVERY_MS) return true;

  return now - state.startedAt >= AGENT_STARTUP_MAX_WAIT_MS;
};

export const waitForAgentStartupDrain = async (
  refs: AgentRuntimeRefs,
  tabId: string,
  sessionId: string,
  token: number,
) => {
  const key = agentRuntimeKey(tabId, sessionId);
  while (true) {
    const current = refs.agentStartupStateRef.current.get(key);
    if (!current || current.token !== token) return;

    const now = Date.now();
    if (shouldReleaseAgentStartupGate(current, now)) {
      clearAgentStartupGate(refs, tabId, sessionId, token);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
};
