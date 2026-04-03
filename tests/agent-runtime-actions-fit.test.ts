import test from "node:test";
import assert from "node:assert/strict";
import { fitAgentTerminalHandles } from "../apps/web/src/features/agents/agent-terminal-ref-fit";

test("fitAgentTerminalHandles fits each registered terminal immediately", () => {
  const calls: string[] = [];
  const handles = new Map([
    ["pane-a", { fit: () => { calls.push("pane-a"); } }],
    ["pane-b", null],
    ["pane-c", { fit: () => { calls.push("pane-c"); } }],
  ]);

  fitAgentTerminalHandles(handles);

  assert.deepEqual(calls, ["pane-a", "pane-c"]);
});
