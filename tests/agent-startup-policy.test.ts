import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAgentStartupDiscoveryMs,
  resolveAgentStartupQuietMs,
  shouldReleaseAgentStartupGate,
} from "../apps/web/src/features/agents/agent-runtime-actions.ts";

test("resolveAgentStartupQuietMs keeps codex startup drain longer than claude", () => {
  assert.equal(resolveAgentStartupQuietMs("claude"), 240);
  assert.ok(resolveAgentStartupQuietMs("codex") > resolveAgentStartupQuietMs("claude"));
});

test("resolveAgentStartupDiscoveryMs keeps codex startup discovery longer than claude", () => {
  assert.equal(resolveAgentStartupDiscoveryMs("claude"), 1200);
  assert.ok(resolveAgentStartupDiscoveryMs("codex") > resolveAgentStartupDiscoveryMs("claude"));
});

test("codex startup gate does not release on quiet output before ready", () => {
  assert.equal(shouldReleaseAgentStartupGate({
    startedAt: 0,
    lastEventAt: 1400,
    sawOutput: true,
    sawReady: false,
    exited: false,
  }, 3000, "codex"), false);
});

test("codex startup gate releases shortly after ready lifecycle arrives", () => {
  assert.equal(shouldReleaseAgentStartupGate({
    startedAt: 0,
    lastEventAt: 3000,
    sawOutput: true,
    sawReady: true,
    exited: false,
  }, 3121, "codex"), true);
});

test("claude startup gate still releases after quiet output without ready", () => {
  assert.equal(shouldReleaseAgentStartupGate({
    startedAt: 0,
    lastEventAt: 1000,
    sawOutput: true,
    sawReady: false,
    exited: false,
  }, 1241, "claude"), true);
});
