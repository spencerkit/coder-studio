import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultWorkbenchState,
  createSession,
  createTab,
} from "../apps/web/src/state/workbench-core.ts";
import {
  applyPendingStreamIndex,
  createPendingStreamIndex,
  recordPendingAgentStream,
  recordPendingTerminalStream,
} from "../apps/web/src/features/workspace/workspace-stream-index.ts";

test("applyPendingStreamIndex only rewrites the affected workspace slices", () => {
  const state = createDefaultWorkbenchState();
  const tabA = createTab(1, "en");
  const tabB = createTab(2, "en");
  const secondSession = createSession(2, "branch", "en");
  tabA.id = "ws-a";
  tabB.id = "ws-b";
  tabA.activeSessionId = tabA.sessions[0].id;
  tabA.sessions = [tabA.sessions[0], secondSession];
  tabA.terminals = [{
    id: "term-1",
    title: "Terminal 1",
    output: "before",
    recoverable: true,
  }];
  state.tabs = [tabA, tabB];
  state.activeTabId = tabA.id;

  const index = createPendingStreamIndex();
  recordPendingAgentStream(index, {
    workspaceId: "ws-a",
    sessionId: tabA.sessions[0].id,
    chunk: "hello",
    unreadDelta: 0,
  });
  recordPendingTerminalStream(index, {
    workspaceId: "ws-a",
    terminalId: "term-1",
    chunk: " world",
  });

  const next = applyPendingStreamIndex(state, index);

  assert.notEqual(next, state);
  assert.notEqual(next.tabs[0], state.tabs[0]);
  assert.equal(next.tabs[1], state.tabs[1]);
  assert.notEqual(next.tabs[0].sessions[0], state.tabs[0].sessions[0]);
  assert.equal(next.tabs[0].sessions[1], state.tabs[0].sessions[1]);
  assert.equal(next.tabs[0].sessions[0].stream, "hello");
  assert.equal(next.tabs[0].sessions[0].liveTerminalStream, "hello");
  assert.equal(next.tabs[0].terminals[0].output, "before world");
});

test("applyPendingStreamIndex increments unread counts for background sessions", () => {
  const state = createDefaultWorkbenchState();
  const tab = createTab(1, "en");
  const background = createSession(2, "branch", "en");
  tab.id = "ws-a";
  tab.sessions = [tab.sessions[0], background];
  tab.activeSessionId = tab.sessions[0].id;
  state.tabs = [tab];
  state.activeTabId = tab.id;

  const index = createPendingStreamIndex();
  recordPendingAgentStream(index, {
    workspaceId: "ws-a",
    sessionId: background.id,
    chunk: "background output",
    unreadDelta: 2,
  });

  const next = applyPendingStreamIndex(state, index);

  assert.equal(next.tabs[0].sessions[1].unread, 2);
  assert.equal(next.tabs[0].sessions[1].stream, "background output");
  assert.equal(next.tabs[0].sessions[1].liveTerminalStream, "background output");
});
