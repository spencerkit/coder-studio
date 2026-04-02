import type { Tab } from "../../state/workbench";
import { collectPaneLeaves, findPaneSessionId } from "../../shared/utils/panes";
import type { AgentRuntimeRefs } from "./agent-runtime-actions";

export const resolveActiveLiveTerminalPaneId = (
  tab: Tab,
  sessionId: string,
) => {
  if (tab.activeSessionId !== sessionId) {
    return null;
  }

  const activePaneSessionId = findPaneSessionId(tab.paneLayout, tab.activePaneId);
  return activePaneSessionId === sessionId ? tab.activePaneId : null;
};

export const resolveSessionPaneIds = (tab: Tab, sessionId: string) => (
  collectPaneLeaves(tab.paneLayout)
    .filter((leaf) => leaf.sessionId === sessionId)
    .map((leaf) => leaf.id)
);

export const appendLiveAgentChunkToMountedPanes = (
  refs: Pick<AgentRuntimeRefs, "agentTerminalRefs">,
  tab: Tab,
  sessionId: string,
  chunk: string,
) => {
  if (!chunk) return 0;

  let appended = 0;
  for (const paneId of resolveSessionPaneIds(tab, sessionId)) {
    const handle = refs.agentTerminalRefs.current.get(paneId);
    if (!handle) continue;
    handle.appendOutput(chunk);
    appended += 1;
  }
  return appended;
};

export const appendLiveTerminalChunkToBoundAgentPanes = (
  refs: Pick<AgentRuntimeRefs, "agentTerminalRefs">,
  tab: Tab,
  terminalId: string,
  chunk: string,
) => {
  if (!terminalId || !chunk) return 0;

  let appended = 0;
  const routedSessionIds = new Set<string>();
  for (const session of tab.sessions) {
    if (session.terminalId !== terminalId || routedSessionIds.has(session.id)) {
      continue;
    }
    routedSessionIds.add(session.id);
    appended += appendLiveAgentChunkToMountedPanes(refs, tab, session.id, chunk);
  }
  return appended;
};
