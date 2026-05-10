import type { Session, Workspace } from "@coder-studio/core";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { activeSessionAtom, sessionsAtom } from "./sessions";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "./workspaces";

function createWorkspace(id: string): Workspace {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    targetRuntime: "native",
    openedAt: 1,
    lastActiveAt: 1,
    uiState: {
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
    },
  };
}

function createSession(id: string, workspaceId: string, state: Session["state"]): Session {
  return {
    id,
    workspaceId,
    terminalId: `${id}-terminal`,
    providerId: "codex",
    state,
    capability: "full",
    startedAt: 1,
    lastActiveAt: 1,
  };
}

describe("activeSessionAtom", () => {
  it("falls back to the first ordered ready workspace when the requested workspace is missing", () => {
    const store = createStore();
    const ws1 = createWorkspace("ws-1");
    const ws2 = createWorkspace("ws-2");
    const runningSession = createSession("sess-2", ws2.id, "running");

    store.set(workspacesAtom, {
      [ws1.id]: ws1,
      [ws2.id]: ws2,
    });
    store.set(workspaceOrderAtom, [ws2.id, ws1.id]);
    store.set(workspacesLoadStateAtom, "ready");
    store.set(activeWorkspaceIdAtom, "missing");
    store.set(sessionsAtom, {
      [runningSession.id]: runningSession,
    });

    expect(store.get(activeSessionAtom)?.id).toBe(runningSession.id);
  });

  it("returns null before the workspace list is ready", () => {
    const store = createStore();
    const ws1 = createWorkspace("ws-1");
    const runningSession = createSession("sess-1", ws1.id, "running");

    store.set(workspacesAtom, {
      [ws1.id]: ws1,
    });
    store.set(workspaceOrderAtom, [ws1.id]);
    store.set(workspacesLoadStateAtom, "loading");
    store.set(activeWorkspaceIdAtom, ws1.id);
    store.set(sessionsAtom, {
      [runningSession.id]: runningSession,
    });

    expect(store.get(activeSessionAtom)).toBeNull();
  });
});
