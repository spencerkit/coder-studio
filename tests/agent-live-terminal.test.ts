import test from "node:test";
import assert from "node:assert/strict";

import { resolveActiveLiveTerminalPaneId } from "../apps/web/src/features/agents/agent-live-terminal";
import { createPaneLeaf, createSession, createTab } from "../apps/web/src/state/workbench-core";

test("resolveActiveLiveTerminalPaneId targets the active pane when it displays the active session", () => {
  const tab = createTab(1, "en");
  const session = tab.sessions[0];

  assert.equal(
    resolveActiveLiveTerminalPaneId(tab, session.id),
    tab.activePaneId,
  );
});

test("resolveActiveLiveTerminalPaneId ignores sessions outside the active pane", () => {
  const tab = createTab(1, "en");
  const activeSession = tab.sessions[0];
  const backgroundSession = createSession(2, "branch", "en");
  const backgroundPane = createPaneLeaf(backgroundSession.id);

  tab.sessions = [activeSession, backgroundSession];
  tab.activeSessionId = activeSession.id;
  tab.paneLayout = {
    type: "split",
    id: "split-1",
    axis: "horizontal",
    ratio: 0.5,
    first: {
      type: "leaf",
      id: tab.activePaneId,
      sessionId: activeSession.id,
    },
    second: backgroundPane,
  };

  assert.equal(
    resolveActiveLiveTerminalPaneId(tab, backgroundSession.id),
    null,
  );
});

test("resolveActiveLiveTerminalPaneId returns null when the active pane is no longer bound to the active session", () => {
  const tab = createTab(1, "en");
  const activeSession = tab.sessions[0];
  const detachedSession = createSession(2, "branch", "en");

  tab.sessions = [activeSession, detachedSession];
  tab.activeSessionId = activeSession.id;
  tab.paneLayout = {
    type: "leaf",
    id: tab.activePaneId,
    sessionId: detachedSession.id,
  };

  assert.equal(
    resolveActiveLiveTerminalPaneId(tab, activeSession.id),
    null,
  );
});


test("appendLiveAgentChunkToMountedPanes writes chunks into every mounted pane for the session", async () => {
  const { appendLiveAgentChunkToMountedPanes } = await import("../apps/web/src/features/agents/agent-live-terminal");
  const tab = createTab(1, "en");
  const session = tab.sessions[0];
  const writes: string[] = [];
  const refs = {
    agentTerminalRefs: {
      current: new Map([
        [tab.activePaneId, {
          appendOutput(value: string) {
            writes.push(value);
          },
        }],
      ]),
    },
  } as { agentTerminalRefs: { current: Map<string, { appendOutput: (value: string) => void }> } };

  assert.equal(appendLiveAgentChunkToMountedPanes(refs as never, tab, session.id, "hello"), 1);
  assert.deepEqual(writes, ["hello"]);
});

test("appendLiveAgentChunkToMountedPanes ignores panes without mounted terminal handles", async () => {
  const { appendLiveAgentChunkToMountedPanes } = await import("../apps/web/src/features/agents/agent-live-terminal");
  const tab = createTab(1, "en");
  const session = tab.sessions[0];
  const writes: string[] = [];
  const refs = {
    agentTerminalRefs: {
      current: new Map([
        ["other-pane", {
          appendOutput(value: string) {
            writes.push(value);
          },
        }],
      ]),
    },
  } as { agentTerminalRefs: { current: Map<string, { appendOutput: (value: string) => void }> } };

  assert.equal(appendLiveAgentChunkToMountedPanes(refs as never, tab, session.id, "hello"), 0);
  assert.deepEqual(writes, []);
});

test("appendLiveTerminalChunkToBoundAgentPanes routes live terminal output into mounted panes for the bound session", async () => {
  const { appendLiveTerminalChunkToBoundAgentPanes } = await import("../apps/web/src/features/agents/agent-live-terminal");
  const tab = createTab(1, "en");
  const activeSession = tab.sessions[0];
  activeSession.terminalId = "term-17";
  const siblingSession = createSession(2, "branch", "en");
  siblingSession.terminalId = "term-33";
  const siblingPane = createPaneLeaf(siblingSession.id);
  const writes: Array<{ paneId: string; value: string }> = [];

  tab.sessions = [activeSession, siblingSession];
  tab.paneLayout = {
    type: "split",
    id: "split-1",
    axis: "horizontal",
    ratio: 0.5,
    first: {
      type: "leaf",
      id: tab.activePaneId,
      sessionId: activeSession.id,
    },
    second: siblingPane,
  };

  const refs = {
    agentTerminalRefs: {
      current: new Map([
        [tab.activePaneId, {
          appendOutput(value: string) {
            writes.push({ paneId: tab.activePaneId, value });
          },
        }],
        [siblingPane.id, {
          appendOutput(value: string) {
            writes.push({ paneId: siblingPane.id, value });
          },
        }],
      ]),
    },
  } as { agentTerminalRefs: { current: Map<string, { appendOutput: (value: string) => void }> } };

  assert.equal(
    appendLiveTerminalChunkToBoundAgentPanes(refs as never, tab, "term-17", "hello"),
    1,
  );
  assert.deepEqual(writes, [{ paneId: tab.activePaneId, value: "hello" }]);
});

test("appendLiveTerminalChunkToBoundAgentPanes writes live codex chunks into the mounted pane", async () => {
  const { appendLiveTerminalChunkToBoundAgentPanes } = await import("../apps/web/src/features/agents/agent-live-terminal");
  const tab = createTab(1, "en");
  const activeSession = tab.sessions[0];
  activeSession.provider = "codex";
  activeSession.terminalId = "term-17";
  const writes: Array<{ paneId: string; value: string }> = [];

  const refs = {
    agentTerminalRefs: {
      current: new Map([
        [tab.activePaneId, {
          appendOutput(value: string) {
            writes.push({ paneId: tab.activePaneId, value });
          },
        }],
      ]),
    },
  } as { agentTerminalRefs: { current: Map<string, { appendOutput: (value: string) => void }> } };

  assert.equal(
    appendLiveTerminalChunkToBoundAgentPanes(refs as never, tab, "term-17", "hello"),
    1,
  );
  assert.deepEqual(writes, [{ paneId: tab.activePaneId, value: "hello" }]);
});
