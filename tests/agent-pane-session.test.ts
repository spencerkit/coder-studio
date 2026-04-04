import test from "node:test";
import assert from "node:assert/strict";
import type { MutableRefObject } from "react";

import {
  agentRuntimeKey,
  armAgentStartupGate,
  clearAgentRuntimeTracking,
  noteAgentStartupLifecycle,
  type AgentRuntimeRefs,
} from "../apps/web/src/features/agents/agent-runtime-actions";

const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value });

const createRuntimeRefs = (): AgentRuntimeRefs => ({
  draftPromptInputRefs: ref(new Map()),
  agentTerminalRefs: ref(new Map()),
  agentTerminalQueueRef: ref(new Map()),
  agentPaneSizeRef: ref(new Map()),
  agentTitleTrackerRef: ref(new Map()),
  agentStartupStateRef: ref(new Map()),
  agentStartupTokenRef: ref(0),
});

test("armAgentStartupGate stores startup state under the session runtime key", () => {
  const refs = createRuntimeRefs();

  const token = armAgentStartupGate(refs, "ws-1", "session-1");
  const state = refs.agentStartupStateRef.current.get(agentRuntimeKey("ws-1", "session-1"));

  assert.equal(token, 1);
  assert.deepEqual(state && {
    token: state.token,
    sawOutput: state.sawOutput,
    sawReady: state.sawReady,
    exited: state.exited,
  }, {
    token: 1,
    sawOutput: false,
    sawReady: false,
    exited: false,
  });
});

test("noteAgentStartupLifecycle marks ready and exit transitions on the tracked runtime", () => {
  const refs = createRuntimeRefs();

  armAgentStartupGate(refs, "ws-1", "session-1");
  noteAgentStartupLifecycle(refs, "ws-1", "session-1", "session_started");
  noteAgentStartupLifecycle(refs, "ws-1", "session-1", "session_ended");

  const state = refs.agentStartupStateRef.current.get(agentRuntimeKey("ws-1", "session-1"));
  assert.equal(state?.sawReady, true);
  assert.equal(state?.exited, true);
});

test("clearAgentRuntimeTracking removes tracked startup state for the session", () => {
  const refs = createRuntimeRefs();

  armAgentStartupGate(refs, "ws-1", "session-1");
  clearAgentRuntimeTracking(refs, "ws-1", "session-1");

  assert.equal(
    refs.agentStartupStateRef.current.has(agentRuntimeKey("ws-1", "session-1")),
    false,
  );
});
