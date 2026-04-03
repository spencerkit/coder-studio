import test from "node:test";
import assert from "node:assert/strict";

import {
  appendAgentTerminalRuntimeSnapshot,
  clearAgentTerminalRuntimeSnapshot,
  readAgentTerminalRuntimeSnapshot,
  readAgentTerminalRuntimeTranscript,
  replaceAgentTerminalRuntimeSnapshot,
} from "../apps/web/src/features/agents/agent-terminal-runtime-store";

test("agent terminal runtime snapshots hydrate from a seed and retain appended live output", () => {
  clearAgentTerminalRuntimeSnapshot("ws-1", "session-1");

  assert.equal(
    readAgentTerminalRuntimeSnapshot("ws-1", "session-1", "seed"),
    "seed",
  );

  appendAgentTerminalRuntimeSnapshot("ws-1", "session-1", "\rworking");

  assert.equal(
    readAgentTerminalRuntimeSnapshot("ws-1", "session-1", "ignored"),
    "seed\rworking",
  );
});

test("agent terminal runtime snapshots can keep raw terminal output separate from transcript text", () => {
  clearAgentTerminalRuntimeSnapshot("ws-1", "session-2");

  appendAgentTerminalRuntimeSnapshot("ws-1", "session-2", "\rworking", "working");

  assert.equal(
    readAgentTerminalRuntimeSnapshot("ws-1", "session-2"),
    "\rworking",
  );
  assert.equal(
    readAgentTerminalRuntimeTranscript("ws-1", "session-2"),
    "working",
  );
});

test("agent terminal runtime snapshots can be replaced after a restart or restore", () => {
  clearAgentTerminalRuntimeSnapshot("ws-2", "session-2");
  appendAgentTerminalRuntimeSnapshot("ws-2", "session-2", "stale");

  replaceAgentTerminalRuntimeSnapshot("ws-2", "session-2", "fresh", "fresh-text");

  assert.equal(
    readAgentTerminalRuntimeSnapshot("ws-2", "session-2"),
    "fresh",
  );
  assert.equal(
    readAgentTerminalRuntimeTranscript("ws-2", "session-2"),
    "fresh-text",
  );
});
