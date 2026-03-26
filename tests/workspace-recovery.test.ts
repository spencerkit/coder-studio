import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAgentRecoveryAction,
  resolveTerminalRecoveryAction,
} from "../apps/web/src/features/workspace/workspace-recovery.ts";
import { createWorkspaceControllerState } from "../apps/web/src/features/workspace/workspace-controller.ts";

test("controller gets resume action for interrupted claude session", () => {
  const action = resolveAgentRecoveryAction(
    createWorkspaceControllerState({
      role: "controller",
      deviceId: "device-a",
      clientId: "client-a",
      fencingToken: 1,
    }),
    {
      id: "1",
      title: "Session 1",
      status: "interrupted",
      mode: "branch",
      autoFeed: true,
      queue: [],
      messages: [],
      stream: "",
      unread: 0,
      lastActiveAt: 1,
      claudeSessionId: "claude-123",
    },
  );

  assert.equal(action?.kind, "resume");
});

test("controller gets restart action for interrupted non-claude session", () => {
  const action = resolveAgentRecoveryAction(
    createWorkspaceControllerState({
      role: "controller",
      deviceId: "device-a",
      clientId: "client-a",
      fencingToken: 1,
    }),
    {
      id: "1",
      title: "Session 1",
      status: "interrupted",
      mode: "branch",
      autoFeed: true,
      queue: [],
      messages: [],
      stream: "",
      unread: 0,
      lastActiveAt: 1,
    },
  );

  assert.equal(action?.kind, "restart");
});

test("observer does not get agent recovery action", () => {
  const action = resolveAgentRecoveryAction(
    createWorkspaceControllerState({
      role: "observer",
      deviceId: "device-a",
      clientId: "client-a",
      fencingToken: 1,
    }),
    {
      id: "1",
      title: "Session 1",
      status: "interrupted",
      mode: "branch",
      autoFeed: true,
      queue: [],
      messages: [],
      stream: "",
      unread: 0,
      lastActiveAt: 1,
      claudeSessionId: "claude-123",
    },
  );

  assert.equal(action, null);
});

test("controller gets new-terminal action for unrecoverable shell snapshot", () => {
  const action = resolveTerminalRecoveryAction(
    createWorkspaceControllerState({
      role: "controller",
      deviceId: "device-a",
      clientId: "client-a",
      fencingToken: 1,
    }),
    {
      id: "term-1",
      title: "Terminal 1",
      output: "hello",
      recoverable: false,
    },
  );

  assert.equal(action?.kind, "new_terminal");
});
