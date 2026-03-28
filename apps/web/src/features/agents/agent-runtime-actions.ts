import type { MutableRefObject } from "react";
import type { WorkspaceControllerState } from "../workspace/workspace-controller.ts";
import { formatSessionTitle, type Locale, type Translator } from "../../i18n.ts";
import type { Session, Tab } from "../../state/workbench.ts";
import { resizeAgent } from "../../services/http/agent.service.ts";
import {
  AGENT_START_SYSTEM_MESSAGE,
  AGENT_STARTUP_DISCOVERY_MS,
  AGENT_STARTUP_MAX_WAIT_MS,
  AGENT_STARTUP_QUIET_MS,
  AGENT_TITLE_TRACK_LIMIT,
} from "../../shared/app/constants.ts";
import { stripAnsi, stripTerminalInputEscapes } from "../../shared/utils/ansi.ts";
import { parseNumericId, sessionTitleFromInput } from "../../shared/utils/session.ts";
import type { AgentEvent, AgentLifecycleEvent } from "../../types/app.ts";
import type { XtermBaseHandle } from "../../components/terminal/XtermBase.tsx";
import { fitAgentTerminalHandles } from "./agent-terminal-ref-fit.ts";

type AgentSize = { cols: number; rows: number };

type AgentResizeState = {
  inflight: boolean;
  pending?: AgentSize;
};

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
  agentRuntimeSizeRef: MutableRefObject<Map<string, AgentSize>>;
  agentResizeStateRef: MutableRefObject<Map<string, AgentResizeState>>;
  agentTitleTrackerRef: MutableRefObject<Map<string, AgentTitleTracker>>;
  runningAgentKeysRef: MutableRefObject<Set<string>>;
  agentStartupStateRef: MutableRefObject<Map<string, AgentStartupState>>;
  agentStartupTokenRef: MutableRefObject<number>;
};

export const agentRuntimeKey = (tabId: string, sessionId: string) => `${tabId}:${sessionId}`;

export const isAgentRuntimeRunning = (
  refs: AgentRuntimeRefs,
  tabId: string,
  sessionId: string,
) => refs.runningAgentKeysRef.current.has(agentRuntimeKey(tabId, sessionId));

export const fitAgentTerminals = (refs: AgentRuntimeRefs) => {
  fitAgentTerminalHandles(refs.agentTerminalRefs.current);
};

const flushAgentRuntimeSize = (
  refs: AgentRuntimeRefs,
  controller: WorkspaceControllerState,
  tabId: string,
  sessionId: string,
) => {
  const key = agentRuntimeKey(tabId, sessionId);
  const current = refs.agentResizeStateRef.current.get(key);
  if (!current || current.inflight || !current.pending) return;

  const nextSize = current.pending;
  current.pending = undefined;

  const last = refs.agentRuntimeSizeRef.current.get(key);
  if (last?.cols === nextSize.cols && last?.rows === nextSize.rows) {
    if (!current.pending) return;
  }

  current.inflight = true;
  void resizeAgent(tabId, controller, sessionId, nextSize.cols, nextSize.rows)
    .then(() => {
      refs.agentRuntimeSizeRef.current.set(key, nextSize);
    })
    .catch(() => {
      refs.agentRuntimeSizeRef.current.delete(key);
    })
    .finally(() => {
      const latest = refs.agentResizeStateRef.current.get(key);
      if (!latest) return;
      latest.inflight = false;
      if (latest.pending) {
        flushAgentRuntimeSize(refs, controller, tabId, sessionId);
        return;
      }
      if (!refs.runningAgentKeysRef.current.has(key)) {
        refs.agentResizeStateRef.current.delete(key);
      }
    });
};

export const syncAgentRuntimeSize = (
  refs: AgentRuntimeRefs,
  controller: WorkspaceControllerState,
  tabId: string,
  sessionId: string,
  size: AgentSize,
) => {
  const key = agentRuntimeKey(tabId, sessionId);
  const last = refs.agentRuntimeSizeRef.current.get(key);
  const current = refs.agentResizeStateRef.current.get(key) ?? { inflight: false };
  if (last?.cols === size.cols && last?.rows === size.rows && !current.pending) return;
  if (current.pending?.cols === size.cols && current.pending?.rows === size.rows) return;
  current.pending = size;
  refs.agentResizeStateRef.current.set(key, current);
  flushAgentRuntimeSize(refs, controller, tabId, sessionId);
};

export const syncAgentPaneSize = (
  refs: AgentRuntimeRefs,
  paneId: string,
  controller: WorkspaceControllerState,
  tabId: string,
  sessionId: string,
) => {
  const size = refs.agentPaneSizeRef.current.get(paneId)
    ?? refs.agentTerminalRefs.current.get(paneId)?.size();
  if (!size) return;
  syncAgentRuntimeSize(refs, controller, tabId, sessionId, size);
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
  const key = agentRuntimeKey(tabId, sessionId);
  refs.runningAgentKeysRef.current.delete(key);
  refs.agentRuntimeSizeRef.current.delete(key);
  refs.agentResizeStateRef.current.delete(key);
  clearAgentStartupGate(refs, tabId, sessionId);
};

export const markAgentRuntimeStarted = (
  refs: AgentRuntimeRefs,
  tabId: string,
  sessionId: string,
) => {
  const key = agentRuntimeKey(tabId, sessionId);
  refs.agentRuntimeSizeRef.current.delete(key);
  refs.agentResizeStateRef.current.delete(key);
  refs.runningAgentKeysRef.current.add(key);
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
    return null;
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
  return committed;
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

export const commitAgentSessionTitle = ({
  refs,
  paneId,
  tabId,
  sessionId,
  rawInput,
  locale,
  t,
  updateTab,
}: CommitAgentSessionTitleArgs) => {
  const title = sessionTitleFromInput(rawInput);
  if (!title) return;

  let applied = false;
  updateTab(tabId, (tab) => ({
    ...tab,
    sessions: tab.sessions.map((session) => {
      if (session.id !== sessionId) return session;
      const numericId = parseNumericId(session.id);
      const genericTitle = numericId === null ? null : formatSessionTitle(numericId, locale);
      const canReplace = session.isDraft
        || session.title === t("draftSessionTitle")
        || (genericTitle !== null && session.title === genericTitle);
      if (!canReplace) return session;
      applied = true;
      return { ...session, title };
    }),
  }));
  if (!applied) return;

  const tracker = refs.agentTitleTrackerRef.current.get(paneId);
  if (tracker) {
    tracker.locked = true;
    tracker.buffer = "";
    refs.agentTitleTrackerRef.current.set(paneId, tracker);
  }
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
    if (current.exited) {
      clearAgentStartupGate(refs, tabId, sessionId, token);
      return;
    }
    if (current.sawReady && now - current.lastEventAt >= 120) {
      clearAgentStartupGate(refs, tabId, sessionId, token);
      return;
    }
    if (current.sawOutput && now - current.lastEventAt >= AGENT_STARTUP_QUIET_MS) {
      clearAgentStartupGate(refs, tabId, sessionId, token);
      return;
    }
    if (!current.sawOutput && now - current.startedAt >= AGENT_STARTUP_DISCOVERY_MS) {
      clearAgentStartupGate(refs, tabId, sessionId, token);
      return;
    }
    if (now - current.startedAt >= AGENT_STARTUP_MAX_WAIT_MS) {
      clearAgentStartupGate(refs, tabId, sessionId, token);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
};
