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
  recordPendingTerminalStream,
} from "../apps/web/src/features/workspace/workspace-stream-index.ts";

test("applyPendingStreamIndex only appends terminal output after agent stream removal", () => {
  const state = createDefaultWorkbenchState();
  const tabA = createTab(1, "en");
  tabA.id = "ws-a";
  tabA.terminals = [{
    id: "term-1",
    title: "Terminal 1",
    output: "before",
    recoverable: true,
  }];
  state.tabs = [tabA];
  state.activeTabId = tabA.id;

  const index = createPendingStreamIndex();
  assert.equal("agent" in index, false);
  recordPendingTerminalStream(index, {
    workspaceId: "ws-a",
    terminalId: "term-1",
    chunk: " world",
  });

  const next = applyPendingStreamIndex(state, index);

  assert.equal(next.tabs[0].terminals[0].output, "before world");
});
