import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAgentRecoveryAction,
  resolveTerminalRecoveryAction,
} from "../apps/web/src/features/workspace/workspace-recovery";
import { createWorkspaceControllerState } from "../apps/web/src/features/workspace/workspace-controller";

test("controller gets resume action for interrupted session with resume id", () => {
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
      provider: "claude",
      autoFeed: true,
      queue: [],
      messages: [],
      stream: "",
      unread: 0,
      lastActiveAt: 1,
      resumeId: "resume-77",
    },
  );

  assert.equal(action?.kind, "resume");
});

test("controller gets restart action for interrupted session without resume id", () => {
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
      provider: "codex",
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

test("controller does not get recovery action once interrupted session is rebound to a live terminal", () => {
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
      provider: "codex",
      autoFeed: true,
      queue: [],
      messages: [],
      stream: "",
      unread: 0,
      lastActiveAt: 1,
      resumeId: "resume-77",
      terminalId: "term-1",
    },
  );

  assert.equal(action, null);
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
      provider: "claude",
      autoFeed: true,
      queue: [],
      messages: [],
      stream: "",
      unread: 0,
      lastActiveAt: 1,
      resumeId: "resume-77",
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
